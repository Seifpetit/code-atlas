import type { CSSProperties } from "react";
import type { RuntimeChain } from "./runtimeTypes";

interface RuntimeScrubberProps {
  chain: RuntimeChain;
  currentStep: number;
  isPlaying: boolean;
  onScrub: (step: number) => void;
  onReplay: () => void;
  onTogglePlay: () => void;
}

export function RuntimeScrubber({
  chain,
  currentStep,
  isPlaying,
  onScrub,
  onReplay,
  onTogglePlay
}: RuntimeScrubberProps) {
  const maxStep = Math.max(0, chain.nodes.length - 1);
  const progress = maxStep === 0 ? 0 : (currentStep / maxStep) * 100;
  const instrumentStyle = { "--runtime-progress": `${progress}%` } as CSSProperties;

  return (
    <div className="runtime-scrubber" aria-label="Runtime causal progression">
      <div className="runtime-scrubber__header">
        <div>
          <div className="runtime-scrubber__label">Causality Corridor</div>
          <div className="runtime-scrubber__title">
            Waypoint {String(currentStep + 1).padStart(2, "0")} / {String(maxStep + 1).padStart(2, "0")}
          </div>
        </div>
        <div className="runtime-scrubber__actions">
          <button type="button" aria-label="Restart causal traversal" onClick={onReplay}>Restart</button>
          <button
            type="button"
            className={isPlaying ? "is-active" : undefined}
            aria-pressed={isPlaying}
            aria-label={isPlaying ? "Hold causal traversal" : "Traverse causal corridor"}
            onClick={onTogglePlay}
          >
            {isPlaying ? "Hold" : "Traverse"}
          </button>
        </div>
      </div>
      <div className="runtime-scrubber__instrument" style={instrumentStyle}>
        <div className="runtime-scrubber__rail" aria-hidden="true">
          <span className="runtime-scrubber__energy" />
          {chain.nodes.map((node, index) => {
            const position = maxStep === 0 ? 0 : (index / maxStep) * 100;
            const state = index === currentStep ? "is-current" : index < currentStep ? "is-reached" : "";

            return (
              <span
                key={node.id}
                className={`runtime-scrubber__waypoint ${state}`.trim()}
                style={{ "--runtime-waypoint": `${position}%` } as CSSProperties}
              />
            );
          })}
        </div>
        <input
          className="runtime-scrubber__range"
          type="range"
          min={0}
          max={maxStep}
          value={currentStep}
          onChange={(event) => onScrub(Number(event.target.value))}
          aria-label="Runtime causal waypoint"
        />
        <div className="runtime-scrubber__readout" aria-hidden="true">
          <span>Origin</span>
          <span>{isPlaying ? "Traversing" : "Hold"}</span>
          <span>Extent</span>
        </div>
      </div>
    </div>
  );
}
