export type FilePaletteKey =
  | "javascript"
  | "python"
  | "markdown"
  | "mdx"
  | "json"
  | "yaml"
  | "toml"
  | "css"
  | "scss"
  | "sass"
  | "less"
  | "html"
  | "svg"
  | "xml"
  | "text"
  | "powershell"
  | "shell"
  | "other";

const FILE_PALETTE_BY_EXTENSION = new Map<string, FilePaletteKey>([
  [".ts", "javascript"],
  [".tsx", "javascript"],
  [".js", "javascript"],
  [".jsx", "javascript"],
  [".mts", "javascript"],
  [".cts", "javascript"],
  [".mjs", "javascript"],
  [".cjs", "javascript"],
  [".py", "python"],
  [".md", "markdown"],
  [".mdx", "mdx"],
  [".json", "json"],
  [".yml", "yaml"],
  [".yaml", "yaml"],
  [".toml", "toml"],
  [".css", "css"],
  [".scss", "scss"],
  [".sass", "sass"],
  [".less", "less"],
  [".html", "html"],
  [".svg", "svg"],
  [".xml", "xml"],
  [".txt", "text"],
  [".ps1", "powershell"],
  [".sh", "shell"]
]);

const MINIMAP_COLOR_BY_PALETTE: Record<FilePaletteKey, string> = {
  javascript: "#facc15",
  python: "#60a5fa",
  markdown: "#a78bfa",
  mdx: "#c084fc",
  json: "#fb923c",
  yaml: "#f472b6",
  toml: "#f59e0b",
  css: "#38bdf8",
  scss: "#ec4899",
  sass: "#f43f5e",
  less: "#818cf8",
  html: "#fb7185",
  svg: "#34d399",
  xml: "#22d3ee",
  text: "#94a3b8",
  powershell: "#3b82f6",
  shell: "#a3e635",
  other: "#facc15"
};

export function filePaletteForExtension(extension?: string): FilePaletteKey {
  return FILE_PALETTE_BY_EXTENSION.get(String(extension ?? "").toLowerCase()) ?? "other";
}

export function minimapColorForFile(extension?: string): string {
  return MINIMAP_COLOR_BY_PALETTE[filePaletteForExtension(extension)];
}
