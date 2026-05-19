export type RuntimeRelationType = "dependency" | "import" | "structural";

export interface RuntimeNode {
  id: string;
  path: string;
  depth: number;
  parentPath?: string;
  runtimeStep: number;
  structuralAncestorIds: string[];
}

export interface RuntimeEdge {
  source: string;
  target: string;
  step: number;
  relationType: RuntimeRelationType;
}

export interface RuntimeChain {
  originNodeId: string;
  nodes: RuntimeNode[];
  edges: RuntimeEdge[];
}

export interface RuntimeState {
  active: boolean;
  originNodeId: string | null;
  currentStep: number;
  chain: RuntimeChain | null;
}

export const inactiveRuntimeState: RuntimeState = {
  active: false,
  originNodeId: null,
  currentStep: 0,
  chain: null
};
