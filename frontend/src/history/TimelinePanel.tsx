import type { CommitInfo } from "../api";
import { formatCommitDate } from "./historyUtils";

interface TimelinePanelProps {
  commits: CommitInfo[];
  selectedCommitHash: string | null;
  hoveredCommitHash: string | null;
  onCommitHover: (commitHash: string | null) => void;
  onCommitSelect: (commitHash: string | null) => void;
  onReset: () => void;
}

export function TimelinePanel({
  commits,
  selectedCommitHash,
  hoveredCommitHash,
  onCommitHover,
  onCommitSelect,
  onReset
}: TimelinePanelProps) {
  const activeCommitHash = hoveredCommitHash ?? selectedCommitHash;

  return (
    <aside className="timeline-panel" aria-label="Repository history timeline">
      <div className="timeline-panel__header">
        <div>
          <div className="timeline-panel__label">History</div>
          <div className="timeline-panel__title">{commits.length} commits</div>
        </div>
        {selectedCommitHash ? (
          <button type="button" className="timeline-panel__clear" onClick={onReset}>
            Reset
          </button>
        ) : null}
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
                    isActive ? "is-active" : ""
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
