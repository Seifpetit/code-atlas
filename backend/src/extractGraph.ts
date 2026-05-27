import fs from "node:fs/promises";
import path from "node:path";
import { Node, Project, SourceFile, SyntaxKind, type Node as MorphNode } from "ts-morph";
import { buildGraph } from "./buildGraph.js";
import { extractPython, type PythonExtraction } from "./extractPython.js";
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
  GraphJson,
  VariableDeclarationKind,
  VariableWaypoint
} from "./types.js";

const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  "build",
  ".next",
  "coverage",
  ".git",
  ".venv",
  "venv",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".tox"
]);

const IMPORT_PARSE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"]);
const PYTHON_PARSE_EXTENSIONS = new Set([".py"]);
const STRUCTURAL_FILE_EXTENSIONS = new Set([
  ...IMPORT_PARSE_EXTENSIONS,
  ...PYTHON_PARSE_EXTENSIONS,
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
const OPERATIONAL_VARIABLE_NAME_PATTERN = /(?:runtime|graph|node|focus|selected|context|corridor|xray|x-ray|position)/i;
const ASSIGNMENT_OPERATORS = new Set([
  "=",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "**=",
  "&&=",
  "||=",
  "??=",
  "<<=",
  ">>=",
  ">>>=",
  "&=",
  "|=",
  "^="
]);
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
  definitionWaypointId?: string;
  throughLazyComponent?: boolean;
}

interface ImportedCallTargets {
  bindings: Map<string, CallTarget>;
  namespaces: Map<string, string>;
}

interface WaypointNode {
  node: MorphNode;
  waypointId: string;
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

function waypointIdFor(identity: { name: string; kind: FunctionWaypointKind }, node: MorphNode): string {
  return `${identity.kind}:${node.getStartLineNumber()}:${node.getEndLineNumber()}:${identity.name}`;
}

function exportNamesForWaypoint(
  sourceFile: SourceFile,
  node: MorphNode,
  identity: { name: string; kind: FunctionWaypointKind }
): string[] {
  const exportNames = new Set<string>();

  if (Node.isFunctionDeclaration(node)) {
    if (node.isDefaultExport()) {
      exportNames.add("default");
    } else if (node.isExported()) {
      exportNames.add(identity.name);
    }
  }

  if (Node.isExportAssignment(node.getParent())) {
    exportNames.add("default");
  }

  const statement = node.getFirstAncestorByKind(SyntaxKind.VariableStatement);
  if (statement?.isExported()) {
    exportNames.add(identity.name);
  }

  for (const assignment of sourceFile.getExportAssignments()) {
    if (!assignment.isExportEquals() && assignment.getExpression()?.getText() === identity.name) {
      exportNames.add("default");
    }
  }

  for (const declaration of sourceFile.getExportDeclarations()) {
    if (declaration.getModuleSpecifierValue()) {
      continue;
    }

    for (const exported of declaration.getNamedExports()) {
      if (exported.getName() === identity.name) {
        exportNames.add(exported.getAliasNode()?.getText() ?? identity.name);
      }
    }
  }

  return [...exportNames].sort();
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

function belongsToVisibleWaypoint(
  descendant: MorphNode,
  waypoint: WaypointNode,
  localWaypoints: WaypointNode[]
): boolean {
  const owner = descendant.getFirstAncestor((ancestor) =>
    localWaypoints.some((candidate) => candidate.node === ancestor)
  );

  return owner === waypoint.node;
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
      ? {
          definitionPath: sourcePath,
          definitionName: localTargets[0].identity.name,
          definitionWaypointId: localTargets[0].waypointId
        }
      : undefined;
  }

  if (Node.isPropertyAccessExpression(expression)) {
    const localTargets = localWaypoints.filter(
      (waypoint) =>
        waypoint.identity.name === expression.getName() &&
        expression
          .getNameNode()
          .getDefinitionNodes()
          .some((definition) => definitionMatchesWaypoint(definition, waypoint))
    );

    if (localTargets.length === 1) {
      return {
        definitionPath: sourcePath,
        definitionName: localTargets[0].identity.name,
        definitionWaypointId: localTargets[0].waypointId
      };
    }

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

function targetForJsxElement(
  element: MorphNode,
  sourcePath: string,
  imports: ImportedCallTargets,
  localWaypoints: WaypointNode[]
): CallTarget | undefined {
  if (!Node.isJsxOpeningElement(element) && !Node.isJsxSelfClosingElement(element)) {
    return undefined;
  }

  const expression = element.getTagNameNode();

  if (Node.isIdentifier(expression)) {
    const importedTarget = imports.bindings.get(expression.getText());
    if (
      importedTarget &&
      (
        importedTarget.throughLazyComponent ||
        expression
          .getDefinitionNodes()
          .some((definition) => definitionMatchesImportTarget(definition, element, importedTarget))
      )
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
      ? {
          definitionPath: sourcePath,
          definitionName: localTargets[0].identity.name,
          definitionWaypointId: localTargets[0].waypointId
        }
      : undefined;
  }

  if (Node.isPropertyAccessExpression(expression)) {
    const owner = expression.getExpression();
    if (!Node.isIdentifier(owner)) {
      return undefined;
    }

    const definitionPath = imports.namespaces.get(owner.getText());
    return definitionPath
      ? { definitionPath, definitionName: expression.getName() }
      : undefined;
  }

  return undefined;
}

function callsFor(
  waypoint: WaypointNode,
  sourcePath: string,
  imports: ImportedCallTargets,
  localWaypoints: WaypointNode[]
): FunctionCall[] {
  const node = waypoint.node;
  if (!Node.isFunctionLikeDeclaration(node)) {
    return [];
  }

  return node
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter((call) => belongsToVisibleWaypoint(call, waypoint, localWaypoints))
    .map((call) => {
      const target = targetForCall(call, sourcePath, imports, localWaypoints);

      return {
        connectionKind: "call" as const,
        name: call.getExpression().getText(),
        line: call.getStartLineNumber(),
        arguments: call.getArguments().map((argument) => argument.getText()),
        ...(target ?? {})
      };
    });
}

function renderedComponentsFor(
  waypoint: WaypointNode,
  sourcePath: string,
  imports: ImportedCallTargets,
  localWaypoints: WaypointNode[]
): FunctionCall[] {
  const node = waypoint.node;
  if (!Node.isFunctionLikeDeclaration(node)) {
    return [];
  }

  const elements = [
    ...node.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
    ...node.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)
  ];

  return elements
    .filter((element) => belongsToVisibleWaypoint(element, waypoint, localWaypoints))
    .flatMap((element) => {
      const name = element.getTagNameNode().getText();
      if (!/^[A-Z]/.test(name)) {
        return [];
      }

      const target = targetForJsxElement(element, sourcePath, imports, localWaypoints);

      return [{
        connectionKind: "jsx-render",
        name,
        line: element.getStartLineNumber(),
        arguments: [],
        ...(target ?? {})
      }];
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

function sortedLines(lines: Iterable<number>): number[] {
  return [...new Set(lines)].sort((left, right) => left - right);
}

function containsNode(container: MorphNode, candidate: MorphNode): boolean {
  return candidate.getStart() >= container.getStart() && candidate.getEnd() <= container.getEnd();
}

function isConditionReference(reference: MorphNode): boolean {
  for (let ancestor = reference.getParent(); ancestor; ancestor = ancestor.getParent()) {
    const condition = Node.isIfStatement(ancestor) || Node.isWhileStatement(ancestor)
      ? ancestor.getExpression()
      : Node.isForStatement(ancestor)
        ? ancestor.getCondition()
        : Node.isConditionalExpression(ancestor)
          ? ancestor.getCondition()
          : undefined;

    if (condition && containsNode(condition, reference)) {
      return true;
    }
  }

  return false;
}

function isRenderingReference(reference: MorphNode): boolean {
  return Boolean(reference.getFirstAncestor((ancestor) => Node.isJsxExpression(ancestor)));
}

function isHelperArgumentReference(reference: MorphNode): boolean {
  const call = reference.getFirstAncestorByKind(SyntaxKind.CallExpression);
  return Boolean(call?.getArguments().some((argument) => containsNode(argument, reference)));
}

function isMutationReference(reference: MorphNode): boolean {
  const binary = reference.getFirstAncestorByKind(SyntaxKind.BinaryExpression);
  if (
    binary &&
    containsNode(binary.getLeft(), reference) &&
    ASSIGNMENT_OPERATORS.has(binary.getOperatorToken().getText())
  ) {
    return true;
  }

  const unary = reference.getParent();
  return Boolean(
    unary &&
    (unary.getKind() === SyntaxKind.PrefixUnaryExpression || unary.getKind() === SyntaxKind.PostfixUnaryExpression) &&
    /(?:\+\+|--)/.test(unary.getText())
  );
}

function declarationKindFor(
  declaration: ReturnType<SourceFile["getDescendantsOfKind"]>[number],
  initializer: MorphNode | undefined
): VariableDeclarationKind {
  if (initializer && Node.isCallExpression(initializer)) {
    const expression = initializer.getExpression().getText();
    if (/^(?:React\.)?useState$/.test(expression)) {
      return "state";
    }

    if (/^(?:React\.)?useRef$/.test(expression)) {
      return "ref";
    }
  }

  const declarationText = declaration
    .getFirstAncestorByKind(SyntaxKind.VariableDeclarationList)
    ?.getText() ?? "";
  const kind = declarationText.match(/^\s*(const|let|var)\b/)?.[1];
  return kind === "let" || kind === "var" ? kind : "const";
}

function variableWaypointsFor(sourceFile: SourceFile): VariableWaypoint[] {
  const stateMutationLines = new Map<string, number[]>();

  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const update = stateUpdateForCall(call);
    if (update) {
      const lines = stateMutationLines.get(update.state) ?? [];
      lines.push(update.line);
      stateMutationLines.set(update.state, lines);
    }
  }

  return sourceFile
    .getDescendantsOfKind(SyntaxKind.VariableDeclaration)
    .flatMap((declaration): VariableWaypoint[] => {
      const initializer = declaration.getInitializer();
      const kind = declarationKindFor(declaration, initializer);
      const nameNode = declaration.getNameNode();
      const bindings: Array<{ name: string; references: MorphNode[] }> = [];

      if (kind === "state" && Node.isArrayBindingPattern(nameNode)) {
        const stateBinding = nameNode.getElements()[0];
        if (!stateBinding || !Node.isBindingElement(stateBinding)) {
          return [];
        }

        bindings.push({
          name: stateBinding.getName(),
          references: stateBinding.findReferencesAsNodes()
        });
      } else if (Node.isIdentifier(nameNode)) {
        bindings.push({
          name: nameNode.getText(),
          references: declaration.findReferencesAsNodes()
        });
      } else if (Node.isArrayBindingPattern(nameNode) || Node.isObjectBindingPattern(nameNode)) {
        for (const binding of nameNode.getElements()) {
          if (Node.isBindingElement(binding) && Node.isIdentifier(binding.getNameNode())) {
            bindings.push({
              name: binding.getName(),
              references: binding.findReferencesAsNodes()
            });
          }
        }
      } else {
        return [];
      }

      const declarationLine = declaration.getStartLineNumber();
      return bindings.map(({ name, references }) => {
        const localReferences = references.filter((reference) => reference.getSourceFile() === sourceFile);
        const mutationLines = sortedLines([
          ...localReferences.filter(isMutationReference).map((reference) => reference.getStartLineNumber()),
          ...(kind === "state" ? stateMutationLines.get(name) ?? [] : [])
        ]);

        return {
          variableId: `${kind}:${declarationLine}:${name}`,
          name,
          declarationLine,
          declarationKind: kind,
          usageLines: sortedLines(localReferences.map((reference) => reference.getStartLineNumber())),
          mutationLines,
          conditionLines: sortedLines(
            localReferences.filter(isConditionReference).map((reference) => reference.getStartLineNumber())
          ),
          renderingLines: sortedLines(
            localReferences.filter(isRenderingReference).map((reference) => reference.getStartLineNumber())
          ),
          helperCallLines: sortedLines(
            localReferences.filter(isHelperArgumentReference).map((reference) => reference.getStartLineNumber())
          ),
          runtimeRelated: OPERATIONAL_VARIABLE_NAME_PATTERN.test(name)
        };
      });
    })
    .sort((left, right) => left.declarationLine - right.declarationLine || left.name.localeCompare(right.name));
}

function visibleWaypointNodesFor(sourceFile: SourceFile): WaypointNode[] {
  return FUNCTION_LIKE_KINDS.flatMap((kind) => sourceFile.getDescendantsOfKind(kind))
    .flatMap((node): WaypointNode[] => {
      const identity = waypointIdentity(node);

      if (!identity) {
        return [];
      }

      return [{ node, identity, waypointId: waypointIdFor(identity, node) }];
    });
}

function functionWaypoints(
  sourceFile: SourceFile,
  sourcePath: string,
  imports: ImportedCallTargets,
  waypointNodes: WaypointNode[]
): FunctionWaypoint[] {
  return waypointNodes
    .map((waypoint) => {
      const exportNames = exportNamesForWaypoint(sourceFile, waypoint.node, waypoint.identity);

      return {
        waypointId: waypoint.waypointId,
        name: waypoint.identity.name,
        kind: waypoint.identity.kind,
        startLine: waypoint.node.getStartLineNumber(),
        endLine: waypoint.node.getEndLineNumber(),
        exported: isExportedWaypoint(waypoint.node) || exportNames.length > 0,
        exportNames,
        inputs: inputsFor(waypoint.node),
        outputs: outputsFor(waypoint.node),
        calls: [...callsFor(waypoint, sourcePath, imports, waypointNodes), ...renderedComponentsFor(waypoint, sourcePath, imports, waypointNodes)]
          .sort((left, right) => left.line - right.line || left.name.localeCompare(right.name)),
        stateUpdates: stateUpdatesFor(waypoint.node)
      };
    })
    .sort((a, b) => a.startLine - b.startLine || a.name.localeCompare(b.name));
}

function moduleLinksFor(
  sourceFile: SourceFile,
  sourcePath: string,
  imports: ImportedCallTargets,
  localWaypoints: WaypointNode[]
): FunctionCall[] {
  const hasVisibleOwner = (node: MorphNode) => Boolean(
    node.getFirstAncestor((ancestor) => localWaypoints.some((waypoint) => waypoint.node === ancestor))
  );
  const calls = sourceFile
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter((call) => !hasVisibleOwner(call))
    .flatMap((call): FunctionCall[] => {
      const target = targetForCall(call, sourcePath, imports, localWaypoints);
      return target ? [{
        connectionKind: "call",
        name: call.getExpression().getText(),
        line: call.getStartLineNumber(),
        arguments: call.getArguments().map((argument) => argument.getText()),
        ...target
      }] : [];
    });
  const renderedComponents = [
    ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
    ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)
  ]
    .filter((element) => !hasVisibleOwner(element))
    .flatMap((element): FunctionCall[] => {
      const name = element.getTagNameNode().getText();
      const target = /^[A-Z]/.test(name)
        ? targetForJsxElement(element, sourcePath, imports, localWaypoints)
        : undefined;

      return target ? [{
        connectionKind: "jsx-render",
        name,
        line: element.getStartLineNumber(),
        arguments: [],
        ...target
      }] : [];
    });

  return [...calls, ...renderedComponents]
    .sort((left, right) => left.line - right.line || left.name.localeCompare(right.name));
}

function resolveCallWaypointReferences(structure: ExtractedStructure): void {
  const exportedTargets = new Map<string, FunctionWaypoint[]>();

  for (const [filePath, metadata] of structure.fileMetadata) {
    for (const waypoint of metadata.functionWaypoints ?? []) {
      for (const exportName of waypoint.exportNames ?? []) {
        const key = `${filePath}:${exportName}`;
        const entries = exportedTargets.get(key) ?? [];
        entries.push(waypoint);
        exportedTargets.set(key, entries);
      }
    }
  }

  for (const metadata of structure.fileMetadata.values()) {
    const linkSets = [
      ...(metadata.functionWaypoints ?? []).map((caller) => caller.calls),
      metadata.moduleLinks ?? []
    ];

    for (const links of linkSets) {
      for (const call of links) {
        if (call.definitionWaypointId || !call.definitionPath || !call.definitionName) {
          continue;
        }

        const candidates = exportedTargets.get(`${call.definitionPath}:${call.definitionName}`) ?? [];
        if (candidates.length === 1) {
          call.definitionWaypointId = candidates[0].waypointId;
        }
      }
    }
  }
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
  sourceFile?: SourceFile,
  pythonExtraction?: PythonExtraction
): CompressionReason[] {
  const reasons: CompressionReason[] = [];

  if (metadata.linesOfCode <= 8) {
    reasons.push("very-low-loc");
  }

  if (!sourceFile && !pythonExtraction) {
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

  if (sourceFile && isPassThroughExportFile(sourceFile)) {
    reasons.push("pass-through-export");
  }

  if (pythonExtraction?.isPackageGateway) {
    reasons.push("package-gateway");
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
      bindings.set(defaultImport.getText(), { definitionPath, definitionName: "default" });
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

  for (const statement of sourceFile.getVariableStatements()) {
    for (const declaration of statement.getDeclarations()) {
      const localName = declaration.getName();
      const initializerText = declaration.getInitializer()?.getText() ?? "";
      if (!/^[A-Za-z_$][\w$]*$/.test(localName) || !/\b(?:React\.)?lazy\s*\(/.test(initializerText)) {
        continue;
      }

      const specifier = initializerText.match(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/)?.[1];
      if (!specifier) {
        continue;
      }

      const definitionPath = await resolveImportPath(repoRoot, sourceFile.getFilePath(), specifier);
      if (!definitionPath) {
        continue;
      }

      const selectedExport = initializerText.match(
        /\bdefault\s*:\s*[A-Za-z_$][\w$]*\.([A-Za-z_$][\w$]*)/
      )?.[1] ?? "default";
      bindings.set(localName, {
        definitionPath,
        definitionName: selectedExport,
        throughLazyComponent: true
      });
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
  const targetsById = new Map<string, FunctionWaypoint>();
  const targets = new Map<string, FunctionWaypoint[]>();

  for (const [filePath, metadata] of structure.fileMetadata) {
    for (const waypoint of metadata.functionWaypoints ?? []) {
      targetsById.set(`${filePath}:${waypoint.waypointId}`, waypoint);
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

        const target = call.definitionWaypointId
          ? targetsById.get(`${call.definitionPath}:${call.definitionWaypointId}`)
          : (targets.get(`${call.definitionPath}:${call.definitionName}`) ?? []).length === 1
            ? (targets.get(`${call.definitionPath}:${call.definitionName}`) ?? [])[0]
            : undefined;
        if (!target) {
          continue;
        }

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
  const pythonExtractionsByPath = new Map<string, PythonExtraction>();
  const seenEdges = new Set<string>();

  for (const sourceFile of sourceFiles) {
    const sourcePath = toPosixRelative(repoRoot, sourceFile.getFilePath());
    const metadata = structure.fileMetadata.get(sourcePath);
    sourceFilesByPath.set(sourcePath, sourceFile);
    if (metadata) {
      const imports = await importedCallTargets(repoRoot, sourceFile);
      const localWaypoints = visibleWaypointNodesFor(sourceFile);
      metadata.functionCount = countFunctions(sourceFile);
      metadata.functionWaypoints = functionWaypoints(
        sourceFile,
        sourcePath,
        imports,
        localWaypoints
      );
      metadata.variableWaypoints = variableWaypointsFor(sourceFile);
      metadata.moduleLinks = moduleLinksFor(sourceFile, sourcePath, imports, localWaypoints);
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

  const pythonPaths = [...structure.files]
    .filter((filePath) => PYTHON_PARSE_EXTENSIONS.has(path.extname(filePath).toLowerCase()))
    .sort();

  for (const sourcePath of pythonPaths) {
    const metadata = structure.fileMetadata.get(sourcePath);
    if (!metadata) {
      continue;
    }

    const extraction = extractPython(sourcePath, metadata.sourceText, structure.files);
    pythonExtractionsByPath.set(sourcePath, extraction);
    metadata.functionCount = extraction.functionCount;
    metadata.functionWaypoints = extraction.functionWaypoints;
    metadata.variableWaypoints = extraction.variableWaypoints;

    for (const targetPath of extraction.importPaths) {
      if (targetPath === sourcePath) {
        continue;
      }

      const edgeKey = `${sourcePath}->${targetPath}`;
      if (!seenEdges.has(edgeKey)) {
        seenEdges.add(edgeKey);
        structure.imports.push({ source: sourcePath, target: targetPath });
      }
    }
  }

  resolveCallWaypointReferences(structure);
  connectInputSources(structure);

  for (const filePath of structure.files) {
    const metadata = structure.fileMetadata.get(filePath);
    if (metadata) {
      metadata.compressionReasons = classifyCompression(
        filePath,
        metadata,
        sourceFilesByPath.get(filePath),
        pythonExtractionsByPath.get(filePath)
      );
    }
  }

  return buildGraph(structure);
}
