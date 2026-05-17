import type { CSSProperties } from "react";
import type { NodeVisualState } from "./attentionTypes";

export function visualStateStyle(visualState: NodeVisualState): CSSProperties {
  return {
    "--attention-opacity": visualState.opacity,
    "--attention-scale": visualState.scale,
    "--attention-outline": visualState.outlineIntensity,
    "--attention-glow": visualState.glowIntensity
  } as CSSProperties;
}

export function visualStateClassName(visualState: NodeVisualState): string {
  return visualState.className;
}
