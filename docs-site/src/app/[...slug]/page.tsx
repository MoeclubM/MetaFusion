import { notFound } from "next/navigation";
import { getAllDocs, getDocBySlug, extractHeadings, getAdjacent } from "@/lib/docs";
import { Markdown } from "@/components/Markdown";
import { DocsToc } from "@/components/DocsToc";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Clock, FileText } from "lucide-react";

export function generateStaticParams() {
  return getAllDocs().map((d) => ({ slug: d.slug }));
}

export function generateMetadata({ params }: { params: { slug: string[] } }) {
  const doc = getDocBySlug(params.slug);
  if (!doc) return {};
  return {
    title: doc.frontmatter.title,
    description: doc.frontmatter.description,
  };
}

export default function DocPage({ params }: { params: { slug: string[] } }) {
  const doc = getDocBySlug(params.slug);
  if (!doc) notFound();
  const headings = extractHeadings(doc.content);
  const { prev, next } = getAdjacent(doc.slugStr);

  return (
    <div className="flex">
      <div className="flex-1 min-w-0 px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
        <div className="max-w-3xl">
          <div className="mb-6 space-y-2">
            <div className="flex items-center gap-2 font-mono text-[11px] tracking-widest text-primary uppercase">
              <FileText className="w-3.5 h-3.5" />
              <span>{doc.frontmatter.group}</span>
              <span className="text-gray-400">/</span>
              <span className="text-gray-500">{doc.slugStr}</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-gray-900 dark:text-white">
              {doc.frontmatter.title}
            </h1>
            {doc.frontmatter.description && (
              <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400 leading-relaxed">
                {doc.frontmatter.description}
              </p>
            )}
          </div>

          <Markdown content={doc.content} />

          <div className="mt-10 flex flex-col sm:flex-row gap-3 border-t border-black/5 dark:border-white/[0.06] pt-6">
            {prev ? (
              <Link href={prev.href} className="flex-1 flex items-center gap-2 p-3 rounded-lg border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/[0.06] transition-colors">
                <ChevronLeft className="w-4 h-4 shrink-0" />
                <span className="text-sm">
                  <span className="block font-mono text-[11px] text-gray-500">上一篇</span>
                  <span className="font-medium text-gray-900 dark:text-white">{prev.title}</span>
                </span>
              </Link>
            ) : (
              <div className="flex-1" />
            )}
            {next ? (
              <Link href={next.href} className="flex-1 flex items-center justify-end gap-2 p-3 rounded-lg border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/[0.06] transition-colors text-right">
                <span className="text-sm">
                  <span className="block font-mono text-[11px] text-gray-500">下一篇</span>
                  <span className="font-medium text-gray-900 dark:text-white">{next.title}</span>
                </span>
                <ChevronRight className="w-4 h-4 shrink-0" />
              </Link>
            ) : (
              <div className="flex-1" />
            )}
          </div>

          <div className="mt-8 p-4 rounded-lg bg-black/[0.02] dark:bg-white/[0.04] border border-black/5 dark:border-white/[0.06] font-mono text-xs text-gray-500 flex items-center gap-2">
            <Clock className="w-3.5 h-3.5" />
            <span>文档内容与主站版本保持同步 · 最后更新 2026-08-21 · 编辑请提 PR 至 content/docs/</span>
          </div>
        </div>
      </div>

      <aside className="hidden xl:block w-[240px] shrink-0 sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto px-4 py-8">
        <DocsToc headings={headings} />
        <div className="mt-8 p-3 rounded-lg bg-primary/5 border border-primary/10 space-y-2">
          <div className="text-xs font-semibold text-primary">需要帮助？</div>
          <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">在社区发帖或通过联系方式反馈文档问题。</p>
          <Link href="/contact" className="inline-flex text-xs font-medium text-primary hover:underline">前往联系 →</Link>
        </div>
      </aside>
    </div>
  );
}
