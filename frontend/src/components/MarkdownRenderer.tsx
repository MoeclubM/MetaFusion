"use client";

import React, { useState, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import { Check, Copy, ExternalLink } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

import "katex/dist/katex.min.css";
import "highlight.js/styles/github-dark.css";

interface MarkdownRendererProps {
  content: string;
  className?: string;
  compact?: boolean;
}

/**
 * Normalizes LaTeX delimiters so that \( ... \) becomes $ ... $
 * and \[ ... \] becomes $$ ... $$ (without affecting code blocks / spans).
 */
export function normalizeLatexDelimiters(text: string): string {
  if (!text) return "";
  const parts = text.split(/(```[\s\S]*?```|`[^`\n]+`)/g);
  return parts
    .map((part, i) => {
      // Code block or inline code span: keep verbatim
      if (i % 2 === 1) return part;
      return part
        .replace(/\\\[([\s\S]*?)\\\]/g, (_, formula) => `$$${formula}$$`)
        .replace(/\\\(([\s\S]*?)\\\)/g, (_, formula) => `$${formula}$`);
    })
    .join("");
}

function CodeBlockWrapper({
  language,
  code,
  children,
}: {
  language?: string;
  code: string;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div className="relative group my-3 rounded-lg overflow-hidden border border-black/10 dark:border-white/10 bg-[#0d1117] shadow-xs">
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#161b22] border-b border-white/5 text-xs text-gray-400 font-mono select-none">
        <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{language || "code"}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white/5 hover:bg-white/15 text-gray-300 hover:text-white transition-colors cursor-pointer text-[11px]"
          title={t("common.copy")}
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-emerald-400" />
              <span className="text-emerald-400 font-medium">{t("common.copied")}</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              <span>{t("common.copy")}</span>
            </>
          )}
        </button>
      </div>
      <div className="p-3.5 overflow-x-auto text-xs sm:text-sm font-mono text-gray-200 leading-relaxed scrollbar-thin">
        {children}
      </div>
    </div>
  );
}

export default function MarkdownRenderer({
  content,
  className = "",
  compact = false,
}: MarkdownRendererProps) {
  const normalizedContent = useMemo(() => normalizeLatexDelimiters(content), [content]);

  return (
    <div
      className={`markdown-body text-gray-800 dark:text-gray-200 break-words leading-relaxed text-sm ${
        compact ? "compact-markdown space-y-1.5" : "space-y-2.5"
      } ${className}`}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: true }]]}
        rehypePlugins={[rehypeKatex, [rehypeHighlight, { ignoreMissing: true }]]}
        components={{
          h1: ({ ...props }) => (
            <h1
              className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white mt-4 mb-2 pb-1.5 border-b border-black/10 dark:border-white/10 tracking-tight"
              {...props}
            />
          ),
          h2: ({ ...props }) => (
            <h2
              className="text-base sm:text-lg font-bold text-gray-900 dark:text-white mt-3.5 mb-1.5 pb-1 border-b border-black/5 dark:border-white/5 tracking-tight"
              {...props}
            />
          ),
          h3: ({ ...props }) => (
            <h3 className="text-sm sm:text-base font-semibold text-gray-900 dark:text-white mt-3 mb-1" {...props} />
          ),
          h4: ({ ...props }) => (
            <h4 className="text-xs sm:text-sm font-semibold text-gray-900 dark:text-white mt-2 mb-1" {...props} />
          ),
          p: ({ ...props }) => <p className="my-1.5 leading-relaxed" {...props} />,
          ul: ({ ...props }) => <ul className="list-disc list-outside pl-5 my-2 space-y-1" {...props} />,
          ol: ({ ...props }) => <ol className="list-decimal list-outside pl-5 my-2 space-y-1" {...props} />,
          li: ({ ...props }) => <li className="leading-relaxed" {...props} />,
          blockquote: ({ ...props }) => (
            <blockquote
              className="border-l-3 border-emerald-500/70 dark:border-emerald-500/50 bg-emerald-500/5 dark:bg-emerald-500/10 px-3.5 py-1.5 my-2 rounded-r text-gray-700 dark:text-gray-300 italic"
              {...props}
            />
          ),
          hr: ({ ...props }) => <hr className="my-3.5 border-black/10 dark:border-white/10" {...props} />,
          table: ({ ...props }) => (
            <div className="overflow-x-auto my-3 rounded-lg border border-black/10 dark:border-white/10">
              <table className="min-w-full divide-y divide-black/10 dark:divide-white/10 text-left text-xs sm:text-sm" {...props} />
            </div>
          ),
          thead: ({ ...props }) => (
            <thead className="bg-black/5 dark:bg-white/5 font-semibold text-gray-900 dark:text-white" {...props} />
          ),
          tbody: ({ ...props }) => (
            <tbody className="divide-y divide-black/5 dark:divide-white/5 bg-transparent" {...props} />
          ),
          tr: ({ ...props }) => (
            <tr className="hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors" {...props} />
          ),
          th: ({ ...props }) => <th className="px-3 py-2 font-semibold text-gray-900 dark:text-white" {...props} />,
          td: ({ ...props }) => <td className="px-3 py-2 text-gray-800 dark:text-gray-200" {...props} />,
          a: ({ href, children, ...props }) => {
            const isExternal = href?.startsWith("http://") || href?.startsWith("https://");
            return (
              <a
                href={href}
                target={isExternal ? "_blank" : undefined}
                rel={isExternal ? "noopener noreferrer" : undefined}
                className="text-primary hover:underline underline-offset-2 font-medium transition-colors inline-flex items-center gap-0.5"
                {...props}
              >
                <span>{children}</span>
                {isExternal && <ExternalLink className="w-3 h-3 opacity-60 inline-block shrink-0" />}
              </a>
            );
          },
          img: ({ ...props }) => (
            <img
              className="rounded-lg max-h-96 max-w-full object-contain my-2.5 border border-black/10 dark:border-white/10 shadow-xs"
              loading="lazy"
              {...props}
            />
          ),
          del: ({ ...props }) => <del className="line-through text-gray-400 dark:text-gray-500" {...props} />,
          code: ({ node, className, children, ...props }: any) => {
            const match = /language-(\w+)/.exec(className || "");
            const isMultiLine = String(children).includes("\n");
            if (match || isMultiLine) {
              const language = match ? match[1] : "";
              const codeString = String(children).replace(/\n$/, "");
              return (
                <CodeBlockWrapper language={language} code={codeString}>
                  <pre className="!bg-transparent !p-0 !m-0 overflow-x-auto">
                    <code className={className} {...props}>
                      {children}
                    </code>
                  </pre>
                </CodeBlockWrapper>
              );
            }
            return (
              <code
                className="px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 text-amber-600 dark:text-amber-400 font-mono text-[0.875em] break-all border border-black/5 dark:border-white/5"
                {...props}
              >
                {children}
              </code>
            );
          },
        }}
      >
        {normalizedContent}
      </ReactMarkdown>
    </div>
  );
}
