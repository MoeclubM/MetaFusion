import fs from "fs";
import path from "path";
import matter from "gray-matter";

export type DocFrontmatter = {
  title: string;
  description?: string;
  order?: number;
  group?: string;
  icon?: string;
};

export type DocItem = {
  slug: string[]; // e.g. ["api","auth"] or ["overview"]
  slugStr: string; // "api/auth"
  filePath: string;
  frontmatter: DocFrontmatter;
  content: string;
};

export type NavGroup = {
  title: string;
  items: NavItem[];
};

export type NavItem = {
  title: string;
  slug: string;
  href: string;
  order: number;
  description?: string;
};

const CONTENT_ROOT = path.join(process.cwd(), "content", "docs");

// group titles in order
export const GROUP_ORDER: Record<string, { title: string; order: number }> = {
  start: { title: "开始", order: 0 },
  model: { title: "典藏模型", order: 1 },
  guide: { title: "使用指南", order: 2 },
  api: { title: "API 与集成", order: 3 },
  community: { title: "社区", order: 4 },
  legal: { title: "协议与合规", order: 5 },
  meta: { title: "关于", order: 6 },
};

function walk(dir: string, out: string[] = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (ent.isFile() && ent.name.endsWith(".md")) out.push(p);
  }
  return out;
}

let _cache: DocItem[] | null = null;

export function getAllDocs(): DocItem[] {
  if (_cache) return _cache;
  if (!fs.existsSync(CONTENT_ROOT)) return [];
  const files = walk(CONTENT_ROOT);
  const docs: DocItem[] = files.map((fp) => {
    const raw = fs.readFileSync(fp, "utf-8");
    const parsed = matter(raw);
    const fm = parsed.data as DocFrontmatter;
    const rel = path.relative(CONTENT_ROOT, fp).replace(/\.md$/, "").replace(/\\/g, "/");
    // e.g. "00-overview" -> strip numeric prefix for slug but keep order via frontmatter
    const parts = rel.split("/");
    const slug = parts.map((seg) => seg.replace(/^\d+[-_]/, ""));
    const slugStr = slug.join("/");
    return {
      slug,
      slugStr,
      filePath: fp,
      frontmatter: {
        title: fm.title || slug[slug.length - 1],
        description: fm.description,
        order: fm.order ?? 999,
        group: fm.group || "meta",
        icon: fm.icon,
      },
      content: parsed.content,
    };
  });
  docs.sort((a, b) => (a.frontmatter.order! - b.frontmatter.order!) || a.slugStr.localeCompare(b.slugStr));
  _cache = docs;
  return docs;
}

export function getDocBySlug(slug: string[]): DocItem | null {
  const slugStr = slug.join("/");
  return getAllDocs().find((d) => d.slugStr === slugStr) || null;
}

export function getNavGroups(): NavGroup[] {
  const docs = getAllDocs();
  const map = new Map<string, NavItem[]>();
  for (const d of docs) {
    const g = d.frontmatter.group || "meta";
    if (!map.has(g)) map.set(g, []);
    const arr = map.get(g);
    if (arr) {
      arr.push({
        title: d.frontmatter.title,
        slug: d.slugStr,
        href: `/${d.slugStr}`,
        order: d.frontmatter.order!,
        description: d.frontmatter.description,
      });
    }
  }
  const groups: NavGroup[] = [];
  map.forEach((items, key) => {
    const meta = GROUP_ORDER[key] || { title: key, order: 99 };
    items.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
    groups.push({ title: meta.title, items });
  });
  groups.sort((a, b) => {
    const ao = Object.values(GROUP_ORDER).find((g) => g.title === a.title)?.order ?? 99;
    const bo = Object.values(GROUP_ORDER).find((g) => g.title === b.title)?.order ?? 99;
    return ao - bo;
  });
  const orderedKeys = Object.keys(GROUP_ORDER);
  groups.sort((a, b) => {
    const ai = orderedKeys.findIndex((k) => GROUP_ORDER[k].title === a.title);
    const bi = orderedKeys.findIndex((k) => GROUP_ORDER[k].title === b.title);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  return groups;
}

export function getAdjacent(slugStr: string): { prev: NavItem | null; next: NavItem | null } {
  const docs = getAllDocs();
  const idx = docs.findIndex((d) => d.slugStr === slugStr);
  if (idx === -1) return { prev: null, next: null };
  const toNav = (d: DocItem): NavItem => ({
    title: d.frontmatter.title,
    slug: d.slugStr,
    href: `/${d.slugStr}`,
    order: d.frontmatter.order!,
  });
  return {
    prev: idx > 0 ? toNav(docs[idx - 1]) : null,
    next: idx < docs.length - 1 ? toNav(docs[idx + 1]) : null,
  };
}

export type Heading = { id: string; text: string; level: number };

export function extractHeadings(markdown: string): Heading[] {
  const re = /^(#{2,3})\s+(.+)$/gm;
  const out: Heading[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown))) {
    const level = m[1].length;
    const text = m[2].replace(/\s*\{[^}]+\}\s*$/, "").trim();
    const id = text
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fa5\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-");
    out.push({ id, text, level });
  }
  return out;
}
