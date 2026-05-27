import fs from "node:fs/promises";
import path from "node:path";
import { Node, Project, SourceFile, SyntaxKind, type Node as MorphNode } from "ts-morph";
import { buildGraph } from "./buildGraph.js";
import type {
  CompressionReason,
  ExtractedFileMetadata,
  ExtractedStructure,
  FunctionCall,
  FunctionInput,
  FunctionOutput,
  FunctionStateUpdate,
  FunctionWaypoint,
  FunctionWaypointKind,
  GraphJson
} from "./types.js";

const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  "build",
  ".next",
  "coverage",
  ".git"
]);

const IMPORT_PARSE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"]);
const STRUCTURAL_FILE_EXTENSIONS = new Set([
  ...IMPORT_PARSE_EXTENSIONS,
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".html",
  ".json",
  ".md",
  ".mdx",
  ".yml",
  ".yaml",
  ".toml",
  ".xml",
  ".svg",
  ".txt",
  ".ps1",
  ".sh"
]);
const RESOLUTION_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs", ".json"];
const INDEX_FILES = RESOLUTION_EXTENSIONS.map((extension) => `index${extension}`);
const CONVENTIONAL_LOW_SIGNAL_NAMES = new Set(["index", "types", "constants", "config"]);
const TINY_WRAPPER_NAME_PATTERN = /(?:util|utils|helper|helpers|wrapper|adapter)$/i;
const FUNCTION_LIKE_KINDS = [
  SyntaxKind.FunctionDeclaration,
  SyntaxKind.FunctionExpression,
  SyntaxKind.ArrowFunction,
  SyntaxKind.MethodDeclaration,
  SyntaxKind.GetAccessor,
  SyntaxKind.SetAccessor,
  SyntaxKind.Constructor
];

interface CallTarget {
  definitionPath: string;
  definitionName: string;
}

interface ImportedCallTargets {
  bindings: Map<string, CallTarget>;
  namespaces: Map<string, string>;
}

interface WaypointNode {
  node: MorphNode;
  identity: {
    name: string;
    kind: FunctionWaypointKind;
  };
}

function countLinesOfCode(contents: string): number {
  return contents.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
}

function countFunctions(sourceFile: SourceFile): number {
  return FUNCTION_LIKE_KINDS.reduce(
    (total, kind) => total + sourceFile.getDescendantsOfKind(kind).length,
    0
  );
}

function contextualFunctionName(
  node: MorphNode,
  kind: "function" | "arrow"
): { name: string; kind: FunctionWaypointKind } | null {
  const parent = node.getParent();

  if (Node.isVariableDeclaration(parent)) {
    return { name: parent.getName(), kind };
  }

  if (Node.isPropertyAssignment(parent)) {
    return { name: parent.getName(), kind };
  }

  if (Node.isExportAssignment(parent)) {
    return { name: "default export", kind };
  }

  const callee = Node.isCallExpression(parent) ? parent.getExpression().getText() : undefined;
  if (callee && /^(?:React\.)?use(?:Effect|LayoutEffect)$/.test(callee)) {
    return { name: `${callee} callback`, kind: "effect" };
  }

  return null;
}

function waypointIdentity(node: MorphNode): { name: string; kind: FunctionWaypointKind } | null {
  if (Node.isFunctionDeclaration(node) || Node.isFunctionExpression(node)) {
    const name = node.getName();

    return name
      ? { name, kind: "function" }
      : Node.isFunctionDeclaration(node) && node.isDefaultExport()
        ? { name: "default export", kind: "function" }
        : contextualFunctionName(node, "function");
  }

  if (Node.isArrowFunction(node)) {
    return contextualFunctionName(node, "arrow");
  }

  if (Node.isMethodDeclaration(node)) {
    return { name: node.getName(), kind: "method" };
  }

  if (Node.isGetAccessorDeclaration(node) || Node.isSetAccessorDeclaration(node)) {
    return { name: node.getName(), kind: "accessor" };
  }

  if (Node.isConstructorDeclaration(node)) {
    return { name: "constructor", kind: "constructor" };
  }

  return null;
}

function isExportedWaypoint(node: MorphNode): boolean {
  if (Node.isFunctionDeclaration(node)) {
    return node.isExported();
  }

  if (Node.isExportAssignment(node.getParent())) {
    return true;
  }

  const statement = node.getFirstAncestorByKind(SyntaxKind.VariableStatement);
  return statement?.isExported() ?? false;
}

