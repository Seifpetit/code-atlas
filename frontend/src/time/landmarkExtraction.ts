import type { CommitInfo } from "../api";
import type { TemporalState } from "./temporalPressure";

export interface ArchitecturalLandmark {
  id: string;
  index: number;
  label: string;
  score: number;
  date: string;
  commitCount: number;
  changedFiles: number;
}

const MAX_LANDMARKS = 6;

function classifyLabel(state: TemporalState, commit: CommitInfo | undefined): string {
  const changedCount = commit?.changedFiles.length ?? 0;

  if (state.crossFolderCoupling >= 10) {
    return "Coupling shift";
  }

  if (state.volatility >= 8) {
    return "Volatility surge";
  }

  if (changedCount >= 10) {
    return "Dependency expansion";
  }

  if (state.growthScore >= 8) {
    return "Subsystem emergence";
  }

  return "Architecture drift";
}

export function extractArchitecturalLandmarks(
  commits: CommitInfo[],
  states: TemporalState[]
): ArchitecturalLandmark[] {
  const ranked = states
    .map((state) => {
      const commit = commits[state.index];
      const changedFiles = commit?.changedFiles.length ?? 0;
      const score =
        state.totalPressure +
        state.volatility * 4 +
        state.crossFolderCoupling * 2 +
        state.growthScore * 2 +
        changedFiles;

      return {
        id: commit?.hash ?? `state-${state.index}`,
        index: state.index,
        label: classifyLabel(state, commit),
        score,
        date: commit?.date ?? state.date,
        commitCount: Math.max(1, Math.round(state.volatility)),
        changedFiles
      };
    })
    .sort((a, b) => b.score - a.score);

  const picked: ArchitecturalLandmark[] = [];
  for (const candidate of ranked) {
    if (picked.some((existing) => Math.abs(existing.index - candidate.index) <= 3)) {
      continue;
    }

    picked.push(candidate);
    if (picked.length >= MAX_LANDMARKS) {
      break;
    }
  }

  return picked.sort((a, b) => a.index - b.index);
}

export function snapToLandmark(index: number, landmarks: ArchitecturalLandmark[], distance = 1): number {
  if (landmarks.length === 0) {
    return index;
  }

  let minDistance = Number.POSITIVE_INFINITY;
  let nearest = index;

  for (const landmark of landmarks) {
    const delta = Math.abs(landmark.index - index);
    if (delta < minDistance) {
      minDistance = delta;
      nearest = landmark.index;
    }
  }

  return minDistance <= distance ? nearest : index;
}
