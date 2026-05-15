import { simpleGit } from "simple-git";
import type { DiffFile, DiffFileStatus, DiffResult } from "./types.js";

function statusFromGit(rawStatus: string): DiffFileStatus {
  if (rawStatus.startsWith("A")) {
    return "added";
  }

  if (rawStatus.startsWith("D")) {
    return "deleted";
  }

  if (rawStatus.startsWith("R")) {
    return "renamed";
  }

  return "modified";
}

function normalizePath(filePath: string): string {
  return filePath.trim().replaceAll("\\", "/");
}

function parseNumstatPath(rawPath: string): string {
  const trimmed = normalizePath(rawPath);

  if (!trimmed.includes(" => ")) {
    return trimmed;
  }

  const arrowParts = trimmed.split(" => ");
  const target = arrowParts[arrowParts.length - 1] ?? trimmed;

  return target.replace(/[{}]/g, "").trim();
}

function parseCount(rawValue: string): number {
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseNameStatus(output: string): Map<string, { status: DiffFileStatus; oldPath?: string }> {
  const statuses = new Map<string, { status: DiffFileStatus; oldPath?: string }>();

  for (const line of output.split(/\r?\n/).filter(Boolean)) {
    const parts = line.split("\t");
    const status = statusFromGit(parts[0] ?? "M");

    if (status === "renamed") {
      const oldPath = normalizePath(parts[1] ?? "");
      const path = normalizePath(parts[2] ?? oldPath);
      statuses.set(path, { status, oldPath });
      continue;
    }

    const path = normalizePath(parts[1] ?? "");
    if (path) {
      statuses.set(path, { status });
    }
  }

  return statuses;
}

function parseNumstat(output: string): Map<string, { additions: number; deletions: number }> {
  const stats = new Map<string, { additions: number; deletions: number }>();

  for (const line of output.split(/\r?\n/).filter(Boolean)) {
    const parts = line.split("\t");
    const rawPath = parts.slice(2).join("\t");
    const path = parseNumstatPath(rawPath);

    if (path) {
      stats.set(path, {
        additions: parseCount(parts[0] ?? "0"),
        deletions: parseCount(parts[1] ?? "0")
      });
    }
  }

  return stats;
}

export async function extractGitDiff(
  repoRoot: string,
  baseCommit: string,
  targetCommit: string
): Promise<DiffResult> {
  const git = simpleGit(repoRoot);
  const [nameStatusOutput, numstatOutput] = await Promise.all([
    git.raw(["diff", "--name-status", "-M", baseCommit, targetCommit]),
    git.raw(["diff", "--numstat", "-M", baseCommit, targetCommit])
  ]);
  const statuses = parseNameStatus(nameStatusOutput);
  const stats = parseNumstat(numstatOutput);
  const paths = new Set([...statuses.keys(), ...stats.keys()]);
  const changedFiles: DiffFile[] = [...paths]
    .sort()
    .map((path) => {
      const statusInfo = statuses.get(path);
      const statInfo = stats.get(path);

      return {
        path,
        oldPath: statusInfo?.oldPath,
        status: statusInfo?.status ?? "modified",
        additions: statInfo?.additions ?? 0,
        deletions: statInfo?.deletions ?? 0
      };
    });

  return {
    baseCommit,
    targetCommit,
    changedFiles
  };
}
