import type { AtlasGraph, AtlasNode, CommitInfo } from "../api";

export interface TemporalState {
  index: number;
  commitHash: string;
  date: string;
  pressureByPath: Map<string, number>;
  touchedFiles: Set<string>;
  totalPressure: number;
  volatility: number;
  crossFolderCoupling: number;
  growthScore: number;
}

const WINDOW_SIZE = 6;

function parentPaths(path: string): string[] {
  const segments = path.split("/");
  const result: string[] = [];

  for (let index = 1; index < segments.length; index += 1) {
    result.push(segments.slice(0, index).join("/"));
  }

  return result;
}

function folderOf(path: string): string {
  if (!path.includes("/")) {
    return "root";
  }

  return path.slice(0, path.lastIndexOf("/"));
}

function graphCrossFolderCoupling(graph: AtlasGraph): number {
  let crossFolder = 0;

  for (const edge of graph.edges) {
    const sourceFolder = folderOf(edge.source);
    const targetFolder = folderOf(edge.target);
    if (sourceFolder !== targetFolder) {
      crossFolder += 1;
    }
  }

  return crossFolder;
}

export function buildTemporalStates(graph: AtlasGraph, commits: CommitInfo[]): TemporalState[] {
  const couplingBaseline = graphCrossFolderCoupling(graph);

  return commits.map((commit, index) => {
    const window = commits.slice(index, Math.min(commits.length, index + WINDOW_SIZE));
    const pressureByPath = new Map<string, number>();
    const touchedFiles = new Set<string>();
    const changedFolders = new Set<string>();

    for (let offset = 0; offset < window.length; offset += 1) {
      const sample = window[offset];
      const recency = Math.max(0.2, 1 - offset * 0.15);

      for (const changedFile of sample.changedFiles) {
        touchedFiles.add(changedFile);
        changedFolders.add(folderOf(changedFile));
        pressureByPath.set(changedFile, (pressureByPath.get(changedFile) ?? 0) + 3.4 * recency);

        for (const ancestor of parentPaths(changedFile)) {
          pressureByPath.set(ancestor, (pressureByPath.get(ancestor) ?? 0) + 1.1 * recency);
        }
      }
    }

    const volatility = touchedFiles.size / Math.max(1, window.length);
    const growthScore = changedFolders.size + touchedFiles.size * 0.25;
    const crossFolderCoupling = changedFolders.size > 1 ? couplingBaseline * 0.15 + changedFolders.size : changedFolders.size;
    const totalPressure = [...pressureByPath.values()].reduce((acc, value) => acc + value, 0);

    return {
      index,
      commitHash: commit.hash,
      date: commit.date,
      pressureByPath,
      touchedFiles,
      totalPressure,
      volatility,
      crossFolderCoupling,
      growthScore
    };
  });
}

export function nodeTemporalPressure(node: AtlasNode, state: TemporalState | null): number {
  if (!state) {
    return 0;
  }

  if (node.type === "file") {
    return state.pressureByPath.get(node.path) ?? 0;
  }

  let score = state.pressureByPath.get(node.path) ?? 0;
  for (const [path, pressure] of state.pressureByPath.entries()) {
    if (path.startsWith(`${node.path}/`)) {
      score += pressure * 0.4;
    }
  }

  return score;
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
