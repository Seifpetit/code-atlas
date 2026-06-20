export type AttentionLayer = "ambient" | "focus";

export type AttentionGlowType = "none" | "interaction";
export type AttentionPulse = "none";
export type AttentionLabelEmphasis = "normal" | "strong";

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
  isFocused: boolean;
}
