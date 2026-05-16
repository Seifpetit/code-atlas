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

export interface TemporalLandmark {
  id: string;
  index: number;
  label: string;
  score: number;
  date: string;
  changedFiles: number;
}

export interface TemporalState {
  index: number;
  date: string;
  commitsInWindow: number;
  pressureByPath: Map<string, number>;
  touchedFiles: Set<string>;
  totalPressure: number;
}

const ERA_WINDOW = 6;
const LANDMARK_LIMIT = 5;

function parentPaths(path: string): string[] {
  const parts = path.split("/");
  const result: string[] = [];

  for (let index = 1; index < parts.length; index += 1) {
    result.push(parts.slice(0, index).join("/"));
  }

  return result;
}

function classifyLandmarkLabel(files: string[]): string {
  if (files.length === 0) {
    return "Calm interval";
  }

  const folderCounts = new Map<string, number>();
  for (const filePath of files) {
    const folder = filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/")) : "root";
    folderCounts.set(folder, (folderCounts.get(folder) ?? 0) + 1);
  }

  const [topFolder, count] = [...folderCounts.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["root", 0];
  const shortFolder = topFolder.split("/").slice(-1)[0] || "root";

  if (count >= 6) {
    return `${shortFolder} surge`;
  }

  if (count >= 3) {
    return `${shortFolder} expansion`;
  }

  return `${shortFolder} drift`;
}

export function buildTemporalStates(commits: CommitInfo[]): TemporalState[] {
  return commits.map((commit, index) => {
    const windowCommits = commits.slice(index, Math.min(commits.length, index + ERA_WINDOW));
    const pressureByPath = new Map<string, number>();
    const touchedFiles = new Set<string>();

    for (let windowIndex = 0; windowIndex < windowCommits.length; windowIndex += 1) {
      const sample = windowCommits[windowIndex];
      const decay = Math.max(0.2, 1 - windowIndex * 0.15);

      for (const changedFile of sample.changedFiles) {
        touchedFiles.add(changedFile);
        pressureByPath.set(changedFile, (pressureByPath.get(changedFile) ?? 0) + 3 * decay);

        for (const parentPath of parentPaths(changedFile)) {
          pressureByPath.set(parentPath, (pressureByPath.get(parentPath) ?? 0) + 1 * decay);
        }
      }
    }

    const totalPressure = [...pressureByPath.values()].reduce((sum, value) => sum + value, 0);

    return {
      index,
      date: commit.date,
      commitsInWindow: windowCommits.length,
      pressureByPath,
      touchedFiles,
      totalPressure
    };
  });
}

export function deriveTemporalLandmarks(commits: CommitInfo[], states: TemporalState[]): TemporalLandmark[] {
  const scored = states
    .map((state) => {
      const commit = commits[state.index];
      const changedFiles = commit?.changedFiles ?? [];
      const uniqueFolders = new Set(
        changedFiles.map((filePath) => (filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/")) : "root"))
      ).size;
      const score = state.totalPressure + changedFiles.length * 2 + uniqueFolders * 4;

      return {
        id: commit?.hash ?? `state-${state.index}`,
        index: state.index,
        label: classifyLandmarkLabel(changedFiles),
        score,
        date: commit?.date ?? "",
        changedFiles: changedFiles.length
      };
    })
    .sort((a, b) => b.score - a.score);

  const selected: TemporalLandmark[] = [];
  for (const candidate of scored) {
    if (selected.some((landmark) => Math.abs(landmark.index - candidate.index) < 4)) {
      continue;
    }

    selected.push(candidate);
    if (selected.length >= LANDMARK_LIMIT) {
      break;
    }
  }

  return selected.sort((a, b) => a.index - b.index);
}

export function snapIndexToLandmarks(rawIndex: number, landmarks: TemporalLandmark[], snapDistance = 1): number {
  if (landmarks.length === 0) {
    return rawIndex;
  }

  let closest = rawIndex;
  let minDistance = Number.POSITIVE_INFINITY;

  for (const landmark of landmarks) {
    const distance = Math.abs(landmark.index - rawIndex);
    if (distance < minDistance) {
      minDistance = distance;
      closest = landmark.index;
    }
  }

  return minDistance <= snapDistance ? closest : rawIndex;
}

export function nodeTemporalPressure(node: AtlasNode, state: TemporalState | null): number {
  if (!state) {
    return 0;
  }

  if (node.type === "file") {
    return state.pressureByPath.get(node.path) ?? 0;
  }

  let total = state.pressureByPath.get(node.path) ?? 0;
  for (const [path, score] of state.pressureByPath.entries()) {
    if (path.startsWith(`${node.path}/`)) {
      total += score * 0.35;
    }
  }

  return total;
}

export function temporalPressureLevel(score: number): "low" | "medium" | "high" | null {
  if (score >= 12) {
    return "high";
  }

  if (score >= 5) {
    return "medium";
  }

  if (score >= 1.5) {
    return "low";
  }

  return null;
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
