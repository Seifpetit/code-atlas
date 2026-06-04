import path from "node:path";
import { parser as pythonParser } from "@lezer/python";
import type {
  FunctionCall,
  FunctionInput,
  FunctionOutput,
  FunctionWaypoint,
  VariableDeclarationKind,
  VariableWaypoint
} from "./types.js";

type PythonSyntaxNode = ReturnType<typeof pythonParser.parse>["topNode"];

export interface PythonExtraction {
  functionCount: number;
  functionWaypoints: FunctionWaypoint[];
  variableWaypoints: VariableWaypoint[];
  importPaths: string[];
  isPackageGateway: boolean;
}

interface PythonBinding {
  localName: string;
  definitionPath: string;
  definitionName?: string;
  namespace: boolean;
}

interface PythonImportName {
  name: string;
  alias?: string;
}

interface PythonImportStatement {
  kind: "import" | "from";
  moduleName: string;
  relativeLevel: number;
  names: PythonImportName[];
}

interface PythonWaypointNode {
  node: PythonSyntaxNode;
  name: string;
  kind: "function" | "method";
  className?: string;
  isAsync: boolean;
  isPublic: boolean;
  isModuleLevel: boolean;
}

interface ResolvedPythonWaypointNode extends PythonWaypointNode {
  waypointId: string;
  startLine: number;
  endLine: number;
}

interface PythonVariableDeclaration {
  name: string;
  node: PythonSyntaxNode;
  nameNode: PythonSyntaxNode;
  kind: Extract<VariableDeclarationKind, "assignment" | "iterator">;
  owner?: PythonSyntaxNode;
}

interface PythonFunctionComplexity {
  cyclomaticComplexity: number;
  cognitiveComplexity: number;
}

const OPERATIONAL_VARIABLE_NAME_PATTERN = /(?:runtime|graph|node|focus|selected|context|corridor|xray|x-ray|position)/i;
const PYTHON_CYCLOMATIC_NODE_NAMES = new Set([
  "IfStatement",
  "ForStatement",
  "WhileStatement",
  "ExceptClause",
  "ConditionalExpression",
  "MatchClause"
]);
const PYTHON_COGNITIVE_FLAT_NODE_NAMES = new Set([
  "IfStatement",
  "ForStatement",
  "WhileStatement",
  "ExceptClause",
  "ConditionalExpression",
  "MatchStatement",
  "MatchClause"
]);
const PYTHON_COGNITIVE_NESTING_NODE_NAMES = new Set([
  "IfStatement",
  "ForStatement",
  "WhileStatement",
  "ExceptClause",
  "MatchStatement"
]);

function nodeText(source: string, node: PythonSyntaxNode): string {
  return source.slice(node.from, node.to);
}

function childNodes(node: PythonSyntaxNode): PythonSyntaxNode[] {
  const children: PythonSyntaxNode[] = [];

  for (let child = node.firstChild; child; child = child.nextSibling) {
    children.push(child);
  }

  return children;
}

function descendantNodes(node: PythonSyntaxNode, name: string): PythonSyntaxNode[] {
  const descendants: PythonSyntaxNode[] = [];

  for (const child of childNodes(node)) {
    if (child.name === name) {
      descendants.push(child);
    }

    descendants.push(...descendantNodes(child, name));
  }

  return descendants;
}

function pythonLogicalOperatorFor(node: PythonSyntaxNode | null): string | null {
  if (!node || node.name !== "BinaryExpression") {
    return null;
  }

  const operator = childNodes(node).find((child) => child.name === "and" || child.name === "or");
  return operator?.name ?? null;
}

function isPythonLogicalSequenceRoot(node: PythonSyntaxNode): boolean {
  const operator = pythonLogicalOperatorFor(node);
  if (!operator) {
    return false;
  }

  return pythonLogicalOperatorFor(node.parent) !== operator;
}

function hasPythonJumpTarget(node: PythonSyntaxNode): boolean {
  return (
    (node.name === "BreakStatement" || node.name === "ContinueStatement") &&
    childNodes(node).length > 1
  );
}

