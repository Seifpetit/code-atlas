import { simpleGit } from "simple-git";
import type { CommitInfo, FileHistoryInfo } from "./types.js";

const COMMIT_LIMIT = 80;
const FILE_RECENT_COMMIT_LIMIT = 5;
const FIELD_SEPARATOR = "\x1f";
const RECORD_SEPARATOR = "\x1e";
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAYS_PER_MONTH = 30;

function normalizeGitPath(filePath: string): string {
  return filePath.trim().replaceAll("\\", "/");
}

function commitSummary(commit: CommitInfo): FileHistoryInfo["recentCommits"][number] {
  return {
    hash: commit.hash,
    shortHash: commit.shortHash,
    message: commit.message,
    author: commit.author,
    date: commit.date
  };
}

function parseLogOutput(output: string): CommitInfo[] {
  return output
    .split(RECORD_SEPARATOR)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const [headerLine = "", ...fileLines] = block.split(/\r?\n/);
      const [hash = "", shortHash = "", author = "Unknown", date = "", message = "Untitled commit"] =
        headerLine.split(FIELD_SEPARATOR);
      const changedFiles = [...new Set(fileLines.map(normalizeGitPath).filter(Boolean))].sort();

      return {
        hash,
        shortHash,
        message,
        author,
        date,
        changedFiles
      };
    })
    .filter((commit) => commit.hash.length > 0);
}

function sampledHistoryWindowMonths(commits: CommitInfo[]): number {
  const timestamps = commits
    .map((commit) => Date.parse(commit.date))
    .filter((timestamp) => Number.isFinite(timestamp));

  if (timestamps.length < 2) {
    return 1;
  }

  const spanDays = (Math.max(...timestamps) - Math.min(...timestamps)) / MS_PER_DAY;
  return Math.max(1, spanDays / DAYS_PER_MONTH);
}

export async function extractGitHistory(repoRoot: string): Promise<{
  commits: CommitInfo[];
  fileHistory: Record<string, FileHistoryInfo>;
}> {
  try {
    const git = simpleGit(repoRoot);
    const output = await git.raw([
      "log",
      `--max-count=${COMMIT_LIMIT}`,
      "--date=iso-strict",
      "--name-only",
      "--diff-filter=ACMR",
      `--pretty=format:${RECORD_SEPARATOR}%H${FIELD_SEPARATOR}%h${FIELD_SEPARATOR}%an${FIELD_SEPARATOR}%aI${FIELD_SEPARATOR}%s`
    ]);
    const commits = parseLogOutput(output);
    const fileHistory = new Map<string, FileHistoryInfo>();
    const historyWindowMonths = sampledHistoryWindowMonths(commits);

    for (const commit of commits) {
      for (const changedFile of commit.changedFiles) {
        const existing = fileHistory.get(changedFile) ?? {
          path: changedFile,
          commitCount: 0,
          churnRate: 0,
          lastModified: commit.date,
          authors: [],
          recentCommits: []
        };

        existing.commitCount += 1;

        if (!existing.lastModified || commit.date > existing.lastModified) {
          existing.lastModified = commit.date;
        }

        if (!existing.authors.includes(commit.author)) {
          existing.authors.push(commit.author);
        }

        if (existing.recentCommits.length < FILE_RECENT_COMMIT_LIMIT) {
          existing.recentCommits.push(commitSummary(commit));
        }

        fileHistory.set(changedFile, existing);
      }
    }

    for (const history of fileHistory.values()) {
      history.churnRate = Number((history.commitCount / historyWindowMonths).toFixed(2));
    }

    return {
      commits,
      fileHistory: Object.fromEntries(
        [...fileHistory.entries()].sort(([a], [b]) => a.localeCompare(b))
      )
    };
  } catch {
    return {
      commits: [],
      fileHistory: {}
    };
  }
}
