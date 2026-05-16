import type { CommitInfo } from "../api";
import { formatCommitDate } from "../history/historyUtils";
import type { ArchitecturalLandmark } from "./landmarkExtraction";

interface RawHistoryInspectorProps {
  visible: boolean;
  landmark: ArchitecturalLandmark | null;
  commits: CommitInfo[];
}

export function RawHistoryInspector({ visible, landmark, commits }: RawHistoryInspectorProps) {
  if (!visible || !landmark) {
    return null;
  }

  const start = Math.max(0, landmark.index - 3);
  const end = Math.min(commits.length, landmark.index + 4);
  const windowCommits = commits.slice(start, end);
  const authorSet = new Set(windowCommits.map((commit) => commit.author));
  const changedFiles = windowCommits.reduce((acc, commit) => acc + commit.changedFiles.length, 0);

  return (
    <aside className="history-inspector" aria-label="Raw history inspector">
      <div className="history-inspector__label">Evidence</div>
      <div className="history-inspector__title">{landmark.label}</div>
      <div className="history-inspector__meta">{formatCommitDate(landmark.date)}</div>
      <dl className="history-inspector__stats">
        <div>
          <dt>Commits</dt>
          <dd>{windowCommits.length}</dd>
        </div>
        <div>
          <dt>Authors</dt>
          <dd>{authorSet.size}</dd>
        </div>
        <div>
          <dt>Files</dt>
          <dd>{changedFiles}</dd>
        </div>
      </dl>
      <ul className="history-inspector__list">
        {windowCommits.slice(0, 6).map((commit) => (
          <li key={commit.hash}>
            <span>{commit.message}</span>
            <strong>{commit.shortHash}</strong>
          </li>
        ))}
      </ul>
    </aside>
  );
}