function functionComplexityFor(root: PythonSyntaxNode): PythonFunctionComplexity {
  let cyclomaticComplexity = 1;
  let cognitiveComplexity = 0;

  function addCognitiveIncrement(depth: number): void {
    cognitiveComplexity += 1 + depth;
  }

  function visit(node: PythonSyntaxNode, nestingDepth: number): void {
    if (node !== root && (node.name === "FunctionDefinition" || node.name === "ClassDefinition")) {
      return;
    }

    if (PYTHON_CYCLOMATIC_NODE_NAMES.has(node.name) || pythonLogicalOperatorFor(node)) {
      cyclomaticComplexity += 1;
    }

    if (
      PYTHON_COGNITIVE_FLAT_NODE_NAMES.has(node.name) ||
      isPythonLogicalSequenceRoot(node) ||
      hasPythonJumpTarget(node)
    ) {
      addCognitiveIncrement(nestingDepth);
    }

    if (node.name === "IfStatement") {
      for (const child of childNodes(node)) {
        if (child.name === "elif" || child.name === "else") {
          addCognitiveIncrement(nestingDepth);
        }
      }
    }

    const childNestingDepth = PYTHON_COGNITIVE_NESTING_NODE_NAMES.has(node.name)
      ? nestingDepth + 1
      : nestingDepth;

    for (const child of childNodes(node)) {
      visit(child, childNestingDepth);
    }
  }

  visit(root, 0);

  return {
    cyclomaticComplexity,
    cognitiveComplexity
  };
}

function directChild(node: PythonSyntaxNode, name: string): PythonSyntaxNode | undefined {
  return childNodes(node).find((child) => child.name === name);
}

function firstDirectText(source: string, node: PythonSyntaxNode, name: string): string | undefined {
  const child = directChild(node, name);
  return child ? nodeText(source, child) : undefined;
}

function enclosingNode(node: PythonSyntaxNode, name: string): PythonSyntaxNode | undefined {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.name === name) {
      return parent;
    }
  }

  return undefined;
}

function belongsToFunction(node: PythonSyntaxNode, functionNode: PythonSyntaxNode): boolean {
  return enclosingNode(node, "FunctionDefinition") === functionNode;
}

function lineStarts(source: string): number[] {
  const starts = [0];

  for (let index = source.indexOf("\n"); index >= 0; index = source.indexOf("\n", index + 1)) {
    starts.push(index + 1);
  }

  return starts;
}

function lineAt(starts: number[], offset: number): number {
  let lower = 0;
  let upper = starts.length - 1;

  while (lower <= upper) {
    const middle = Math.floor((lower + upper) / 2);

    if (starts[middle] <= offset) {
      lower = middle + 1;
    } else {
      upper = middle - 1;
    }
  }

  return upper + 1;
}

function splitCommaSeparated(value: string): string[] {
  const entries: string[] = [];
  let depth = 0;
  let quote = "";
  let escaped = false;
  let start = 0;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = "";
      }

      continue;
    }

    if (character === "'" || character === "\"") {
      quote = character;
      continue;
    }

    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
    } else if (character === ")" || character === "]" || character === "}") {
      depth = Math.max(0, depth - 1);
    } else if (character === "," && depth === 0) {
      entries.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }

  entries.push(value.slice(start).trim());
  return entries.filter(Boolean);
}

function parseAliasedNames(value: string): PythonImportName[] {
  const unwrapped = value.trim().replace(/^\(/, "").replace(/\)$/, "");

  return splitCommaSeparated(unwrapped).flatMap((entry) => {
    if (entry === "*") {
      return [{ name: "*" }];
    }

    const match = entry.match(/^([A-Za-z_][\w.]*)\s*(?:as\s+([A-Za-z_]\w*))?$/);
    return match ? [{ name: match[1], ...(match[2] ? { alias: match[2] } : {}) }] : [];
  });
}

function parseImportStatement(source: string, node: PythonSyntaxNode): PythonImportStatement | null {
  const normalized = nodeText(source, node)
    .replace(/\\\r?\n/g, " ")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const directImport = normalized.match(/^import\s+(.+)$/);

  if (directImport) {
    return {
      kind: "import",
      moduleName: "",
      relativeLevel: 0,
      names: parseAliasedNames(directImport[1])
    };
  }

  const fromImport = normalized.match(/^from\s+([.\w]+)\s+import\s+(.+)$/);
  if (!fromImport) {
    return null;
  }

  const leadingDots = fromImport[1].match(/^\.+/)?.[0].length ?? 0;
  return {
    kind: "from",
    moduleName: fromImport[1].slice(leadingDots),
    relativeLevel: leadingDots,
    names: parseAliasedNames(fromImport[2])
  };
}

