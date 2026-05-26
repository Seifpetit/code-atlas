import fs from "node:fs/promises";
import path from "node:path";
import { Project, SourceFile, SyntaxKind } from "ts-morph";
import { buildGraph } from "./buildGraph.js";
import type { CompressionReason, ExtractedFileMetadata, ExtractedStructure, GraphJson } from "./types.js";

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

function countLinesOfCode(contents: string): number {
  return contents.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
}

function countFunctions(sourceFile: SourceFile): number {
  return FUNCTION_LIKE_KINDS.reduce(
    (total, kind) => total + sourceFile.getDescendantsOfKind(kind).length,
    0
  );
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

  for (const filePath of structure.files) {
    const metadata = structure.fileMetadata.get(filePath);
    if (metadata) {
      metadata.compressionReasons = classifyCompression(filePath, metadata, sourceFilesByPath.get(filePath));
    }
  }

  return buildGraph(structure);
}
