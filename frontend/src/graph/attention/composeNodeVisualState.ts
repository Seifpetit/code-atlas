import type { NodeAttentionSignals, NodeVisualState } from "./attentionTypes";

function visualState(state: Omit<NodeVisualState, "className">): NodeVisualState {
  return {
    ...state,
    className: [
      "attention-node",
      `attention-node--${state.layer}`,
      `attention-node--glow-${state.glowType}`,
      `attention-node--pulse-${state.pulse}`,
      `attention-node--label-${state.labelEmphasis}`,
      state.faded ? "attention-node--faded" : ""
    ]
      .filter(Boolean)
      .join(" ")
  };
}

export function composeNodeVisualState(signals: NodeAttentionSignals): NodeVisualState {
  if (signals.isFocused) {
    return visualState({
      layer: "focus",
      opacity: 1,
      scale: 1.015,
      zIndex: 50,
      outlineIntensity: 0.9,
      glowIntensity: 0.62,
      glowType: "interaction",
      pulse: "none",
      faded: false,
      labelEmphasis: "strong"
    });
  }

  return visualState({
    layer: "ambient",
    opacity: 1,
    scale: 1,
    zIndex: 0,
    outlineIntensity: 0,
    glowIntensity: 0,
    glowType: "none",
    pulse: "none",
    faded: false,
    labelEmphasis: "normal"
  });
}