function moduleBasePath(sourcePath: string, moduleName: string, relativeLevel: number): string {
  const moduleSuffix = moduleName.replace(/\./g, "/");

  if (relativeLevel === 0) {
    return moduleSuffix;
  }

  let directory = path.posix.dirname(sourcePath);
  directory = directory === "." ? "" : directory;

  for (let level = 1; level < relativeLevel; level += 1) {
    directory = path.posix.dirname(directory);
    directory = directory === "." ? "" : directory;
  }

  return directory && moduleSuffix ? `${directory}/${moduleSuffix}` : directory || moduleSuffix;
}

function resolvePythonModule(
  sourcePath: string,
  moduleName: string,
  relativeLevel: number,
  files: Set<string>
): string | null {
  const basePath = moduleBasePath(sourcePath, moduleName, relativeLevel);
  const candidates = basePath
    ? [`${basePath}.py`, `${basePath}/__init__.py`]
    : ["__init__.py"];

  return candidates.find((candidate) => files.has(candidate)) ?? null;
}

function importedBindings(
  sourcePath: string,
  source: string,
  root: PythonSyntaxNode,
  files: Set<string>
): { importPaths: string[]; bindings: Map<string, PythonBinding> } {
  const importPaths = new Set<string>();
  const bindings = new Map<string, PythonBinding>();

  for (const statementNode of descendantNodes(root, "ImportStatement")) {
    const statement = parseImportStatement(source, statementNode);

    if (!statement) {
      continue;
    }

    const isTopLevel = !enclosingNode(statementNode, "FunctionDefinition");

    if (statement.kind === "import") {
      for (const imported of statement.names) {
        const definitionPath = resolvePythonModule(sourcePath, imported.name, 0, files);
        if (!definitionPath) {
          continue;
        }

        importPaths.add(definitionPath);
        if (isTopLevel) {
          bindings.set(imported.alias ?? imported.name, {
            localName: imported.alias ?? imported.name,
            definitionPath,
            namespace: true
          });
        }
      }

      continue;
    }

    const baseDefinitionPath = resolvePythonModule(
      sourcePath,
      statement.moduleName,
      statement.relativeLevel,
      files
    );

    if (baseDefinitionPath) {
      importPaths.add(baseDefinitionPath);
    }

    for (const imported of statement.names) {
      if (imported.name === "*") {
        continue;
      }

      const importedModuleName = statement.moduleName
        ? `${statement.moduleName}.${imported.name}`
        : imported.name;
      const importedSubmodulePath = resolvePythonModule(
        sourcePath,
        importedModuleName,
        statement.relativeLevel,
        files
      );
      const definitionPath = importedSubmodulePath ?? baseDefinitionPath;

      if (!definitionPath) {
        continue;
      }

      if (importedSubmodulePath) {
        importPaths.add(importedSubmodulePath);
      }

      if (isTopLevel) {
        bindings.set(imported.alias ?? imported.name, {
          localName: imported.alias ?? imported.name,
          definitionPath,
          ...(importedSubmodulePath ? {} : { definitionName: imported.name }),
          namespace: Boolean(importedSubmodulePath)
        });
      }
    }
  }

  return { importPaths: [...importPaths].sort(), bindings };
}

function classOwner(node: PythonSyntaxNode): PythonSyntaxNode | undefined {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.name === "FunctionDefinition") {
      return undefined;
    }

    if (parent.name === "ClassDefinition") {
      return parent;
    }
  }

  return undefined;
}

