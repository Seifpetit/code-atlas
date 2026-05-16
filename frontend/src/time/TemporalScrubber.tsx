import { formatCommitDate } from "../history/historyUtils";
import type { ArchitecturalLandmark } from "./landmarkExtraction";

interface TemporalScrubberProps {
  totalStates: number;
  currentIndex: number;
  activeDate: string;
  landmarks: ArchitecturalLandmark[];
  focusedLandmarkId: string | null;
  onScrub: (nextIndex: number) => void;
  onLandmarkFocus: (landmarkId: string) => void;
  onReset: () => void;
}

export function TemporalScrubber({
  totalStates,
  currentIndex,
  activeDate,
  landmarks,
  focusedLandmarkId,
  onScrub,
  onLandmarkFocus,
  onReset
}: TemporalScrubberProps) {
  const canScrub = totalStates > 1;

  return (
    <aside className="timeline-panel" aria-label="Architectural time exploration">
      <div className="timeline-panel__header">
        <div>
          <div className="timeline-panel__label">Architectural Time</div>
          <div className="timeline-panel__title">{formatCommitDate(activeDate)}</div>
        </div>
        {currentIndex > 0 ? (
          <button type="button" className="timeline-panel__clear" onClick={onReset}>
            Reset
          </button>
        ) : null}
      </div>
      {totalStates > 0 ? (
        <div className="timeline-strip">
          <input
            className="timeline-strip__range"
            type="range"
            min={0}
            max={Math.max(0, totalStates - 1)}
            step={1}
            value={currentIndex}
            onChange={(event) => onScrub(Number(event.target.value))}
            disabled={!canScrub}
            aria-label="Temporal scrubber"
          />
          <div className="timeline-strip__landmarks" role="list" aria-label="Architectural landmarks">
            {landmarks.map((landmark) => {
              const left = totalStates > 1 ? (landmark.index / (totalStates - 1)) * 100 : 0;
              const focused = focusedLandmarkId === landmark.id;

              return (
                <button
                  key={landmark.id}
                  role="listitem"
                  type="button"
                  className={focused ? "timeline-strip__landmark is-focused" : "timeline-strip__landmark"}
                  style={{ left: `${left}%` }}
                  title={`${landmark.label} · ${landmark.changedFiles} files`}
                  onClick={() => onLandmarkFocus(landmark.id)}
                >
                  <span />
                </button>
              );
            })}
          </div>
          <div className="timeline-strip__chips">
            {landmarks.slice(0, 4).map((landmark) => (
              <button
                key={`chip:${landmark.id}`}
                type="button"
                className={focusedLandmarkId === landmark.id ? "timeline-strip__chip is-focused" : "timeline-strip__chip"}
                onClick={() => onLandmarkFocus(landmark.id)}
              >
                {landmark.label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <p className="timeline-panel__empty">No temporal history available for this repository.</p>
      )}
    </aside>
  );
}
