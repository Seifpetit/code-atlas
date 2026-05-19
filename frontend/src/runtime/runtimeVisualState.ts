import type { NodeVisualState } from "../graph/attention/attentionTypes";

type RuntimePhase = "current" | "residue" | "participating" | "background";

function className(state: NodeVisualState): string {
  return [
    "attention-node",
    `attention-node--${state.layer}`,
    `attention-node--glow-${state.glowType}`,
    `attention-node--pulse-${state.pulse}`,
    `attention-node--label-${state.labelEmphasis}`,
    state.faded ? "attention-node--faded" : ""
  ]
    .filter(Boolean)
    .join(" ");
}

function makeState(state: Omit<NodeVisualState, "className">): NodeVisualState {
  const visualState = { ...state, className: "" };

  return {
    ...visualState,
    className: className(visualState)
  };
}

export function runtimeVisualState(phase: RuntimePhase): NodeVisualState {
  if (phase === "current") {
    return makeState({
      layer: "runtime-current",
      opacity: 1,
      scale: 1.035,
      zIndex: 95,
      outlineIntensity: 1,
      glowIntensity: 1,
      glowType: "runtime",
      pulse: "medium",
      faded: false,
      labelEmphasis: "strong"
    });
  }

  if (phase === "residue") {
    return makeState({
      layer: "runtime-residue",
      opacity: 0.92,
      scale: 1.01,
      zIndex: 82,
      outlineIntensity: 0.72,
      glowIntensity: 0.48,
      glowType: "runtime",
      pulse: "none",
      faded: false,
      labelEmphasis: "normal"
    });
  }

  if (phase === "participating") {
    return makeState({
      layer: "runtime-preview",
      opacity: 0.74,
      scale: 1,
      zIndex: 74,
      outlineIntensity: 0.38,
      glowIntensity: 0.18,
      glowType: "runtime",
      pulse: "none",
      faded: false,
      labelEmphasis: "normal"
    });
  }

  return makeState({
    layer: "ambient",
    opacity: 0.16,
    scale: 1,
    zIndex: 0,
    outlineIntensity: 0,
    glowIntensity: 0,
    glowType: "none",
    pulse: "none",
    faded: true,
    labelEmphasis: "muted"
  });
}