function waypointNodes(source: string, root: PythonSyntaxNode): PythonWaypointNode[] {
  return descendantNodes(root, "FunctionDefinition").flatMap((node) => {
    const name = firstDirectText(source, node, "VariableName");
    if (!name) {
      return [];
    }

    const classNode = classOwner(node);
    const className = classNode ? firstDirectText(source, classNode, "VariableName") : undefined;
    const hasEnclosingFunction = Boolean(enclosingNode(node, "FunctionDefinition"));

    return [{
      node,
      name,
      kind: classNode ? "method" : "function",
      ...(className ? { className } : {}),
      isAsync: childNodes(node).some((child) => child.name === "async"),
      isPublic: !hasEnclosingFunction && !name.startsWith("_") && !className?.startsWith("_"),
      isModuleLevel: !hasEnclosingFunction && !classNode
    }];
  });
}

function inputsFor(source: string, node: PythonSyntaxNode, starts: number[]): FunctionInput[] {
  const parameters = directChild(node, "ParamList");
  if (!parameters) {
    return [];
  }

  const text = nodeText(source, parameters).slice(1, -1);
  return splitCommaSeparated(text).flatMap((entry) => {
    if (entry === "*" || entry === "/") {
      return [];
    }

    const match = entry.match(/^\s*\*{0,2}\s*([A-Za-z_]\w*)\s*(?::\s*([^=]+?))?\s*(?:=.*)?$/s);
    if (!match) {
      return [];
    }

    const sourceOffset = source.indexOf(match[1], parameters.from);
    const type = match[2]?.trim();

    return [{
      name: match[1],
      line: lineAt(starts, sourceOffset >= 0 ? sourceOffset : parameters.from),
      ...(type ? { type } : {})
    }];
  });
}

function returnTypeFor(source: string, node: PythonSyntaxNode): string | undefined {
  const returnType = directChild(node, "TypeDef");
  const type = returnType ? nodeText(source, returnType).replace(/^\s*->\s*/, "").trim() : "";
  return type || undefined;
}

function outputsFor(
  source: string,
  node: PythonSyntaxNode,
  starts: number[],
  isAsync: boolean
): FunctionOutput[] {
  const type = returnTypeFor(source, node);

  return descendantNodes(node, "ReturnStatement")
    .filter((statement) => belongsToFunction(statement, node))
    .map((statement) => {
      const expression = nodeText(source, statement).replace(/^\s*return\b\s*/, "").trim() || "None";

      return {
        line: lineAt(starts, statement.from),
        expression,
        ...(type ? { type } : {}),
        async: isAsync
      };
    });
}

function targetForCall(
  name: string,
  sourcePath: string,
  bindings: Map<string, PythonBinding>,
  localTargets: Map<string, Pick<FunctionCall, "definitionName" | "definitionWaypointId">>,
  currentWaypoint: ResolvedPythonWaypointNode,
  methodTargets: Map<string, Pick<FunctionCall, "definitionName" | "definitionWaypointId">>
): Pick<FunctionCall, "definitionPath" | "definitionName" | "definitionWaypointId"> | undefined {
  const methodName = name.match(/^(?:self|cls)\.([A-Za-z_]\w*)$/)?.[1];
  const methodTarget = methodName && currentWaypoint.className
    ? methodTargets.get(`${currentWaypoint.className}:${methodName}`)
    : undefined;
  if (methodTarget) {
    return { definitionPath: sourcePath, ...methodTarget };
  }

  const localTarget = localTargets.get(name);
  if (localTarget) {
    return { definitionPath: sourcePath, ...localTarget };
  }

  const directBinding = bindings.get(name);
  if (directBinding && !directBinding.namespace && directBinding.definitionName) {
    return {
      definitionPath: directBinding.definitionPath,
      definitionName: directBinding.definitionName
    };
  }

  for (const binding of bindings.values()) {
    if (binding.namespace && name.startsWith(`${binding.localName}.`)) {
      const definitionName = name.split(".").at(-1);
      return definitionName
        ? { definitionPath: binding.definitionPath, definitionName }
        : undefined;
    }
  }

  return undefined;
}

