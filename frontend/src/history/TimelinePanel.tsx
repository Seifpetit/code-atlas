import type { CommitInfo } from "../api";
import { formatCommitDate } from "./historyUtils";

interface TimelinePanelProps {
  commits: CommitInfo[];
  selectedCommitHash: string | null;
  hoveredCommitHash: string | null;
  baseCommitHash: string | null;
  targetCommitHash: string | null;
  isComparing: boolean;
  onCommitHover: (commitHash: string | null) => void;
  onCommitSelect: (commitHash: string | null) => void;
  onBaseSelect: (commitHash: string) => void;
  onTargetSelect: (commitHash: string) => void;
  onCompare: () => void;
  onReset: () => void;
}

export function TimelinePanel({
  commits,
  selectedCommitHash,
  hoveredCommitHash,
  baseCommitHash,
  targetCommitHash,
  isComparing,
  onCommitHover,
  onCommitSelect,
  onBaseSelect,
  onTargetSelect,
  onCompare,
  onReset
}: TimelinePanelProps) {
  const activeCommitHash = hoveredCommitHash ?? selectedCommitHash;
  const canCompare = Boolean(baseCommitHash && targetCommitHash && baseCommitHash !== targetCommitHash && !isComparing);

  return (
    <aside className="timeline-panel" aria-label="Repository history timeline">
      <div className="timeline-panel__header">
        <div>
          <div className="timeline-panel__label">History</div>
          <div className="timeline-panel__title">{commits.length} commits</div>
        </div>
        {selectedCommitHash || baseCommitHash || targetCommitHash ? (
          <button type="button" className="timeline-panel__clear" onClick={onReset}>
            Reset
          </button>
        ) : null}
      </div>
      <div className="timeline-compare">
        <div>
          <span>Base</span>
          <strong>{commits.find((commit) => commit.hash === baseCommitHash)?.shortHash ?? "Unset"}</strong>
        </div>
        <div>
          <span>Target</span>
          <strong>{commits.find((commit) => commit.hash === targetCommitHash)?.shortHash ?? "Unset"}</strong>
        </div>
        <button type="button" onClick={onCompare} disabled={!canCompare}>
          {isComparing ? "Comparing" : "Compare"}
        </button>
      </div>

      {commits.length > 0 ? (
        <ol className="timeline-list">
          {commits.map((commit) => {
            const isSelected = selectedCommitHash === commit.hash;
            const isActive = activeCommitHash === commit.hash;

            return (
              <li key={commit.hash}>
                <article
                  className={[
                    "timeline-item",
                    isSelected ? "is-selected" : "",
                    isActive ? "is-active" : "",
                    baseCommitHash === commit.hash ? "is-base" : "",
                    targetCommitHash === commit.hash ? "is-target" : ""
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onMouseEnter={() => onCommitHover(commit.hash)}
                  onMouseLeave={() => onCommitHover(null)}
                >
                  <button
                    type="button"
                    className="timeline-item__main"
                    onFocus={() => onCommitHover(commit.hash)}
                    onBlur={() => onCommitHover(null)}
                    onClick={() => onCommitSelect(commit.hash)}
                  >
                    <span className="timeline-item__message">{commit.message}</span>
                    <span className="timeline-item__date">{formatCommitDate(commit.date)}</span>
                    <span className="timeline-item__meta">
                      <span>{commit.shortHash}</span>
                      <span>{commit.author}</span>
                    </span>
                    <span className="timeline-item__files">{commit.changedFiles.length} files changed</span>
                  </button>
                  <div className="timeline-item__actions">
                    <button type="button" onClick={() => onBaseSelect(commit.hash)}>
                      Base
                    </button>
                    <button type="button" onClick={() => onTargetSelect(commit.hash)}>
                      Target
                    </button>
                  </div>
                </article>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="timeline-panel__empty">No git history found for this repository.</p>
      )}
    </aside>
  );
}
