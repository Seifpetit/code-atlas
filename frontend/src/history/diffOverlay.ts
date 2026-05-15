import type { AtlasNode, DiffFile, DiffFileStatus, DiffResult } from "../api";

export interface DiffSummary {
  totalFiles: number;
  addedFiles: number;
  modifiedFiles: number;
  deletedFiles: number;
  renamedFiles: number;
  additions: number;
  deletions: number;
}

export function summarizeDiff(diff: DiffResult | null): DiffSummary {
  const files = diff?.changedFiles ?? [];

  return {
    totalFiles: files.length,
    addedFiles: files.filter((file) => file.status === "added").length,
    modifiedFiles: files.filter((file) => file.status === "modified").length,
    deletedFiles: files.filter((file) => file.status === "deleted").length,
    renamedFiles: files.filter((file) => file.status === "renamed").length,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0)
  };
}

export function diffFileForNode(node: AtlasNode, diff: DiffResult | null): DiffFile | null {
  if (!diff) {
    return null;
  }

  if (node.type === "file") {
    return diff.changedFiles.find((file) => file.path === node.path || file.oldPath === node.path) ?? null;
  }

  const nestedChange = diff.changedFiles.find(
    (file) =>
      file.path.startsWith(`${node.path}/`) ||
      Boolean(file.oldPath?.startsWith(`${node.path}/`))
  );

  if (!nestedChange) {
    return null;
  }

  return {
    path: node.path,
    status: statusForFolder(diff.changedFiles, node.path),
    additions: 0,
    deletions: 0
  };
}

function statusForFolder(files: DiffFile[], folderPath: string): DiffFileStatus {
  const nested = files.filter(
    (file) =>
      file.path.startsWith(`${folderPath}/`) ||
      Boolean(file.oldPath?.startsWith(`${folderPath}/`))
  );

  if (nested.some((file) => file.status === "modified" || file.status === "renamed")) {
    return "modified";
  }

  if (nested.some((file) => file.status === "added")) {
    return "added";
  }

  if (nested.some((file) => file.status === "deleted")) {
    return "deleted";
  }

  return "modified";
}