function callsFor(
  source: string,
  sourcePath: string,
  waypoint: ResolvedPythonWaypointNode,
  starts: number[],
  bindings: Map<string, PythonBinding>,
  localTargets: Map<string, Pick<FunctionCall, "definitionName" | "definitionWaypointId">>,
  methodTargets: Map<string, Pick<FunctionCall, "definitionName" | "definitionWaypointId">>
): FunctionCall[] {
  return descendantNodes(waypoint.node, "CallExpression")
    .filter((call) => belongsToFunction(call, waypoint.node))
    .flatMap((call) => {
      const expression = childNodes(call)[0];
      const argumentsNode = directChild(call, "ArgList");
      if (!expression || !argumentsNode) {
        return [];
      }

      const name = nodeText(source, expression);
      const argumentsText = nodeText(source, argumentsNode).slice(1, -1);
      const target = targetForCall(name, sourcePath, bindings, localTargets, waypoint, methodTargets);

      return [{
        connectionKind: "call",
        name,
        line: lineAt(starts, call.from),
        arguments: splitCommaSeparated(argumentsText),
        ...(target ?? {})
      }];
    });
}

function isPackageGateway(sourcePath: string, root: PythonSyntaxNode): boolean {
  if (path.posix.basename(sourcePath) !== "__init__.py") {
    return false;
  }

  const statements = childNodes(root).filter((node) => node.name !== "Comment");
  return statements.length > 0 && statements.every((statement) => statement.name === "ImportStatement");
}

function sortedLines(lines: Iterable<number>): number[] {
  return [...new Set(lines)].sort((left, right) => left - right);
}

function sameSyntaxNode(left: PythonSyntaxNode | undefined, right: PythonSyntaxNode | undefined): boolean {
  return Boolean(left && right && left.from === right.from && left.to === right.to && left.name === right.name);
}

function inVariableScope(
  node: PythonSyntaxNode,
  owner: PythonSyntaxNode | undefined,
  name: string,
  declarations: PythonVariableDeclaration[]
): boolean {
  const enclosingFunction = enclosingNode(node, "FunctionDefinition");
  if (owner) {
    return sameSyntaxNode(enclosingFunction, owner);
  }

  if (!enclosingFunction) {
    return true;
  }

  return !declarations.some(
    (declaration) =>
      declaration.name === name &&
      sameSyntaxNode(declaration.owner, enclosingFunction)
  );
}

function isPythonConditionReference(node: PythonSyntaxNode): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.name === "IfStatement" || parent.name === "WhileStatement" || parent.name === "ForStatement") {
      const body = directChild(parent, "Body");
      return !body || node.to <= body.from;
    }
  }

  return false;
}

function isPythonArgumentReference(node: PythonSyntaxNode): boolean {
  return Boolean(enclosingNode(node, "ArgList") && enclosingNode(node, "CallExpression"));
}

function pythonVariableWaypoints(
  source: string,
  root: PythonSyntaxNode,
  starts: number[]
): VariableWaypoint[] {
  const declarations: PythonVariableDeclaration[] = [
    ...descendantNodes(root, "AssignStatement").flatMap((node): PythonVariableDeclaration[] => {
      const nameNode = childNodes(node).find((child) => child.name === "VariableName");
      if (!nameNode) {
        return [];
      }

      return [{
        name: nodeText(source, nameNode),
        node,
        nameNode,
        kind: "assignment",
        owner: enclosingNode(node, "FunctionDefinition")
      }];
    }),
    ...descendantNodes(root, "ForStatement").flatMap((node): PythonVariableDeclaration[] => {
      const nameNode = childNodes(node).find((child) => child.name === "VariableName");
      if (!nameNode) {
        return [];
      }

      return [{
        name: nodeText(source, nameNode),
        node,
        nameNode,
        kind: "iterator",
        owner: enclosingNode(node, "FunctionDefinition")
      }];
    })
  ].sort((left, right) => left.node.from - right.node.from);
  const grouped = new Map<string, { declaration: PythonVariableDeclaration; mutationLines: number[]; declarationOffsets: Set<number> }>();

  for (const declaration of declarations) {
    const ownerIdentity = declaration.owner?.from ?? -1;
    const key = `${ownerIdentity}:${declaration.name}`;
    const existing = grouped.get(key);

    if (existing) {
      existing.mutationLines.push(lineAt(starts, declaration.node.from));
      existing.declarationOffsets.add(declaration.nameNode.from);
    } else {
      grouped.set(key, {
        declaration,
        mutationLines: [],
        declarationOffsets: new Set([declaration.nameNode.from])
      });
    }
  }

  const allNames = descendantNodes(root, "VariableName");
  return [...grouped.values()].map(({ declaration, mutationLines, declarationOffsets }) => {
    const references = allNames.filter(
      (node) =>
        nodeText(source, node) === declaration.name &&
        inVariableScope(node, declaration.owner, declaration.name, declarations) &&
        !declarationOffsets.has(node.from) &&
        node.parent?.name !== "FunctionDefinition" &&
        node.parent?.name !== "ClassDefinition"
    );
    const declarationLine = lineAt(starts, declaration.node.from);

    return {
      variableId: `${declaration.kind}:${declarationLine}:${declaration.name}`,
      name: declaration.name,
      declarationLine,
      declarationKind: declaration.kind,
      usageLines: sortedLines(references.map((reference) => lineAt(starts, reference.from))),
      mutationLines: sortedLines(mutationLines),
      conditionLines: sortedLines(
        references
          .filter(isPythonConditionReference)
          .map((reference) => lineAt(starts, reference.from))
      ),
      renderingLines: [],
      helperCallLines: sortedLines(
        references
          .filter(isPythonArgumentReference)
          .map((reference) => lineAt(starts, reference.from))
      ),
      runtimeRelated: OPERATIONAL_VARIABLE_NAME_PATTERN.test(declaration.name)
    };
  }).sort((left, right) => left.declarationLine - right.declarationLine || left.name.localeCompare(right.name));
}

