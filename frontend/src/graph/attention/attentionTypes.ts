export type AttentionLayer =
  | "ambient"
  | "hover"
  | "focus"
  | "runtime-current"
  | "runtime-residue"
  | "runtime-preview"
  | "structural-guidance"
  | "temporal-pressure"
  | "critical-event";

export type AttentionGlowType = "none" | "interaction" | "runtime" | "temporal" | "structural" | "critical";
export type AttentionPulse = "none" | "slow" | "medium";
export type AttentionLabelEmphasis = "normal" | "strong" | "muted";

export interface NodeVisualState {
  layer: AttentionLayer;
  opacity: number;
  scale: number;
  zIndex: number;
  outlineIntensity: number;
  glowIntensity: number;
  glowType: AttentionGlowType;
  pulse: AttentionPulse;
  faded: boolean;
  labelEmphasis: AttentionLabelEmphasis;
  className: string;
}

export interface NodeAttentionSignals {
  isHovered: boolean;
  isFocused: boolean;
  isSearchMatch: boolean;
  isRelationshipRelevant: boolean;
  hasFocusContext: boolean;
  temporalPressureLevel: "low" | "medium" | "high" | null;
  temporalPressureScore: number;
  hasTemporalState: boolean;
  hasCriticalEvent: boolean;
  isCriticalEventAffected: boolean;
  hasStructuralGuidance: boolean;
}
