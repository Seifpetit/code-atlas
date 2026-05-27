import type { HighlighterCore, LanguageInput, ThemedToken } from "shiki/core";
import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

type SourceLanguage =
  | "javascript"
  | "jsx"
  | "typescript"
  | "tsx"
  | "python"
  | "json"
  | "css"
  | "scss"
  | "sass"
  | "less"
  | "html"
  | "xml"
  | "markdown"
  | "mdx"
  | "yaml"
  | "toml"
  | "powershell"
  | "shellscript";

export interface HighlightedSource {
  foreground?: string;
  tokens: ThemedToken[][];
}

const SOURCE_THEME = "dark-plus";
const SOURCE_LANGUAGE_BY_EXTENSION = new Map<string, SourceLanguage>([
  [".js", "javascript"],
  [".mjs", "javascript"],
  [".cjs", "javascript"],
  [".jsx", "jsx"],
  [".ts", "typescript"],
  [".mts", "typescript"],
  [".cts", "typescript"],
  [".tsx", "tsx"],
  [".py", "python"],
  [".json", "json"],
  [".css", "css"],
  [".scss", "scss"],
  [".sass", "sass"],
  [".less", "less"],
  [".html", "html"],
  [".xml", "xml"],
  [".svg", "xml"],
  [".md", "markdown"],
  [".mdx", "mdx"],
  [".yml", "yaml"],
  [".yaml", "yaml"],
  [".toml", "toml"],
  [".ps1", "powershell"],
  [".sh", "shellscript"]
]);

const SOURCE_GRAMMAR_LOADERS = {
  javascript: () => import("@shikijs/langs/javascript"),
  jsx: () => import("@shikijs/langs/jsx"),
  typescript: () => import("@shikijs/langs/typescript"),
  tsx: () => import("@shikijs/langs/tsx"),
  python: () => import("@shikijs/langs/python"),
  json: () => import("@shikijs/langs/json"),
  css: () => import("@shikijs/langs/css"),
  scss: () => import("@shikijs/langs/scss"),
  sass: () => import("@shikijs/langs/sass"),
  less: () => import("@shikijs/langs/less"),
  html: () => import("@shikijs/langs/html"),
  xml: () => import("@shikijs/langs/xml"),
  markdown: () => import("@shikijs/langs/markdown"),
  mdx: () => import("@shikijs/langs/mdx"),
  yaml: () => import("@shikijs/langs/yaml"),
  toml: () => import("@shikijs/langs/toml"),
  powershell: () => import("@shikijs/langs/powershell"),
  shellscript: () => import("@shikijs/langs/shellscript")
} satisfies Record<SourceLanguage, () => LanguageInput>;
const highlighterByLanguage = new Map<SourceLanguage, Promise<HighlighterCore>>();

function sourceLanguage(extension?: string): SourceLanguage | null {
  return SOURCE_LANGUAGE_BY_EXTENSION.get(String(extension ?? "").toLowerCase()) ?? null;
}

export function sourceLanguageLabel(extension?: string): string {
  const language = sourceLanguage(extension);

  switch (language) {
    case "javascript":
      return "JavaScript";
    case "jsx":
      return "JavaScript JSX";
    case "typescript":
      return "TypeScript";
    case "tsx":
      return "TypeScript JSX";
    case "python":
      return "Python";
    case "json":
      return "JSON";
    case "css":
      return "CSS";
    case "scss":
      return "SCSS";
    case "sass":
      return "Sass";
    case "less":
      return "Less";
    case "html":
      return "HTML";
    case "xml":
      return "XML";
    case "markdown":
      return "Markdown";
    case "mdx":
      return "MDX";
    case "yaml":
      return "YAML";
    case "toml":
      return "TOML";
    case "powershell":
      return "PowerShell";
    case "shellscript":
      return "Shell";
    default:
      return "Plain Text";
  }
}

function highlighterForLanguage(language: SourceLanguage): Promise<HighlighterCore> {
  const cachedHighlighter = highlighterByLanguage.get(language);

  if (cachedHighlighter) {
    return cachedHighlighter;
  }

  const highlighter = createHighlighterCore({
    themes: [import("@shikijs/themes/dark-plus")],
    langs: [SOURCE_GRAMMAR_LOADERS[language]()],
    engine: createJavaScriptRegexEngine()
  });
  highlighterByLanguage.set(language, highlighter);
  return highlighter;
}

export async function highlightSource(sourceText: string, extension?: string): Promise<HighlightedSource | null> {
  const language = sourceLanguage(extension);

  if (!language) {
    return null;
  }

  const highlighter = await highlighterForLanguage(language);
  const result = highlighter.codeToTokens(sourceText, {
    lang: language,
    theme: SOURCE_THEME
  });

  return {
    foreground: result.fg,
    tokens: result.tokens
  };
}
