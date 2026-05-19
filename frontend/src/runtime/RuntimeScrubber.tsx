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
  const progress = maxStep === 0 ? 100 : (currentStep / maxStep) * 100;

  return (
    <div className="runtime-scrubber" aria-label="Runtime activation order">
      <div className="runtime-scrubber__header">
        <div>
          <div className="runtime-scrubber__label">Runtime X-Ray</div>
          <div className="runtime-scrubber__title">
            Step {currentStep + 1} / {maxStep + 1}
          </div>
        </div>
        <div className="runtime-scrubber__actions">
          <button type="button" onClick={onReplay}>Replay</button>
          <button type="button" onClick={onTogglePlay}>{isPlaying ? "Pause" : "Play"}</button>
        </div>
      </div>
      <input
        className="runtime-scrubber__range"
        style={{ "--runtime-progress": `${progress}%` } as CSSProperties}
        type="range"
        min={0}
        max={maxStep}
        value={currentStep}
        onChange={(event) => onScrub(Number(event.target.value))}
        aria-label="Runtime step"
      />
    </div>
  );
}