function observableType(text: string | undefined): string | undefined {
  const normalized = text?.trim();
  return normalized && normalized !== "any" && normalized !== "unknown" ? normalized : undefined;
}

function inferredTypeFor(node: MorphNode & { getTypeNode(): { getText(): string } | undefined; getType(): { getText(node: MorphNode): string } }): string | undefined {
  return observableType(node.getTypeNode()?.getText() ?? node.getType().getText(node));
}

function belongsToWaypoint(descendant: MorphNode, waypoint: MorphNode): boolean {
  return descendant.getFirstAncestor((ancestor) => Node.isFunctionLikeDeclaration(ancestor)) === waypoint;
}

function isAsyncWaypoint(node: MorphNode): boolean {
  return (
    Node.isFunctionDeclaration(node) ||
    Node.isFunctionExpression(node) ||
    Node.isArrowFunction(node) ||
    Node.isMethodDeclaration(node)
  ) && node.isAsync();
}

function inputsFor(node: MorphNode): FunctionInput[] {
  if (!Node.isFunctionLikeDeclaration(node)) {
    return [];
  }

  return node.getParameters().map((parameter) => ({
    name: parameter.getName(),
    line: parameter.getStartLineNumber(),
    type: inferredTypeFor(parameter)
  }));
}

function returnTypeFor(node: MorphNode): string | undefined {
  if (
    Node.isFunctionDeclaration(node) ||
    Node.isFunctionExpression(node) ||
    Node.isArrowFunction(node) ||
    Node.isMethodDeclaration(node) ||
    Node.isGetAccessorDeclaration(node)
  ) {
    return observableType(node.getReturnTypeNode()?.getText() ?? node.getReturnType().getText(node));
  }

  return undefined;
}

function outputsFor(node: MorphNode): FunctionOutput[] {
  if (!Node.isFunctionLikeDeclaration(node) || Node.isConstructorDeclaration(node)) {
    return [];
  }

  const type = returnTypeFor(node);
  const isAsync = isAsyncWaypoint(node);
  const returns = node
    .getDescendantsOfKind(SyntaxKind.ReturnStatement)
    .filter((statement) => belongsToWaypoint(statement, node))
    .map((statement) => ({
      line: statement.getStartLineNumber(),
      expression: statement.getExpression()?.getText() ?? "void",
      type,
      async: isAsync
    }));

  if (Node.isArrowFunction(node) && node.getBody().getKind() !== SyntaxKind.Block) {
    returns.push({
      line: node.getBody().getStartLineNumber(),
      expression: node.getBody().getText(),
      type,
      async: isAsync
    });
  }

  return returns;
}

function importDeclarationForDefinition(node: MorphNode): MorphNode | undefined {
  return node.getFirstAncestorByKind(SyntaxKind.ImportDeclaration);
}

function definitionMatchesImportTarget(
  definition: MorphNode,
  call: MorphNode,
  target: CallTarget
): boolean {
  if (importDeclarationForDefinition(definition)) {
    return true;
  }

  const definitionPath = definition.getSourceFile().getFilePath().split(path.sep).join(path.posix.sep);
  return (
    definition.getSourceFile() !== call.getSourceFile() &&
    definitionPath.endsWith(`/${target.definitionPath}`)
  );
}

function definitionOwnerForWaypoint(waypoint: WaypointNode): MorphNode {
  const parent = waypoint.node.getParent();

  if (
    (Node.isArrowFunction(waypoint.node) || Node.isFunctionExpression(waypoint.node)) &&
    Node.isVariableDeclaration(parent)
  ) {
    return parent;
  }

  return waypoint.node;
}

function definitionMatchesWaypoint(definition: MorphNode, waypoint: WaypointNode): boolean {
  const owner = definitionOwnerForWaypoint(waypoint);
  return (
    definition === owner ||
    definition === waypoint.node ||
    Boolean(definition.getFirstAncestor((ancestor) => ancestor === owner || ancestor === waypoint.node))
  );
}

