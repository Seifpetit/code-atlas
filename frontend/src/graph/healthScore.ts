import type { AtlasNode } from "../api";

export type HealthTier = "healthy" | "warning" | "critical" | "unscored";
export type HealthComponentId = "cyclomatic" | "cognitive" | "duplication" | "churn" | "ghostRatio";

export type GraphNode = AtlasNode;

export interface HealthComponents {
  cyclomatic: number;
  cognitive: number;
  duplication: number;
  churn: number;
  ghostRatio: number;
}

export interface HealthComponentScore {
  id: HealthComponentId;
  label: string;
  points: number;
  weight: number;
  badness: number;
  tier: HealthTier;
}

export interface HealthScoreDetails {
  score: number;
  tier: HealthTier;
  components: Record<HealthComponentId, HealthComponentScore>;
}

export const HEALTH_COMPONENT_ORDER: HealthComponentId[] = [
  "cyclomatic",
  "cognitive",
  "duplication",
  "churn",
  "ghostRatio"
];

const defaultComponents: HealthComponents = {
  cyclomatic: 0,
  cognitive: 0,
  duplication: 0,
  churn: 0,
  ghostRatio: 0
};

const HEALTH_COMPONENT_META: Record<HealthComponentId, { label: string; weight: number }> = {
  cyclomatic: { label: "Cyclomatic", weight: 25 },
  cognitive: { label: "Cognitive", weight: 20 },
  duplication: { label: "Duplication", weight: 20 },
  churn: { label: "Churn", weight: 20 },
  ghostRatio: { label: "Ghost ratio", weight: 15 }
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function componentTier(points: number, weight: number): HealthTier {
  const ratio = weight > 0 ? points / weight : 0;

  if (ratio >= 0.7) {
    return "healthy";
  }

  if (ratio >= 0.4) {
    return "warning";
  }

  return "critical";
}

function healthComponent(id: HealthComponentId, points: number): HealthComponentScore {
  const meta = HEALTH_COMPONENT_META[id];
  const clampedPoints = clamp(points, 0, meta.weight);

  return {
    id,
    label: meta.label,
    points: clampedPoints,
    weight: meta.weight,
    badness: clamp(1 - clampedPoints / meta.weight, 0, 1),
    tier: componentTier(clampedPoints, meta.weight)
  };
}

export function computeHealthScore(node: GraphNode): number | null {
  return node.healthScore ?? null;
}

export function getHealthTier(node: GraphNode): HealthTier {
  return node.healthTier ?? "healthy";
}

export function getHealthComponents(node: GraphNode): HealthComponents {
  return node.healthComponents ?? defaultComponents;
}

export function computeHealthDetails(node: GraphNode): HealthScoreDetails {
  const components = getHealthComponents(node);
  const score = computeHealthScore(node) ?? 0;

  return {
    score,
    tier: getHealthTier(node),
    components: {
      cyclomatic: healthComponent("cyclomatic", components.cyclomatic),
      cognitive: healthComponent("cognitive", components.cognitive),
      duplication: healthComponent("duplication", components.duplication),
      churn: healthComponent("churn", components.churn),
      ghostRatio: healthComponent("ghostRatio", components.ghostRatio)
    }
  };
}
