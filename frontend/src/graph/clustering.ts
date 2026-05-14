export type ClusteringMode = "structural" | "functional" | "runtime";

export interface ClusteringOption {
  id: ClusteringMode;
  label: string;
  enabled: boolean;
}

export const clusteringOptions: ClusteringOption[] = [
  {
    id: "structural",
    label: "Structural",
    enabled: true
  },
  {
    id: "functional",
    label: "Functional",
    enabled: false
  },
  {
    id: "runtime",
    label: "Runtime",
    enabled: false
  }
];
