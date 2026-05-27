import type { HighlighterCore, LanguageInput, ThemedToken } from "shiki/core";
import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

type SourceLanguage = "javascript" | "jsx" | "typescript" | "tsx" | "json" | "css";

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
  [".json", "json"],
  [".css", "css"]
]);

const SOURCE_GRAMMAR_LOADERS = {
  javascript: () => import("@shikijs/langs/javascript"),
  jsx: () => import("@shikijs/langs/jsx"),
  typescript: () => import("@shikijs/langs/typescript"),
  tsx: () => import("@shikijs/langs/tsx"),
  json: () => import("@shikijs/langs/json"),
  css: () => import("@shikijs/langs/css")
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
    case "json":
      return "JSON";
    case "css":
      return "CSS";
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
