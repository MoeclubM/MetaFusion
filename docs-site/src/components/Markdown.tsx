"use client";
import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeHighlight from "rehype-highlight";
import { Copy, Check } from "lucide-react";
import { ApiPlayground } from "./ApiPlayground";

function CodeBlock({ children, className }: { children: React.ReactNode; className?: string }) {
  const [copied, setCopied] = React.useState(false);
  const ref = React.useRef<HTMLPreElement>(null);
  const copy = async () => {
    const text = ref.current?.innerText || "";
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  const lang = className?.replace("language-", "") || "";
  if (lang === "playground") {
    return <ApiPlayground />;
  }
  return (
    <div className="relative group my-4 rounded-lg border border-white/10 bg-[#0b0e14] overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-white/[0.04] border-b border-white/10">
        <span className="font-mono text-[11px] text-white/50 uppercase tracking-widest">{lang || "code"}</span>
        <button onClick={copy} className="inline-flex items-center gap-1 text-[11px] font-mono text-white/60 hover:text-white">
          {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <pre ref={ref} className="p-4 text-[13px] leading-relaxed overflow-x-auto">
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

export function Markdown({ content }: { content: string }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSlug, [rehypeAutolinkHeadings, { behavior: "wrap" }], rehypeHighlight]}
        components={{
          pre: ({ children }) => <>{children}</>,
          code({ className, children }) {
            const text = String(children);
            const isBlock = !!className || text.includes("\n");
            if (isBlock) return <CodeBlock className={className}>{children}</CodeBlock>;
            return <code className={className}>{children}</code>;
          },
          a({ href, children, title }) {
            const isExternal = href?.startsWith("http");
            return (
              <a href={href} title={title} target={isExternal ? "_blank" : undefined} rel={isExternal ? "noopener noreferrer" : undefined}>
                {children}
              </a>
            );
          },
          h1({ children, id }) {
            return <h1 id={id}>{children}</h1>;
          },
          h2({ children, id }) {
            return <h2 id={id}>{children}</h2>;
          },
          h3({ children, id }) {
            return <h3 id={id}>{children}</h3>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