export function extractPython(
  sourcePath: string,
  source: string,
  files: Set<string>
): PythonExtraction {
  const root = pythonParser.parse(source).topNode;
  const starts = lineStarts(source);
  const resolvedImports = importedBindings(sourcePath, source, root, files);
  const nodes: ResolvedPythonWaypointNode[] = waypointNodes(source, root).map((waypoint) => {
    const startLine = lineAt(starts, waypoint.node.from);
    const endLine = lineAt(starts, Math.max(waypoint.node.from, waypoint.node.to - 1));

    return {
      ...waypoint,
      waypointId: `${waypoint.kind}:${startLine}:${endLine}:${waypoint.name}`,
      startLine,
      endLine
    };
  });
  const countsByName = new Map<string, number>();

  for (const waypoint of nodes) {
    countsByName.set(waypoint.name, (countsByName.get(waypoint.name) ?? 0) + 1);
  }

  const localTargets = new Map(
    nodes
      .filter((waypoint) => waypoint.isModuleLevel && countsByName.get(waypoint.name) === 1)
      .map((waypoint) => [waypoint.name, {
        definitionName: waypoint.name,
        definitionWaypointId: waypoint.waypointId
      }])
  );
  const methodTargets = new Map(
    nodes
      .filter((waypoint) => Boolean(waypoint.className))
      .map((waypoint) => [`${waypoint.className}:${waypoint.name}`, {
        definitionName: waypoint.name,
        definitionWaypointId: waypoint.waypointId
      }])
  );
  const functionWaypoints = nodes
    .map((waypoint) => {
      const complexity = functionComplexityFor(waypoint.node);

      return {
        waypointId: waypoint.waypointId,
        name: waypoint.name,
        kind: waypoint.kind,
        startLine: waypoint.startLine,
        endLine: waypoint.endLine,
        exported: false,
        public: waypoint.isPublic,
        exportNames: waypoint.isModuleLevel ? [waypoint.name] : [],
        cyclomaticComplexity: complexity.cyclomaticComplexity,
        cognitiveComplexity: complexity.cognitiveComplexity,
        duplicateOf: null,
        duplicateGroup: null,
        inputs: inputsFor(source, waypoint.node, starts),
        outputs: outputsFor(source, waypoint.node, starts, waypoint.isAsync),
        calls: callsFor(source, sourcePath, waypoint, starts, resolvedImports.bindings, localTargets, methodTargets),
        stateUpdates: []
      };
    })
    .sort((left, right) => left.startLine - right.startLine || left.name.localeCompare(right.name));

  return {
    functionCount: nodes.length,
    functionWaypoints,
    variableWaypoints: pythonVariableWaypoints(source, root, starts),
    importPaths: resolvedImports.importPaths,
    isPackageGateway: isPackageGateway(sourcePath, root)
  };
}
