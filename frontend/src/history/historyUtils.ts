import type { AtlasNode, CommitInfo, FileHistoryInfo } from "../api";

export function formatCommitDate(dateValue: string): string {
  const date = new Date(dateValue);

  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

export function changedFileSet(commit: CommitInfo | null | undefined): Set<string> {
  return new Set(commit?.changedFiles ?? []);
}

export function nodeTouchesChangedFiles(node: AtlasNode, changedFiles: Set<string>): boolean {
  if (changedFiles.size === 0) {
    return false;
  }

  if (node.type === "file") {
    return changedFiles.has(node.path);
  }

  for (const changedFile of changedFiles) {
    if (changedFile === node.path || changedFile.startsWith(`${node.path}/`)) {
      return true;
    }
  }

  return false;
}

export function historyBadgeFor(node: AtlasNode, fileHistory?: Record<string, FileHistoryInfo>): string | undefined {
  if (node.type !== "file") {
    return undefined;
  }

  const history = fileHistory?.[node.path];
  if (!history || history.commitCount <= 0) {
    return undefined;
  }

  if (history.commitCount >= 8) {
    return "hot";
  }

  const lastModified = new Date(history.lastModified);
  if (!Number.isNaN(lastModified.getTime())) {
    const ageInDays = (Date.now() - lastModified.getTime()) / 86_400_000;
    if (ageInDays <= 30) {
      return "recent";
    }
  }

  return `${history.commitCount}`;
}
