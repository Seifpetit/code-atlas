import type { CSSProperties } from "react";
import { formatCommitDate } from "../history/historyUtils";
import type { ArchitecturalLandmark } from "./landmarkExtraction";

interface TemporalScrubberProps {
  totalStates: number;
  currentIndex: number;
  activeDate: string;
  landmarks: ArchitecturalLandmark[];
  focusedLandmarkId: string | null;
  isCollapsed: boolean;
  onScrub: (nextIndex: number) => void;
  onLandmarkFocus: (landmarkId: string) => void;
  onReset: () => void;
  onToggleCollapsed: () => void;
}

function TimelineIcon() {
  return (
    <svg className="timeline-panel__icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 12h16" />
      <circle cx="7" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="17" cy="12" r="2" />
    </svg>
  );
}

export function TemporalScrubber({
  totalStates,
  currentIndex,
  activeDate,
  landmarks,
  focusedLandmarkId,
  isCollapsed,
  onScrub,
  onLandmarkFocus,
  onReset,
  onToggleCollapsed
}: TemporalScrubberProps) {
  const canScrub = totalStates > 1;
  const progress = totalStates > 1 ? (currentIndex / (totalStates - 1)) * 100 : 0;
  const scrubberStyle = {
    "--timeline-progress": `${progress}%`
  } as CSSProperties;

  if (isCollapsed) {
    return (
      <button
        type="button"
        className="timeline-panel-toggle"
        aria-label="Expand architectural time"
        aria-expanded="false"
        title="Open Architectural Time"
        onClick={onToggleCollapsed}
      >
        <TimelineIcon />
      </button>
    );
  }

  return (
    <aside className="timeline-panel" aria-label="Architectural time exploration">
      <div className="timeline-panel__header">
        <div>
          <div className="timeline-panel__label">Architectural Time</div>
          <div className="timeline-panel__title">{formatCommitDate(activeDate)}</div>
        </div>
        <div className="timeline-panel__actions">
          {currentIndex > 0 ? (
            <button type="button" className="timeline-panel__clear" onClick={onReset}>
              Reset
            </button>
          ) : null}
          <button
            type="button"
            className="timeline-panel__collapse"
            aria-label="Collapse architectural time"
            aria-expanded="true"
            title="Collapse Architectural Time"
            onClick={onToggleCollapsed}
          >
            <TimelineIcon />
          </button>
        </div>
      </div>
      {totalStates > 0 ? (
        <div className="timeline-strip">
          <input
            className="timeline-strip__range"
            style={scrubberStyle}
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
                  title={`${landmark.label} - ${landmark.changedFiles} files`}
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