function targetForCall(
  call: MorphNode,
  sourcePath: string,
  imports: ImportedCallTargets,
  localWaypoints: WaypointNode[]
): CallTarget | undefined {
  if (!Node.isCallExpression(call)) {
    return undefined;
  }

  const expression = call.getExpression();

  if (Node.isIdentifier(expression)) {
    const importedTarget = imports.bindings.get(expression.getText());
    if (
      importedTarget &&
      expression
        .getDefinitionNodes()
        .some((definition) => definitionMatchesImportTarget(definition, call, importedTarget))
    ) {
      return importedTarget;
    }

    const localTargets = localWaypoints.filter(
      (waypoint) =>
        waypoint.identity.name === expression.getText() &&
        expression
      .getDefinitionNodes()
          .some((definition) => definitionMatchesWaypoint(definition, waypoint))
    );

    return localTargets.length === 1
      ? { definitionPath: sourcePath, definitionName: localTargets[0].identity.name }
      : undefined;
  }

  if (Node.isPropertyAccessExpression(expression)) {
    const owner = expression.getExpression();
    if (!Node.isIdentifier(owner)) {
      return undefined;
    }

    const definitionPath = imports.namespaces.get(owner.getText());
    if (!definitionPath) {
      return undefined;
    }
    const target = { definitionPath, definitionName: expression.getName() };
    const hasNamespaceDefinition = owner
      .getDefinitionNodes()
      .some((definition) => definitionMatchesImportTarget(definition, call, target));

    return hasNamespaceDefinition ? target : undefined;
  }

  return undefined;
}

function callsFor(
  node: MorphNode,
  sourcePath: string,
  imports: ImportedCallTargets,
  localWaypoints: WaypointNode[]
): FunctionCall[] {
  if (!Node.isFunctionLikeDeclaration(node)) {
    return [];
  }

  return node
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter((call) => belongsToWaypoint(call, node))
    .map((call) => {
      const target = targetForCall(call, sourcePath, imports, localWaypoints);

      return {
        name: call.getExpression().getText(),
        line: call.getStartLineNumber(),
        arguments: call.getArguments().map((argument) => argument.getText()),
        ...(target ?? {})
      };
    });
}

function stateUpdateForCall(call: MorphNode): FunctionStateUpdate | null {
  if (!Node.isCallExpression(call)) {
    return null;
  }

  const expression = call.getExpression();
  if (!Node.isIdentifier(expression)) {
    return null;
  }

  for (const definition of expression.getDefinitionNodes()) {
    const binding = Node.isBindingElement(definition)
      ? definition
      : definition.getFirstAncestorByKind(SyntaxKind.BindingElement);
    const pattern = binding?.getParent();

    if (!binding || !Node.isArrayBindingPattern(pattern)) {
      continue;
    }

    const elements = pattern.getElements();
    if (elements[1] !== binding) {
      continue;
    }

    const declaration = pattern.getParent();
    if (!Node.isVariableDeclaration(declaration)) {
      continue;
    }

    const initializer = declaration.getInitializer();
    if (
      !Node.isCallExpression(initializer) ||
      !/^(?:React\.)?useState$/.test(initializer.getExpression().getText())
    ) {
      continue;
    }

    const state = elements[0]?.getText().trim();
    if (!state) {
      continue;
    }

    return {
      state,
      setter: expression.getText(),
      line: call.getStartLineNumber(),
      arguments: call.getArguments().map((argument) => argument.getText())
    };
  }

  return null;
}

function stateUpdatesFor(node: MorphNode): FunctionStateUpdate[] {
  if (!Node.isFunctionLikeDeclaration(node)) {
    return [];
  }

  return node
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter((call) => belongsToWaypoint(call, node))
    .flatMap((call) => {
      const update = stateUpdateForCall(call);
      return update ? [update] : [];
    });
}

function functionWaypoints(sourceFile: SourceFile, sourcePath: string, imports: ImportedCallTargets): FunctionWaypoint[] {
  const waypointNodes: WaypointNode[] = FUNCTION_LIKE_KINDS.flatMap((kind) => sourceFile.getDescendantsOfKind(kind))
    .flatMap((node): WaypointNode[] => {
      const identity = waypointIdentity(node);

      if (!identity) {
        return [];
      }

      return [{ node, identity }];
    });

  return waypointNodes
    .map(({ node, identity }) => ({
        ...identity,
        startLine: node.getStartLineNumber(),
        endLine: node.getEndLineNumber(),
        exported: isExportedWaypoint(node),
        inputs: inputsFor(node),
        outputs: outputsFor(node),
        calls: callsFor(node, sourcePath, imports, waypointNodes),
        stateUpdates: stateUpdatesFor(node)
      }))
    .sort((a, b) => a.startLine - b.startLine || a.name.localeCompare(b.name));
}

