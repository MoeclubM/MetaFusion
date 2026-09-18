// 程序封面（ProceduralCover）的身份与引用码。
//
// 身份串必须与界面语言无关：以前是 `${title}_${id}`，而 title 是"当前语言的展示题名"，
// 于是同一实体在 zh-CN / en-US / ja-JP 下拿到三个不同的 REF 码和三套配色
// （2026-09-19 审计第 14 条：MF-6A5580 / MF-5AEDB1 / MF-1F8D5E，站内也没法按码检索）。
// 稳定标识只能取自与语言无关的字段：实体 id 优先，其次原语言题名，最后才是展示题名
// （没有任何身份信息时画面仍要能画出来，这只发生在无 id 的临时封面上）。
//
// 这里改的是"身份串"本身，历史封面上的旧 REF 码会随之变化。旧码是渲染时算出来的
// 显示值，不落库、不被任何接口读写（全仓 grep REF: 只有本模块与封面组件），
// 因此不需要兼容旧值。

export interface CoverIdentityInput {
  id?: string | null;
  originalTitle?: string | null;
  title?: string | null;
}

/** 与语言无关的封面身份串：同一实体在任何界面语言下都得到同一个值。 */
export function coverIdentity(input: CoverIdentityInput): string {
  const id = (input.id ?? "").trim();
  if (id) return "id:" + id;
  const original = (input.originalTitle ?? "").trim();
  if (original) return "orig:" + original;
  return "title:" + (input.title ?? "").trim();
}

/** djb2（32 位无符号）：封面配色与引用码的唯一来源。 */
export function coverHash(identity: string): number {
  let hash = 5381;
  for (let i = 0; i < identity.length; i++) {
    hash = (hash * 33) ^ identity.charCodeAt(i);
  }
  return Math.abs(hash >>> 0);
}

/** 封面引用码：MF-XXXXXX（6 位十六进制）。它只是封面上的可视标识，不是数据库字段。 */
export function coverRefCode(hash: number): string {
  return "MF-" + hash.toString(16).toUpperCase().padStart(6, "0").slice(0, 6);
}
