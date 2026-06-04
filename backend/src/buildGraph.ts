import { createHash } from "node:crypto";
import path from "node:path";
import type {
  ExtractedFileMetadata,
  ExtractedStructure,
  FileHistoryInfo,
  FunctionCall,
  FunctionWaypoint,
  GraphEdge,
  GraphJson,
  GraphNode,
  HealthComponents,
  HealthTier
} from "./types.js";

const TEST_FILE_PATTERN = /(?:^|\/)__tests__(?:\/|$)|\.(?:test|spec)\.[^/]+$/i;
const STRING_LITERAL_PATTERN = /(["'`])(?:\\[\s\S]|(?!\1)[^\\])*?\1/g;
const IDENTIFIER_PATTERN = /\b[A-Za-z_$][\w$]*\b/g;
const RESERVED_IDENTIFIERS = new Set([
  "abstract",
  "and",
  "arguments",
  "as",
  "async",
  "await",
  "boolean",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "constructor",
  "continue",
  "def",
  "default",
  "del",
  "delete",
  "do",
  "elif",
  "else",
  "enum",
  "except",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "from",
  "function",
  "global",
  "if",
  "implements",
  "import",
  "in",
  "instanceof",
  "interface",
  "is",
  "let",
  "new",
  "none",
  "not",
  "null",
  "number",
  "object",
  "or",
  "package",
  "pass",
  "private",
  "protected",
  "public",
  "raise",
  "return",
  "static",
  "string",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "undefined",
  "var",
  "void",
  "while",
  "with",
  "yield"
]);

interface DuplicateCandidate {
  id: string;
  waypoint: FunctionWaypoint;
}

function labelFromPath(nodePath: string): string {
  return nodePath === "." ? "." : path.posix.basename(nodePath);
}

function parentFromPath(nodePath: string): string | undefined {
  const parent = path.posix.dirname(nodePath);
  return parent === "." ? undefined : parent;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function healthTierFor(score: number): HealthTier {
  if (score >= 70) {
    return "healthy";
  }

  if (score >= 40) {
    return "warning";
  }

  return "critical";
}

function functionGlobalId(filePath: string, waypoint: FunctionWaypoint): string {
  return `${filePath}:${waypoint.waypointId}`;
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/#.*$/gm, "");
}

function functionSource(metadata: ExtractedFileMetadata, waypoint: FunctionWaypoint): string {
  return metadata.sourceText
    .split(/\r?\n/)
    .slice(Math.max(0, waypoint.startLine - 1), waypoint.endLine)
    .join("\n");
}

function meaningfulLineCount(source: string): number {
  return stripComments(source.replace(STRING_LITERAL_PATTERN, "_s"))
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0).length;
}

function normalizeFunctionBody(source: string): string {
  let variableIndex = 0;
  const variablePlaceholders = new Map<string, string>();
  const withoutLiterals = source
    .replace(STRING_LITERAL_PATTERN, "_s")
    .replace(/\b\d+(?:\.\d+)?\b/g, "_n");
  const withoutComments = stripComments(withoutLiterals);

  return withoutComments
    .replace(IDENTIFIER_PATTERN, (identifier) => {
      if (RESERVED_IDENTIFIERS.has(identifier.toLowerCase())) {
        return identifier;
      }

      const existing = variablePlaceholders.get(identifier);
      if (existing) {
        return existing;
      }

      const placeholder = `_v${variableIndex}`;
      variableIndex += 1;
      variablePlaceholders.set(identifier, placeholder);
      return placeholder;
    })
    .replace(/\s+/g, "");
}

function duplicateHash(normalizedBody: string): string {
  return createHash("sha256").update(normalizedBody).digest("hex").slice(0, 16);
}

export function detectDuplicates(structure: ExtractedStructure): void {
  const groupsByHash = new Map<string, DuplicateCandidate[]>();

  for (const filePath of [...structure.files].sort()) {
    const metadata = structure.fileMetadata.get(filePath);

    if (!metadata) {
      continue;
    }

    for (const waypoint of metadata.functionWaypoints ?? []) {
      waypoint.duplicateGroup = null;
      waypoint.duplicateOf = null;

      if (
        TEST_FILE_PATTERN.test(filePath) ||
        waypoint.kind === "constructor" ||
        waypoint.name.toLowerCase() === "constructor"
      ) {
        continue;
      }

      const source = functionSource(metadata, waypoint);
      if (meaningfulLineCount(source) < 3) {
        continue;
      }

      const normalizedBody = normalizeFunctionBody(source);
      if (!normalizedBody) {
        continue;
      }

      const hash = duplicateHash(normalizedBody);
      const entries = groupsByHash.get(hash) ?? [];
      entries.push({
        id: functionGlobalId(filePath, waypoint),
        waypoint
      });
      groupsByHash.set(hash, entries);
    }
  }

  for (const [hash, group] of groupsByHash.entries()) {
    if (group.length < 2) {
      continue;
    }

    for (const candidate of group) {
      candidate.waypoint.duplicateGroup = hash;
      candidate.waypoint.duplicateOf = group
        .filter((other) => other.id !== candidate.id)
        .map((other) => other.id);
    }
  }
}

function resolvedCallTargetId(structure: ExtractedStructure, call: FunctionCall): string | null {
  if (!call.definitionPath) {
    return null;
  }

  const metadata = structure.fileMetadata.get(call.definitionPath);
  const waypoints = metadata?.functionWaypoints ?? [];

  if (call.definitionWaypointId) {
    const target = waypoints.find((waypoint) => waypoint.waypointId === call.definitionWaypointId);
    if (target) {
      return functionGlobalId(call.definitionPath, target);
    }
  }

  if (call.definitionStartLine !== undefined && call.definitionEndLine !== undefined) {
    const target = waypoints.find(
      (waypoint) =>
        waypoint.startLine === call.definitionStartLine &&
        waypoint.endLine === call.definitionEndLine
    );
    if (target) {
      return functionGlobalId(call.definitionPath, target);
    }
  }

  if (call.definitionName) {
    const namedTargets = waypoints.filter((waypoint) => waypoint.name === call.definitionName);
    if (namedTargets.length === 1) {
      return functionGlobalId(call.definitionPath, namedTargets[0]);
    }
  }

  return null;
}

function calledFunctionIds(structure: ExtractedStructure): Set<string> {
  const ids = new Set<string>();

  for (const metadata of structure.fileMetadata.values()) {
    for (const waypoint of metadata.functionWaypoints ?? []) {
      for (const call of waypoint.calls) {
        const targetId = resolvedCallTargetId(structure, call);
        if (targetId) {
          ids.add(targetId);
        }
      }
    }

    for (const call of metadata.moduleLinks ?? []) {
      const targetId = resolvedCallTargetId(structure, call);
      if (targetId) {
        ids.add(targetId);
      }
    }
  }

  return ids;
}

function hasDetectedCallSite(filePath: string, waypoint: FunctionWaypoint, detectedCallIds: Set<string>): boolean {
  return (
    detectedCallIds.has(functionGlobalId(filePath, waypoint)) ||
    waypoint.inputs.some((input) => (input.sources?.length ?? 0) > 0)
  );
}

function isExemptFromGhostPenalty(waypoint: FunctionWaypoint, fileIsStaticEntrypoint: boolean): boolean {
  if (waypoint.exported || (waypoint.exportNames?.length ?? 0) > 0) {
    return true;
  }

  const frameworkPatterns = [
    /^use[A-Z]/,
    /^on[A-Z]/,
    /^handle[A-Z]/,
    /^render[A-Z]/,
    /^get[A-Z]/,
    /^set[A-Z]/,
    /^(componentDidMount|componentDidUpdate|componentWillUnmount)$/,
    /^(getServerSideProps|getStaticProps|getStaticPaths)$/,
    /^(loader|action)$/
  ];

  if (frameworkPatterns.some((pattern) => pattern.test(waypoint.name))) {
    return true;
  }

  if (fileIsStaticEntrypoint) {
    return true;
  }

  return false;
}

export function computeFileHealthScore(
  functions: FunctionWaypoint[],
  history: FileHistoryInfo | undefined,
  linesOfCode: number,
  options: {
    filePath?: string;
    calledFunctionIds?: Set<string>;
    staticEntrypoint?: boolean;
  } = {}
): {
  healthScore: number | null;
  healthTier: HealthTier;
  healthComponents: HealthComponents | null;
  unscoredReason?: "no-functions";
} {
  // NOTE: health scoring math has no dedicated tests.
  // Regressions in component weights or tier thresholds will ship silently.
  // Recommended: add unit tests for computeFileHealthScore before next scoring change.
  const functionCount = functions.length;
  if (functionCount === 0) {
    return {
      healthScore: null,
      healthTier: "unscored",
      healthComponents: null,
      unscoredReason: "no-functions"
    };
  }

  const avgCyclomatic = functionCount > 0
    ? functions.reduce((total, waypoint) => total + (waypoint.cyclomaticComplexity ?? 1), 0) / functionCount
    : 0;
  const cyclomatic = avgCyclomatic <= 3 ? 25 : avgCyclomatic <= 7 ? 15 : avgCyclomatic <= 15 ? 8 : 0;
  const avgCognitive = functionCount > 0
    ? functions.reduce((total, waypoint) => total + waypoint.cognitiveComplexity, 0) / functionCount
    : 0;
  const cognitive = avgCognitive <= 5 ? 20 : avgCognitive <= 10 ? 12 : avgCognitive <= 20 ? 5 : 0;
  const duplicatedFunctions = functions.filter((waypoint) => waypoint.duplicateOf !== null);
  const duplicationRatio = functionCount > 0 ? duplicatedFunctions.length / functionCount : 0;
  const duplication = duplicationRatio === 0 ? 20 : duplicationRatio <= 0.1 ? 12 : duplicationRatio <= 0.25 ? 5 : 0;
  const churnRate = history?.churnRate ?? history?.commitCount ?? 0;
  const churn = churnRate <= 0.5 ? 20 : churnRate <= 2 ? 12 : churnRate <= 5 ? 5 : 0;
  const filePath = options.filePath;
  const detectedCallIds = options.calledFunctionIds;
  const eligibleGhostFunctions = functions.filter(
    (waypoint) => !isExemptFromGhostPenalty(waypoint, options.staticEntrypoint === true)
  );
  const ghostCount = filePath && detectedCallIds
    ? eligibleGhostFunctions.filter((waypoint) => !hasDetectedCallSite(filePath, waypoint, detectedCallIds)).length
    : 0;
  const ghostRatio = eligibleGhostFunctions.length > 0 ? ghostCount / eligibleGhostFunctions.length : 0;
  const ghostRatioComponent = ghostRatio <= 0.1 ? 15 : ghostRatio <= 0.3 ? 8 : ghostRatio <= 0.6 ? 3 : 0;
  const healthComponents: HealthComponents = {
    cyclomatic,
    cognitive,
    duplication,
    churn,
    ghostRatio: ghostRatioComponent
  };
  const healthScore = clamp(
    Object.values(healthComponents).reduce((total, component) => total + component, 0),
    0,
    100
  );

  return {
    healthScore,
    healthTier: healthTierFor(healthScore),
    healthComponents
  };
}

function validateFileHealthScores(fileNodes: GraphNode[]): void {
  const validTiers = new Set<HealthTier>(["healthy", "warning", "critical", "unscored"]);
  let highScoreCount = 0;

  for (const node of fileNodes) {
    if (node.healthTier === "unscored") {
      if (node.healthScore !== null) {
        console.warn(`[health] ${node.path} is unscored but has a non-null score: ${node.healthScore}`);
      }

      if (node.healthComponents !== null) {
        console.warn(`[health] ${node.path} is unscored but has health components.`);
      }

      continue;
    }

    if (typeof node.healthScore !== "number" || node.healthScore < 0 || node.healthScore > 100) {
      console.warn(`[health] ${node.path} has an out-of-range health score: ${node.healthScore}`);
    }

    if (!node.healthTier || !validTiers.has(node.healthTier)) {
      console.warn(`[health] ${node.path} has an invalid health tier: ${node.healthTier}`);
    }

    if (node.healthComponents) {
      const componentSum = Object.values(node.healthComponents).reduce((total, component) => total + component, 0);
      if (Math.abs(componentSum - (node.healthScore ?? 0)) > 1) {
        console.warn(
          `[health] ${node.path} component sum ${componentSum} does not match score ${node.healthScore}`
        );
      }
    }

    if ((node.healthScore ?? 0) > 90) {
      highScoreCount += 1;
    }
  }

  if (fileNodes.length > 0 && highScoreCount / fileNodes.length > 0.8) {
    console.warn(
      `[health] ${highScoreCount}/${fileNodes.length} files scored above 90; formula calibration may be too generous.`
    );
  }
}

export function buildGraph(
  structure: ExtractedStructure,
  fileHistory: Record<string, FileHistoryInfo> = {}
): GraphJson {
  const importCounts = new Map<string, number>();
  const childCounts = new Map<string, number>();
  const detectedCallIds = calledFunctionIds(structure);

  for (const filePath of structure.files) {
    const parent = parentFromPath(filePath);
    if (parent) {
      childCounts.set(parent, (childCounts.get(parent) ?? 0) + 1);
    }
  }

  for (const folderPath of structure.folders) {
    const parent = parentFromPath(folderPath);
    if (parent) {
      childCounts.set(parent, (childCounts.get(parent) ?? 0) + 1);
    }
  }

  for (const importEdge of structure.imports) {
    importCounts.set(importEdge.source, (importCounts.get(importEdge.source) ?? 0) + 1);
  }

  const folderNodes: GraphNode[] = [...structure.folders]
    .sort()
    .map((folderPath) => ({
      id: folderPath,
      type: "folder",
      label: labelFromPath(folderPath),
      path: folderPath,
      parent: parentFromPath(folderPath),
      metadata: {
        childCount: childCounts.get(folderPath) ?? 0
      }
    }));

  const fileNodes: GraphNode[] = [...structure.files]
    .sort()
    .map((filePath) => {
      const extractedMetadata = structure.fileMetadata.get(filePath);
      const compressionReasons = extractedMetadata?.compressionReasons ?? [];
      const linesOfCode = extractedMetadata?.linesOfCode ?? 0;
      const fileHealth = computeFileHealthScore(
        extractedMetadata?.functionWaypoints ?? [],
        fileHistory[filePath],
        linesOfCode,
        {
          filePath,
          calledFunctionIds: detectedCallIds,
          staticEntrypoint: extractedMetadata?.staticEntrypoint
        }
      );

      return {
        id: filePath,
        type: "file",
        label: labelFromPath(filePath),
        path: filePath,
        parent: parentFromPath(filePath),
        sourceText: extractedMetadata?.sourceText,
        healthScore: fileHealth.healthScore,
        healthTier: fileHealth.healthTier,
        healthComponents: fileHealth.healthComponents,
        unscoredReason: fileHealth.unscoredReason,
        metadata: {
          extension: path.posix.extname(filePath),
          importCount: importCounts.get(filePath) ?? 0,
          linesOfCode,
          ...(extractedMetadata?.staticEntrypoint
            ? {
                staticEntrypoint: true,
                staticEntrypointKind: extractedMetadata.staticEntrypointKind
              }
            : {}),
          ...(typeof extractedMetadata?.functionCount === "number"
            ? { functionCount: extractedMetadata.functionCount }
            : {}),
          ...(extractedMetadata?.functionWaypoints
            ? { functionWaypoints: extractedMetadata.functionWaypoints }
            : {}),
          ...(extractedMetadata?.variableWaypoints?.length
            ? { variableWaypoints: extractedMetadata.variableWaypoints }
            : {}),
          ...(extractedMetadata?.moduleLinks?.length
            ? { moduleLinks: extractedMetadata.moduleLinks }
            : {}),
          compressionLevel: compressionReasons.length > 0 ? "low-signal" : undefined,
          compressionReasons: compressionReasons.length > 0 ? compressionReasons : undefined
        }
      };
    });

  validateFileHealthScores(fileNodes);

  const edges: GraphEdge[] = structure.imports
    .slice()
    .sort((a, b) => `${a.source}:${a.target}`.localeCompare(`${b.source}:${b.target}`))
    .map((importEdge, index) => ({
      id: `edge-${index + 1}`,
      source: importEdge.source,
      target: importEdge.target,
      type: "import"
    }));

  return {
    nodes: [...folderNodes, ...fileNodes],
    edges
  };
}