function isPassThroughExportFile(sourceFile: SourceFile): boolean {
  const statements = sourceFile
    .getStatements()
    .filter((statement) => statement.getKind() !== SyntaxKind.EmptyStatement);

  return statements.length > 0 && statements.every((statement) => statement.getKind() === SyntaxKind.ExportDeclaration);
}

function classifyCompression(
  filePath: string,
  metadata: ExtractedFileMetadata,
  sourceFile?: SourceFile
): CompressionReason[] {
  const reasons: CompressionReason[] = [];

  if (metadata.linesOfCode <= 8) {
    reasons.push("very-low-loc");
  }

  if (!sourceFile) {
    return reasons;
  }

  const fileName = path.posix.parse(filePath).name.toLowerCase();
  const functionCount = metadata.functionCount ?? 0;
  if (
    TINY_WRAPPER_NAME_PATTERN.test(fileName) &&
    metadata.linesOfCode <= 32 &&
    functionCount <= 1
  ) {
    reasons.push("tiny-wrapper");
  }

  if (
    CONVENTIONAL_LOW_SIGNAL_NAMES.has(fileName) &&
    metadata.linesOfCode <= 160 &&
    functionCount <= 1
  ) {
    reasons.push("conventional-support-file");
  }

  if (isPassThroughExportFile(sourceFile)) {
    reasons.push("pass-through-export");
  }

  return [...new Set(reasons)];
}

function toPosixRelative(repoRoot: string, absolutePath: string): string {
  const relativePath = path.relative(repoRoot, absolutePath);
  return relativePath.split(path.sep).join(path.posix.sep);
}

function addParentFolders(structure: ExtractedStructure, filePath: string): void {
  const parts = filePath.split(path.posix.sep);
  parts.pop();

  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    structure.folders.add(current);
  }
}

async function pathExists(candidatePath: string): Promise<boolean> {
  try {
    await fs.access(candidatePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveImportPath(repoRoot: string, sourceFilePath: string, specifier: string): Promise<string | null> {
  if (!specifier.startsWith(".")) {
    return null;
  }

  const sourceDirectory = path.dirname(sourceFilePath);
  const basePath = path.resolve(sourceDirectory, specifier);
  const candidates = [
    basePath,
    ...RESOLUTION_EXTENSIONS.map((extension) => `${basePath}${extension}`),
    ...INDEX_FILES.map((indexFile) => path.join(basePath, indexFile))
  ];

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      const stats = await fs.stat(candidate);
      if (stats.isFile()) {
        return toPosixRelative(repoRoot, candidate);
      }
    }
  }

  return null;
}

async function importedCallTargets(repoRoot: string, sourceFile: SourceFile): Promise<ImportedCallTargets> {
  const bindings = new Map<string, CallTarget>();
  const namespaces = new Map<string, string>();

  for (const declaration of sourceFile.getImportDeclarations()) {
    const definitionPath = await resolveImportPath(
      repoRoot,
      sourceFile.getFilePath(),
      declaration.getModuleSpecifierValue()
    );

    if (!definitionPath) {
      continue;
    }

    const defaultImport = declaration.getDefaultImport();
    if (defaultImport) {
      bindings.set(defaultImport.getText(), { definitionPath, definitionName: "default export" });
    }

    for (const namedImport of declaration.getNamedImports()) {
      const localName = namedImport.getAliasNode()?.getText() ?? namedImport.getName();
      bindings.set(localName, { definitionPath, definitionName: namedImport.getName() });
    }

    const namespaceImport = declaration.getNamespaceImport();
    if (namespaceImport) {
      namespaces.set(namespaceImport.getText(), definitionPath);
    }
  }

  return { bindings, namespaces };
}

async function walkRepo(directory: string, repoRoot: string, structure: ExtractedStructure): Promise<void> {
  const entries = await fs.readdir(directory, { withFileTypes: true });

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) {
      continue;
    }

    const absolutePath = path.join(directory, entry.name);
    const relativePath = toPosixRelative(repoRoot, absolutePath);

    if (entry.isDirectory()) {
      structure.folders.add(relativePath);
      await walkRepo(absolutePath, repoRoot, structure);
      continue;
    }

    if (entry.isFile() && STRUCTURAL_FILE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      const contents = await fs.readFile(absolutePath, "utf8");
      structure.files.add(relativePath);
      structure.fileMetadata.set(relativePath, {
        linesOfCode: countLinesOfCode(contents),
        sourceText: contents,
        compressionReasons: []
      });
      addParentFolders(structure, relativePath);
    }
  }
}

