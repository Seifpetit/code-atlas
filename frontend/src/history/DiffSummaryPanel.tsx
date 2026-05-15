import type { CommitInfo, DiffFile, DiffResult } from "../api";
import { summarizeDiff } from "./diffOverlay";

interface DiffSummaryPanelProps {
  diff: DiffResult;
  baseCommit?: CommitInfo;
  targetCommit?: CommitInfo;
}

function labelForCommit(commit: CommitInfo | undefined, fallback: string): string {
  return commit ? commit.shortHash : fallback.slice(0, 7);
}

export function DiffSummaryPanel({ diff, baseCommit, targetCommit }: DiffSummaryPanelProps) {
  const summary = summarizeDiff(diff);
  const topFiles = diff.changedFiles
    .slice()
    .sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions) || a.path.localeCompare(b.path))
    .slice(0, 5);

  return (
    <aside className="diff-summary-panel" aria-label="Commit diff summary">
      <div className="diff-summary-panel__label">Compare</div>
      <div className="diff-summary-panel__range">
        {labelForCommit(baseCommit, diff.baseCommit)} → {labelForCommit(targetCommit, diff.targetCommit)}
      </div>
      <div className="diff-summary-panel__stats">
        <div>
          <span>Files</span>
          <strong>{summary.totalFiles}</strong>
        </div>
        <div>
          <span>Added</span>
          <strong>{summary.addedFiles}</strong>
        </div>
        <div>
          <span>Modified</span>
          <strong>{summary.modifiedFiles + summary.renamedFiles}</strong>
        </div>
        <div>
          <span>Deleted</span>
          <strong>{summary.deletedFiles}</strong>
        </div>
      </div>
      <div className="diff-summary-panel__churn">
        <span>+{summary.additions}</span>
        <span>-{summary.deletions}</span>
      </div>
      {topFiles.length > 0 ? (
        <ul className="diff-summary-panel__files">
          {topFiles.map((file: DiffFile) => (
            <li key={`${file.status}:${file.path}`}>
              <span>{file.path}</span>
              <strong>{file.status}</strong>
            </li>
          ))}
        </ul>
      ) : null}
    </aside>
  );
}
