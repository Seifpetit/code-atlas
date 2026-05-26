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

function temporalIntensity(level: NodeAttentionSignals["temporalPressureLevel"]): number {
  if (level === "high") {
    return 0.8;
  }

  if (level === "medium") {
    return 0.52;
  }

  if (level === "low") {
    return 0.28;
  }

  return 0;
}

export function composeNodeVisualState(signals: NodeAttentionSignals): NodeVisualState {
  if (signals.hasCriticalEvent) {
    if (signals.isCriticalEventAffected) {
      return visualState({
        layer: "critical-event",
        opacity: 1,
        scale: 1.02,
        zIndex: 60,
        outlineIntensity: 1,
        glowIntensity: 1,
        glowType: "critical",
        pulse: "medium",
        faded: false,
        labelEmphasis: "strong"
      });
    }

    return visualState({
      layer: "ambient",
      opacity: 0.32,
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

  if (signals.isFocused || signals.isSearchMatch) {
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

  if (signals.hasFocusContext) {
    if (signals.isRelationshipRelevant) {
      return visualState({
        layer: "hover",
        opacity: 0.9,
        scale: 1,
        zIndex: 30,
        outlineIntensity: 0.45,
        glowIntensity: 0.25,
        glowType: "interaction",
        pulse: "none",
        faded: false,
        labelEmphasis: "normal"
      });
    }

    return visualState({
      layer: "ambient",
      opacity: 0.18,
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

  if (signals.isHovered) {
    return visualState({
      layer: "hover",
      opacity: 1,
      scale: 1.005,
      zIndex: 40,
      outlineIntensity: 0.45,
      glowIntensity: 0.22,
      glowType: "interaction",
      pulse: "none",
      faded: false,
      labelEmphasis: "normal"
    });
  }

  if (signals.temporalPressureLevel) {
    return visualState({
      layer: "temporal-pressure",
      opacity: 1,
      scale: 1,
      zIndex: 20,
      outlineIntensity: 0.2,
      glowIntensity: temporalIntensity(signals.temporalPressureLevel),
      glowType: "temporal",
      pulse: signals.temporalPressureLevel === "high" ? "slow" : "none",
      faded: false,
      labelEmphasis: "normal"
    });
  }

  if (signals.hasStructuralGuidance) {
    return visualState({
      layer: "structural-guidance",
      opacity: 1,
      scale: 1,
      zIndex: 10,
      outlineIntensity: 0.16,
      glowIntensity: 0.2,
      glowType: "structural",
      pulse: "none",
      faded: false,
      labelEmphasis: "normal"
    });
  }

  if (signals.isLowSignalCompressed) {
    return visualState({
      layer: "compressed",
      opacity: 0.62,
      scale: 0.97,
      zIndex: 0,
      outlineIntensity: 0,
      glowIntensity: 0,
      glowType: "none",
      pulse: "none",
      faded: false,
      labelEmphasis: "muted"
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