function getImportSpecifiers(sourceFile: SourceFile): string[] {
  const importDeclarations = sourceFile.getImportDeclarations().map((declaration) => declaration.getModuleSpecifierValue());
  const exportDeclarations = sourceFile
    .getExportDeclarations()
    .map((declaration) => declaration.getModuleSpecifierValue())
    .filter((specifier): specifier is string => Boolean(specifier));

  return [...importDeclarations, ...exportDeclarations];
}

function connectInputSources(structure: ExtractedStructure): void {
  const targets = new Map<string, FunctionWaypoint[]>();

  for (const [filePath, metadata] of structure.fileMetadata) {
    for (const waypoint of metadata.functionWaypoints ?? []) {
      const key = `${filePath}:${waypoint.name}`;
      const entries = targets.get(key) ?? [];
      entries.push(waypoint);
      targets.set(key, entries);
    }
  }

  for (const [filePath, metadata] of structure.fileMetadata) {
    for (const caller of metadata.functionWaypoints ?? []) {
      for (const call of caller.calls) {
        if (!call.definitionPath || !call.definitionName) {
          continue;
        }

        const targetCandidates = targets.get(`${call.definitionPath}:${call.definitionName}`) ?? [];
        if (targetCandidates.length !== 1) {
          continue;
        }

        const target = targetCandidates[0];
        target.inputs.forEach((input, index) => {
          const expression = call.arguments[index];
          if (expression === undefined) {
            return;
          }

          input.sources = [
            ...(input.sources ?? []),
            {
              filePath,
              functionName: caller.name,
              line: call.line,
              expression
            }
          ];
        });
      }
    }
  }
}

export async function extractGraph(repoRoot: string): Promise<GraphJson> {
  const structure: ExtractedStructure = {
    folders: new Set(),
    files: new Set(),
    fileMetadata: new Map(),
    imports: []
  };

  await walkRepo(repoRoot, repoRoot, structure);

  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
      allowJs: true,
      jsx: 1
    }
  });

  const filePaths = [...structure.files]
    .filter((filePath) => IMPORT_PARSE_EXTENSIONS.has(path.extname(filePath).toLowerCase()))
    .sort();
  const sourceFiles = filePaths.map((filePath) => project.addSourceFileAtPath(path.join(repoRoot, filePath)));
  const sourceFilesByPath = new Map<string, SourceFile>();
  const seenEdges = new Set<string>();

  for (const sourceFile of sourceFiles) {
    const sourcePath = toPosixRelative(repoRoot, sourceFile.getFilePath());
    const metadata = structure.fileMetadata.get(sourcePath);
    sourceFilesByPath.set(sourcePath, sourceFile);
    if (metadata) {
      metadata.functionCount = countFunctions(sourceFile);
      metadata.functionWaypoints = functionWaypoints(
        sourceFile,
        sourcePath,
        await importedCallTargets(repoRoot, sourceFile)
      );
    }
    const specifiers = getImportSpecifiers(sourceFile).sort();

    for (const specifier of specifiers) {
      const targetPath = await resolveImportPath(repoRoot, sourceFile.getFilePath(), specifier);
      if (!targetPath || !structure.files.has(targetPath)) {
        continue;
      }

      const edgeKey = `${sourcePath}->${targetPath}`;
      if (!seenEdges.has(edgeKey)) {
        seenEdges.add(edgeKey);
        structure.imports.push({ source: sourcePath, target: targetPath });
      }
    }
  }

  connectInputSources(structure);

  for (const filePath of structure.files) {
    const metadata = structure.fileMetadata.get(filePath);
    if (metadata) {
      metadata.compressionReasons = classifyCompression(filePath, metadata, sourceFilesByPath.get(filePath));
    }
  }

  return buildGraph(structure);
}
