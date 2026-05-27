import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface RenderedMarkdownProps {
  sourceText: string;
}

export function RenderedMarkdown({ sourceText }: RenderedMarkdownProps) {
  return (
    <article className="source-modal__markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ children, href, ...props }) => (
            <a {...props} href={href} target="_blank" rel="noreferrer">{children}</a>
          ),
          img: ({ alt }) => (
            <span className="source-modal__markdown-image">[image: {alt || "untitled"}]</span>
          )
        }}
      >
        {sourceText}
      </ReactMarkdown>
    </article>
  );
}
