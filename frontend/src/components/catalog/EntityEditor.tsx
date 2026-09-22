"use client";
import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/i18n/I18nProvider";
import { api, Entity, emptyEntity, kinds as fallbackKinds, local, Source } from "./api";
import { canPublishEntity } from "@/lib/permissions";
import { localizeCatalogError } from "@/lib/catalogErrors";
import { newSubmissionSession, submissionKey } from "@/lib/idempotency";
import { useAuth } from "@/lib/authContext";
import { getAuthLoginUrl } from "@/lib/services";
import { EntityPicker, Evidence, FieldInput, ErrorMessage, GroupFieldInput } from "./Fields";
import { LanguagePicker } from "@/components/common/LanguagePicker";
import { RelationEditorField, type RelationDraft } from "@/components/editor/RelationEditorField";
import { effectiveSchemeFields, getFieldName, getKindName, getTypeName, kindApplicableFields, matchSchemes, resolveKindOptions, useDefinitions } from "@/lib/definitions";
import { canonicalLanguageCode, languageLabel, quickLanguages } from "@/lib/languages";

/** 生效类型：原样使用实体自带的 types（老实体不清空、新建不推导）。
 *  与后端同口径（见 validation.go 的 effectiveOwnerTypes / attributeKeys / matchSchemes）：
 *  声明了就按声明取允许字段，写超集字段报 unknown_field（见 attributes）；
 *  空 types 回退到该 kind 的启用类型集合，仅兼容历史无类型实体与导入载荷——
 *  新写必须显式声明 types，前端由 save 入口拦截，后端同样不把回退写回 e.Types
 *  （自动加全部 types 会把一部小说同时标为音乐、动画、游戏）。模板只控制
 *  编辑与展示，不参与适用性判定。 */
function effectiveTypesOf(
  defs: { types?: Record<string, { kinds: string[]; enabled: boolean }> } | undefined,
  kind: string,
  types: string[],
): string[] {
  void defs;
  void kind;
  return types;
}

/** 标签分隔符：中英文逗号/顿号/换行都算新增，避免只能靠回车。 */
const TAG_SEPARATORS = /[,，、\n]/;

export function EntityEditor({
  initial,
  initialKind,
  onSaved,
  initialEditNote = "",
  initialSources,
}: {
  initial?: Entity;
  /** 新建时的预选层级（来自 /new?kind=…，如贡献页与 /works/new 等旧入口重定向）；
   *  只接受骨架里的合法层级，非法值回落到 emptyEntity 的默认值。 */
  initialKind?: string;
  onSaved?: (e: Entity) => void;
  initialEditNote?: string;
  initialSources?: Source[];
}) {
  const { t, tr, locale } = useI18n();
  // 会话来自 useAuth（唯一来源），定义来自 useDefinitions（唯一缓存）：
  // CatalogProvider 不再存这两份，本组件也不该依赖它被挂载。
  const { user } = useAuth();
  const { definitions, kinds: serverKinds } = useDefinitions();
  const router = useRouter();
  // definitions：定位字段等由它声明，避免编辑器写死字段码。
  const defs = definitions ?? undefined;
  // 层级名与可选项：服务端 definitions.kinds 优先，服务端未给时才退回内置骨架清单，
  // 字典只作名称兜底（缺键退原始码）；后台改骨架名/停用种类前端即跟随。
  const kindLabel = (code: string) =>
    getKindName(serverKinds, code, locale, tr(`catalog.kind.${code}`, code));
  const kindOptions = useMemo(() => resolveKindOptions(serverKinds, fallbackKinds), [serverKinds]);
  const [e, setE] = useState<Entity>(() => ({
    ...emptyEntity(initial?.kind || (initialKind && kindOptions.includes(initialKind) ? initialKind : undefined)),
    ...initial,
    types: initial?.types || [],
    attributes: initial?.attributes || {},
    translations: initial?.translations || {},
    pictures: initial?.pictures || [],
    external_ids: initial?.external_ids || {},
    contents: initial?.contents || [],
    subjects: initial?.subjects || [],
  }));
  // 结构属性按 scheme 收敛：与后端同一匹配规则；无匹配 scheme 时显示
  // 全部全局子字段（向后兼容）。定位子字段顺序：有匹配时按 scheme 并集
  // 顺序（relative_to 锚点置前），无匹配时按全局声明顺序（锚点置前）。
  const kindKey = e.kind;
  const typesKey = JSON.stringify(e.types);
  // D3 单适用类型自动采用（与后端 soleEnabledType 同口径）：kindTypeOptions 只有一个
  // 启用类型时（如 medium 只有 medium）直接采用，不让用户重复勾选“介质的类型=介质”；
  // 多类型 kind 仍须手动选择（save 入口拦截）。逗号拼接即比较键：类型码不含逗号。
  const kindTypeOptionsKey = useMemo(() => {
    if (!defs) return "";
    return Object.entries(defs.types || {})
      .filter(([, v]) => v.enabled && (v.kinds || []).includes(kindKey))
      .map(([code]) => code)
      .sort()
      .join(",");
  }, [defs, kindKey]);
  useEffect(() => {
    if (!e.id && e.types.length === 0 && kindTypeOptionsKey && !kindTypeOptionsKey.includes(",")) {
      setE({ ...e, types: [kindTypeOptionsKey] });
    }
    // 只在新建/类型/候选变化时补一次：提交后 types 非空即停，不与用户勾选竞争。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e.id, typesKey, kindTypeOptionsKey]);
  const effTypes = React.useMemo(
    () => effectiveTypesOf(defs, kindKey, JSON.parse(typesKey)),
    [defs, kindKey, typesKey],
  );
  const locatorFieldKeys = React.useMemo(() => {
    const matched = matchSchemes(defs as any, "locator", kindKey, effTypes);
    const union = effectiveSchemeFields(matched);
    const f: any = defs?.fields?.["locator"];
    const keys = union.length > 0 ? union.filter((k) => f?.fields?.[k]) : Object.keys(f?.fields || {});
    const anchor = f?.anchor_key;
    return anchor && keys.includes(anchor) ? [anchor, ...keys.filter((k) => k !== anchor)] : keys;
  }, [defs, kindKey, effTypes]);
  // 两个 GroupFieldInput 的收敛码：无匹配时传 undefined（显示全部全局子字段）。
  const subjectCodes = React.useMemo(() => {
    const union = effectiveSchemeFields(matchSchemes(defs as any, "subject_attributes", kindKey, effTypes));
    return union.length > 0 ? union : undefined;
  }, [defs, kindKey, effTypes]);
  const inclusionCodes = React.useMemo(() => {
    const union = effectiveSchemeFields(matchSchemes(defs as any, "inclusion_attributes", kindKey, effTypes));
    return union.length > 0 ? union : undefined;
  }, [defs, kindKey, effTypes]);
  const [note, setNote] = useState(initialEditNote);
  // 新建条目时关系先入队：条目拿到 id 之后再逐条写入（见 save）。
  const [pendingRelations, setPendingRelations] = useState<RelationDraft[]>([]);
  // 幂等键的会话部分：同一次编辑会话内稳定，载荷指纹在提交时算（见 lib/idempotency）。
  const submitSession = React.useRef("");
  const submissionScope = () => (submitSession.current ||= newSubmissionSession());
  const [sources, setSources] = useState<Source[]>(initialSources || [
    { kind: "self", citation: "" },
  ]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // 新增语种走可搜索的语言选择器，组件里不再留"待确认的语言代码"输入态。
  const [externalKey, setExternalKey] = useState("");
  // 标签输入框的待确认文本（回车/逗号才落到 attributes.tags）。
  const [tagInput, setTagInput] = useState("");
  // 历史无类型实体适用字段发现入口的待选项（选中后点添加才落到 attributes）。
  const [compatFieldPick, setCompatFieldPick] = useState("");
  // 当前编辑的语种；空串表示跟随原始语言（用户还没手动切换过）。
  const [localePick, setLocalePick] = useState("");
  if (!definitions) return <p>{t("catalog.loading")}</p>;
  if (!user) {
    // ?edit=1 已由 AuthGate 纳入登录闸门（未登录先跳 /login 并带回完整目标）。这里只兜底
    // 闸门判定生效前的一帧与编辑中途掉登录态：所以必须留登录出口——原来只回一句没有链接、
    // 没有跳转的文本，分享出去的编辑链接就是个死胡同。
    // getAuthLoginUrl() 不带参即用 window.location.href 做回跳目标，深链逐字保留；
    // 本分支只可能在客户端渲染（上面 definitions 未就绪时已经 return）。
    return (
      <div className="space-y-3 py-6">
        <p className="text-sm text-text-muted">{t("catalog.loginToEdit")}</p>
        <a
          href={getAuthLoginUrl()}
          className="inline-flex items-center gap-1.5 px-4 h-9 rounded-lg bg-primary text-white keep-white text-sm font-semibold mf-focus"
        >
          {t("nav.login")}
        </a>
      </div>
    );
  }
  const d = definitions;
  // 本层级可选的业务类型：enabled 且声明归属本 kind；勾选即随条目真实保存，
  // 服务端按所选 types 校验字段（与保存/预检同一口径），不做全量推导。
  // 与上面的 kindTypeOptionsKey 同源（排序后拆回）：单候选时已被 effect 自动采用。
  const kindTypeOptions: string[] = kindTypeOptionsKey ? kindTypeOptionsKey.split(",") : [];
  const patch = (v: Partial<Entity>) => setE({ ...e, ...v });
  // ---- 标签：自由字符串列表，只承载检索/分组，不兼任业务分类（不造分类树）；
  // 业务类型另有复选框（见身份区末尾），勾选随条目保存、决定字段约束。----
  const tags: string[] = Array.isArray(e.attributes?.tags)
    ? (e.attributes.tags as unknown[]).map((v) => String(v ?? "").trim()).filter(Boolean)
    : [];
  const setTags = (next: string[]) => patch({ attributes: { ...e.attributes, tags: next } });
  const addTags = (raw: string) => {
    const parts = raw.split(TAG_SEPARATORS).map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    const seen = new Set(tags);
    setTags([...tags, ...parts.filter((v) => !seen.has(v))]);
    setTagInput("");
  };

  // ---- 多语言：选择器只渲染当前语种，语种一多不再一次铺开 ----
  // 语种标签走语言单一来源：表内语种显示「自称 (规范码)」，表外语种回落代码本身。
  const localeLabel = (code: string) => languageLabel(code);
  // 选项 = 原始语言 + 已添加语种 + 常用语种；常用语种来自语言单一来源的快捷列表，
  // 名称是语言表里的自称，不在组件里另抄语种清单、也不写死语言名。
  const localeOptions = (() => {
    const seen = new Set<string>();
    const out: { code: string; label: string }[] = [];
    const push = (raw: string) => {
      const code = String(raw || "").trim();
      if (!code || seen.has(code)) return;
      seen.add(code);
      out.push({ code, label: localeLabel(code) });
    };
    push(e.original_language);
    Object.keys(e.translations).forEach(push);
    quickLanguages().forEach((l) => push(l.code));
    return out;
  })();
  // chips：原始语言 + 已添加语种；原始语言不可删除（题名只读，来自实体基础题名）。
  const localeCodes = (() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of [e.original_language, ...Object.keys(e.translations)]) {
      const code = String(raw || "").trim();
      if (code && !seen.has(code)) {
        seen.add(code);
        out.push(code);
      }
    }
    return out;
  })();
  const activeLocale =
    localePick || e.original_language || Object.keys(e.translations)[0] || "";
  const isOriginalLocale = !!activeLocale && activeLocale === e.original_language;
  const activeTr = e.translations[activeLocale] || { title: "", summary: "", aliases: [] };
  const setTranslation = (v: { title?: string; summary?: string; aliases?: string[] }) => {
    if (!activeLocale) return;
    patch({
      translations: {
        ...e.translations,
        [activeLocale]: {
          // 原始语言的题名就是实体基础题名（在身份区维护），这里不覆盖它。
          title: isOriginalLocale ? e.title : v.title ?? activeTr.title ?? "",
          summary: v.summary ?? activeTr.summary ?? "",
          aliases: v.aliases ?? activeTr.aliases ?? [],
        },
      },
    });
  };
  const addLocale = (raw: string) => {
    // 归一后再写入：ja / JA / jpn 都落成 ja-JP，避免同一语种在 translations 里出现两个键；
    // 不合法（含空格、空串）直接丢弃——语种是否在候选表里不设限制。
    const code = canonicalLanguageCode(raw);
    if (!code) return;
    if (!e.translations[code]) {
      // 新语种行沿用旧行为：题名先预填实体基础题名，避免空题名发不出去。
      patch({
        translations: {
          ...e.translations,
          [code]: { title: e.title, summary: "", aliases: [] },
        },
      });
    }
    setLocalePick(code);
  };
  const removeLocale = (code: string) => {
    // 原始语言行不可删：它的题名就是实体基础题名，删掉多语言区就失去锚点。
    if (code === e.original_language) return;
    patch({
      translations: Object.fromEntries(
        Object.entries(e.translations).filter(([k]) => k !== code),
      ),
    });
    if (localePick === code) setLocalePick("");
  };
  const fields = Array.from(
    new Set([
      ...effTypes.flatMap((k) => d.types[k]?.fields || []),
      ...Object.keys(e.attributes),
    ]),
  );
  // 动态结构：合并实体已选类型引用模板的 sections（保序去重）；剩余字段归入"其它信息"。
  // hidden 只表示"不进详情信息面板"，不代表不可编辑：这类字段（存档/检索用）
  // 收进折叠区仍可维护，否则 hidden + required 会变成填不出、存不下的死锁。
  // 注意：此处位于条件 return 之后，必须用普通计算，不得改成 useMemo。
  const sections: { names: Record<string, string>; fields: string[] }[] = [];
  let restFields: string[] = [];
  let foldedFields: string[] = [];
  {
    const declared = new Set(fields);
    const seen = new Set<string>();
    // 同名分区合并：字段来自已选类型的模板，而各模板都有自己的"基本信息"，
    // 不合并就会出现多个同名分区（与"合并各类型模板 sections"的既有意图一致）。
    const byName = new Map<string, { names: Record<string, string>; fields: string[] }>();
    for (const tc of effTypes) {
      const tpl = d.templates?.[d.types[tc]?.template || ""];
      for (const sec of tpl?.sections || []) {
        const fs = (sec.fields || []).filter(
          (f: string) =>
            declared.has(f) &&
            !seen.has(f) &&
            (!d.fields[f]?.hidden || f === "tags") &&
            d.fields[f],
        );
        if (!fs.length) continue;
        fs.forEach((f: string) => seen.add(f));
        const key = JSON.stringify(sec.names || {});
        const merged = byName.get(key);
        if (merged) merged.fields.push(...fs);
        else byName.set(key, { names: sec.names || {}, fields: [...fs] });
      }
    }
    sections.push(...Array.from(byName.values()));
    // tags 已在身份区有专用标签输入，不再在"其它信息"里重复列出。
    restFields = fields.filter((f) => f !== "tags" && !seen.has(f) && !d.fields[f]?.hidden);
    // 折叠区：hidden 字段（tags 已有专用编辑入口，不重复列出）。
    foldedFields = fields.filter(
      (f) => !seen.has(f) && !!d.fields[f]?.hidden && f !== "tags",
    );
  }
  // 历史无类型实体的适用字段发现入口：后端 attributeKeys 空分支回退到本 kind
  // 启用类型并集（仅兼容历史），已存属性走上面的兼容展示，这里只列出尚未展示、
  // 当前仍启用的可加字段。新建与已声明类型的实体不需要它（字段集即所选类型并集）。
  const shownFields = new Set(fields);
  const compatFieldOptions: string[] =
    e.id && e.types.length === 0
      ? kindApplicableFields(d, e.kind).filter(
          (f) => !shownFields.has(f) && d.fields[f]?.enabled !== false,
        )
      : [];
  const save = async (ev: React.FormEvent) => {
    ev.preventDefault();
    // 新写显式声明 types（D3，与后端 Save 同口径）：新建（无 id）必须至少带一个业务类型，
    // 否则可用字段无从确定；单候选 kind 已被 effect 自动采用（此处再兜一次，防 effect 未跑完就提交）。
    // 该层级暂无可用类型时不拦（否则该层级永远建不出条目）。
    // 历史回退仅限真实旧数据：后端按主键 UUIDv7 创建时间判定（见 isLegacyUntyped），
    // 口径生效点之后建的无类型实体补属性同样要先声明 types，此处不再为“有 id 即历史”放行。
    const adoptedTypes = e.types.length > 0 ? e.types : kindTypeOptions.length === 1 ? kindTypeOptions : [];
    if (!e.id && adoptedTypes.length === 0 && kindTypeOptions.length > 0) {
      setError(t("catalog.typesRequiredForNew"));
      return;
    }
    // 应用层证据校验：HTML required 的原生气泡在部分环境不可见，
    // 曾表现为"点保存没反应"；noValidate 后统一在此给出明确提示。
    const missingEvidence =
      !note.trim() ||
      sources.length === 0 ||
      sources.some(
        (s) =>
          !s.citation.trim() ||
          (s.kind === "url" && !/^https?:\/\/[^\s]+\.[^\s]+/i.test(s.url || "")),
      );
    if (missingEvidence || !e.title.trim()) {
      setError(t("catalog.evidenceRequired"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      // 建实体带上幂等键：双击保存 / 超时重发复用同一个键，服务端只建一个实体。
      // PUT 不带（幂等键服务端只覆盖两个 POST 端点，见 lib/idempotency 的说明）。
      // 单候选自动采用随提交带上：与 effect 同值，effect 未跑完时这里兜底。
      const body = { entity: { ...e, types: adoptedTypes }, expected_version: e.version, edit_note: note, sources };
      const out = await api<Entity>(
        e.id ? `/catalog/entities/${e.id}` : "/catalog/entities",
        e.id ? "PUT" : "POST",
        body,
        e.id ? undefined : { "Idempotency-Key": submissionKey(submissionScope(), body) },
      );
      // 排队的关系：条目已在，逐条写入。失败不静默——列出失败项让用户决定重试哪条。
      // 部分成功时：成功实体 id/version 写回状态（重试走 PUT，不重复建条目），
      // 失败草稿保留、只重试失败项；全部成功才清空并继续跳转。
      if ((out.id || e.id) && pendingRelations.length > 0) {
        const savedId = out.id || e.id;
        const failures: string[] = [];
        const failed: RelationDraft[] = [];
        let flushed = 0;
        for (const d of pendingRelations) {
          try {
            // 同一条待提交关系在重试里复用同一个键（键 = 会话 + 关系载荷指纹），
            // 不再每次现生成 UUID——否则超时后重试会重复建边。
            const relation = {
              type: d.type,
              source_id: d.forward ? savedId : d.targetId,
              target_id: d.forward ? d.targetId : savedId,
              position: d.position,
              attributes: d.attributes,
            };
            await api(
              "/catalog/relations",
              "POST",
              { relation, expected_version: 0, edit_note: note, sources },
              { "Idempotency-Key": submissionKey(submissionScope(), relation) },
            );
            flushed += 1;
          } catch (err) {
            failures.push(d.type + ": " + (err as Error).message);
            failed.push(d);
          }
        }
        // 写后回读：服务端返回即全量回读，写回状态使重试走 PUT。
        setE(out);
        setPendingRelations(failed);
        if (failures.length > 0) {
          setError(
            flushed > 0
              ? t("editor.relation.flushPartial", {
                  ok: flushed,
                  fail: failures.length,
                  list: failures.join("；"),
                })
              : t("editor.relation.flushFailed", { list: failures.join("；") }),
          );
          setBusy(false);
          return;
        }
      }
      if (onSaved) onSaved(out);
      else router.push(`/catalog/${out.id}`);
    } catch (err) {
      setError(localizeCatalogError((err as Error).message, t));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={save} noValidate className="cv-form">
      <div className="cv-heading">
        <h1>{t(initial ? "catalog.edit" : "catalog.create")}</h1>
        <button className="cv-primary" disabled={busy}>
          {t(busy ? "catalog.saving" : "catalog.save")}
        </button>
      </div>
      <ErrorMessage error={error} />
      <fieldset>
        <legend>{t("catalog.identity")}</legend>
        <div className="cv-grid">
          <label>
            {t("catalog.kindLabel")}
            <select
              value={e.kind}
              disabled={!!e.id}
              onChange={(x) =>
                setE({ ...emptyEntity(x.target.value), title: e.title })
              }
            >
              {kindOptions.map((k) => (
                <option key={k} value={k}>
                  {kindLabel(k)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("catalog.title")}
            <input
              required
              value={e.title}
              onChange={(x) => patch({ title: x.target.value })}
            />
          </label>
          <label>
            {t("catalog.originalLanguage")}
            <input
              value={e.original_language}
              onChange={(x) => patch({ original_language: x.target.value })}
            />
          </label>
          <label>
            {t("catalog.status")}
            <select
              value={e.status}
              onChange={(x) => patch({ status: x.target.value })}
            >
              {(
                initial?.status === "published"
                  ? ["published"]
                  : [
                      "draft",
                      "pending_review",
                      // user 走审核制（草稿/待审）；editor/admin 可直接发布
                      // 自己的条目（新建无 created_by 即视为自己）。
                      ...(canPublishEntity(user, initial) ? ["published"] : []),
                    ]
              ).map((k) => (
                <option key={k} value={k}>
                  {t(`catalog.state.${k}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {/* 自由标签：只承载检索/分组用标签，值落在 attributes.tags，
            详情页标签区块与 /explore?tags= 检索都读它，不兼任业务分类。 */}
        <div className="cv-tags">
          <label>
            {t("catalog.tagsLabel")}
            <input
              aria-label={t("catalog.tagsLabel")}
              placeholder={t("catalog.tagsPlaceholder")}
              value={tagInput}
              onChange={(x) => setTagInput(x.target.value)}
              onKeyDown={(ev) => {
                // 输入法组合中的回车/逗号是候选确认，不能当分隔符
                if (ev.nativeEvent.isComposing) return;
                if (ev.key === "Enter" || ev.key === "," || ev.key === "，") {
                  ev.preventDefault();
                  addTags(tagInput);
                }
              }}
              onBlur={() => addTags(tagInput)}
            />
          </label>
          {tags.length > 0 && (
            <div className="cv-taglist">
              {tags.map((tag) => (
                <span key={tag} className="cv-tag">
                  {tag}
                  <button
                    type="button"
                    aria-label={`${tag} · ${t("catalog.remove")}`}
                    onClick={() => setTags(tags.filter((v) => v !== tag))}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <p className="cv-hint">{t("catalog.tagsHint")}</p>
        </div>
        {/* 业务类型：显式勾选，随条目真实保存（save 的 entity.types 原样提交）。
            新建必须至少带一个（单候选自动采用，多候选由 save 入口拦截，决定可用字段）；
            真实旧数据的无类型实体留空即兼容维护——后端按主键创建时间回退到本 kind
            启用类型并集，前端不替它补全量，避免小说被标成音乐/动画/游戏。 */}
        <div className="cv-tags">
          <strong>{t("catalog.businessTypes")}</strong>
          {kindTypeOptions.length === 0 ? (
            <p className="cv-hint">{t("catalog.noTypesForKind")}</p>
          ) : (
            <div className="cv-checks">
              {kindTypeOptions.map((code) => (
                <label key={code}>
                  <input
                    type="checkbox"
                    checked={e.types.includes(code)}
                    onChange={(x) =>
                      patch({
                        types: x.target.checked
                          ? [...e.types, code]
                          : e.types.filter((v) => v !== code),
                      })
                    }
                  />
                  {getTypeName(defs as any, code, locale) || code}
                </label>
              ))}
            </div>
          )}
          <p className="cv-hint">{t("catalog.businessTypesHint")}</p>
        </div>
      </fieldset>
      <fieldset>
        <legend>{t("catalog.translations")}</legend>
        {/* 语种选择器 + 当前语种字段：语种一多不再每语种铺一块。
            下拉选项来自已添加语种；新增语种走可搜索的语言选择器（不必知道代码）。 */}
        <div className="cv-row cv-localebar">
          <label>
            {t("catalog.translationLocale")}
            <select
              aria-label={t("catalog.translationLocale")}
              value={activeLocale}
              onChange={(x) => addLocale(x.target.value)}
            >
              {!activeLocale && <option value="">{t("catalog.select")}</option>}
              {localeOptions.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <LanguagePicker
            selected={localeCodes}
            onSelect={addLocale}
            label={t("catalog.addLocale")}
            ariaLabel={t("catalog.addLocale")}
            variant="field"
          />
        </div>
        {/* 已添加语种 chips：点击切换、× 删除；原始语言行不可删（题名只读，来自基础题名）。 */}
        <div className="cv-localechips">
          {localeCodes.map((loc) => {
            const isOriginal = loc === e.original_language;
            return (
              <span
                key={loc}
                className={`cv-localechip${loc === activeLocale ? " is-active" : ""}`}
              >
                <button
                  type="button"
                  aria-pressed={loc === activeLocale}
                  onClick={() => setLocalePick(loc)}
                >
                  {localeLabel(loc)}
                  {isOriginal && ` · ${t("revisions.fieldOriginalLanguage")}`}
                </button>
                {!isOriginal && (
                  <button
                    type="button"
                    aria-label={`${loc} · ${t("catalog.remove")}`}
                    onClick={() => removeLocale(loc)}
                  >
                    ×
                  </button>
                )}
              </span>
            );
          })}
        </div>
        {activeLocale ? (
          /* 原始语言与其它语种共用一套字段（题名/简介/别名），只是原始语言的题名只读：
             原语言简介必须落在 translations[original_language].summary，
             曾把简介写进别名字段，多语言简介等于缺失。 */
          <div className="cv-group">
            <strong>{localeLabel(activeLocale)}</strong>{" "}
            {isOriginalLocale && (
              <span className="text-xs opacity-60">
                {t("revisions.fieldOriginalLanguage")}
              </span>
            )}
            <label>
              {t("catalog.title")}
              <input
                aria-label={`${activeLocale} · ${t("catalog.title")}`}
                value={isOriginalLocale ? e.title : activeTr.title}
                disabled={isOriginalLocale}
                onChange={(x) => setTranslation({ title: x.target.value })}
              />
            </label>
            <label>
              {t("catalog.summary")}
              <textarea
                aria-label={`${activeLocale} · ${t("catalog.summary")}`}
                value={activeTr.summary || ""}
                onChange={(x) => setTranslation({ summary: x.target.value })}
              />
            </label>
            <label>
              {t("catalog.aliases")}
              <textarea
                aria-label={`${activeLocale} · ${t("catalog.aliases")}`}
                value={(activeTr.aliases || []).join("\n")}
                onChange={(x) =>
                  setTranslation({ aliases: x.target.value.split("\n").filter(Boolean) })
                }
              />
            </label>
          </div>
        ) : (
          <p className="cv-hint">{t("catalog.translationEmpty")}</p>
        )}
        <p className="text-xs opacity-60">{t("catalog.translationHint")}</p>
      </fieldset>
      {/* 结构区仅在当前层级有字段或收录入口时显示。 */}
      {(((defs?.structure?.[e.kind]?.fields) || []).length > 0 || defs?.structure?.[e.kind]?.subjects || defs?.structure?.[e.kind]?.contents) && (
      <fieldset>
        <legend>{t("catalog.structure")}</legend>
        <div className="cv-grid">
          {/* 结构字段和候选范围来自 definitions.structure。 */}
          {(defs?.structure?.[e.kind]?.fields || []).map((f) => {
            const targets = f.target_kinds && f.target_kinds.length > 0 ? f.target_kinds : [e.kind];
            const scope = f.scoped_by ? String((e as Record<string, unknown>)[f.scoped_by] || "") : "";
            return (
              <label key={f.code}>
                {f.target_kinds && f.target_kinds.length > 0
                  ? f.target_kinds.map((k) => kindLabel(k)).join(" / ")
                  : t("catalog.parent")}
                <EntityPicker
                  kinds={targets}
                  query={scope ? `&${f.scoped_by}=${scope}` : ""}
                  value={String((e as Record<string, unknown>)[f.code] || "")}
                  onChange={(id) => patch({ [f.code]: id } as Partial<typeof e>)}
                />
              </label>
            );
          })}
          {["content_unit", "expression", "release", "medium", "track"].includes(e.kind) && (
            <>
              <label>
                {t("catalog.position")}
                <input
                  type="number"
                  min="0"
                  value={e.position}
                  onChange={(x) => patch({ position: Number(x.target.value) })}
                />
              </label>
              <label>
                {t("catalog.number")}
                <input
                  value={e.number}
                  onChange={(x) => patch({ number: x.target.value })}
                />
              </label>
            </>
          )}
        </div>
        {/* 发行对象入口由 definitions.structure 声明。 */}
        {defs?.structure?.[e.kind]?.subjects === true && (
          <>
            <h3>{t("catalog.subjects")}</h3>
            {e.subjects.map((s, i) => (
              <div className="cv-row" key={i}>
                <EntityPicker
                  kinds={["work"]}
                  value={s.work_id}
                  onChange={(id) =>
                    patch({
                      subjects: e.subjects.map((v, j) =>
                        i === j ? { ...v, work_id: id } : v,
                      ),
                    })
                  }
                />
                <select
                  value={s.role}
                  onChange={(x) =>
                    patch({
                      subjects: e.subjects.map((v, j) =>
                        i === j ? { ...v, role: x.target.value } : v,
                      ),
                    })
                  }
                >
                  {Object.entries(d.vocabularies.release_role.terms)
                    .filter(([k, v]) => v.enabled || k === s.role)
                    .map(([k, v]) => (
                      <option key={k} value={k}>
                        {local(v.names, locale, "", k)}
                      </option>
                    ))}
                </select>
                {/* 发行对象附加属性：按 scheme 收敛（无匹配显示全部全局子字段）。 */}
                <GroupFieldInput
                  defs={defs}
                  code="subject_attributes"
                  codes={subjectCodes}
                  value={s.attributes}
                  onChange={(attrs) =>
                    patch({
                      subjects: e.subjects.map((v, j) =>
                        i === j ? { ...v, attributes: attrs } : v,
                      ),
                    })
                  }
                />
                <button
                  type="button"
                  onClick={() =>
                    patch({ subjects: e.subjects.filter((_, j) => i !== j) })
                  }
                >
                  {t("catalog.remove")}
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                patch({
                  subjects: [
                    ...e.subjects,
                    {
                      work_id: "",
                      role: "primary",
                      position: e.subjects.length,
                    },
                  ],
                })
              }
            >
              {t("catalog.addSubject")}
            </button>
          </>
        )}
        {/* 收录内容：由 definitions 声明（structure.track.contents）。 */}
        {defs?.structure?.[e.kind]?.contents === true && (
          <>
            <h3>{t("catalog.contents")}</h3>
            {e.contents.map((c, i) => (
              <div className="cv-group" key={i}>
                <EntityPicker
                  kinds={["expression"]}
                  value={c.expression_id}
                  onChange={(id) =>
                    patch({
                      contents: e.contents.map((v, j) =>
                        i === j ? { ...v, expression_id: id } : v,
                      ),
                    })
                  }
                />
                <div className="cv-grid">
                  <label>
                    {t("catalog.position")}
                    <input
                      type="number"
                      min="0"
                      value={c.position}
                      onChange={(x) =>
                        patch({
                          contents: e.contents.map((v, j) =>
                            i === j
                              ? { ...v, position: Number(x.target.value) }
                              : v,
                          ),
                        })
                      }
                    />
                  </label>
                  {/* 定位方案与参照选项由 definitions 的 locator 组字段声明，后台可扩展。
                      用通用 FieldInput 递归渲染：枚举、数字、文本、布尔、实体引用与
                      嵌套结构一律由字段类型决定，不在这里按类型另写一份分支。 */}
                  {locatorFieldKeys.map((k) => {
                    const def: any = defs?.fields?.locator?.fields?.[k];
                    if (!def) return null;
                    return (
                      <label key={k}>
                        {getFieldName(defs as any, k, locale) || k}
                        <FieldInput
                          field={def}
                          value={c.locator[k]}
                          onChange={(value) => {
                            const locator = { ...c.locator };
                            if (value === "" || value === undefined || value === null) delete locator[k];
                            else locator[k] = value;
                            patch({
                              contents: e.contents.map((v, j) =>
                                i === j ? { ...v, locator } : v,
                              ),
                            });
                          }}
                        />
                      </label>
                    );
                  })}
                </div>
                {/* 收录附加属性：按 scheme 收敛（无匹配显示全部全局子字段）。 */}
                <GroupFieldInput
                  defs={defs}
                  code="inclusion_attributes"
                  codes={inclusionCodes}
                  value={c.attributes}
                  onChange={(attrs) =>
                    patch({
                      contents: e.contents.map((v, j) =>
                        i === j ? { ...v, attributes: attrs } : v,
                      ),
                    })
                  }
                />
                <button
                  type="button"
                  onClick={() =>
                    patch({ contents: e.contents.filter((_, j) => i !== j) })
                  }
                >
                  {t("catalog.remove")}
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                patch({
                  contents: [
                    ...e.contents,
                    {
                      expression_id: "",
                      position: e.contents.length,
                      locator: {},
                    },
                  ],
                })
              }
            >
              {t("catalog.addContent")}
            </button>
          </>
        )}
      </fieldset>
      )}
      {/* 关系维护：独立资源逐条提交，不复用实体 PUT；词表来自服务端 definitions。 */}
      <RelationEditorField
        entityId={e.id}
        entityKind={e.kind}
        entityTypes={e.types}
        note={note}
        sources={sources}
        drafts={pendingRelations}
        onDraftsChange={setPendingRelations}
      />
      {!!(fields.length || compatFieldOptions.length) && (
        <fieldset>
          <legend>{t("catalog.attributes")}</legend>
          {/* 动态结构：字段按实体类型引用模板的 sections 分组（分区名/字段/次序
              全部来自服务端 definitions）；模板未覆盖的字段落入末尾"其它信息"，
              保证任何声明过的数据都可编辑。 */}
          {sections.map((sec, i) => (
            <div key={`sec${i}`} className="cv-section">
              <h4 className="cv-section-title">
                {local(sec.names, locale, "")}
              </h4>
              <div className="cv-grid">
                {sec.fields.map((k) => (
                  <label key={k}>
                    {local(d.fields[k]?.names, locale, "", k)}
                    {d.fields[k]?.required && " *"}
                    <FieldInput
                      field={d.fields[k]}
                      value={e.attributes[k]}
                      onChange={(v) =>
                        patch({ attributes: { ...e.attributes, [k]: v } })
                      }
                    />
                    {e.attributes[k] !== undefined && (
                      <button
                        type="button"
                        onClick={() => {
                          const attributes = { ...e.attributes };
                          delete attributes[k];
                          patch({ attributes });
                        }}
                      >
                        {t("catalog.remove")}
                      </button>
                    )}
                  </label>
                ))}
              </div>
            </div>
          ))}
          {restFields.length > 0 && (
            <div className="cv-section">
              <h4 className="cv-section-title">{t("catalog.otherInfo")}</h4>
              <div className="cv-grid">
                {restFields.map((k) => (
                  <label key={k}>
                    {local(d.fields[k]?.names, locale, "", k)}
                    {d.fields[k]?.required && " *"}
                    <FieldInput
                      field={d.fields[k]}
                      value={e.attributes[k]}
                      onChange={(v) =>
                        patch({ attributes: { ...e.attributes, [k]: v } })
                      }
                    />
                    {e.attributes[k] !== undefined && (
                      <button
                        type="button"
                        onClick={() => {
                          const attributes = { ...e.attributes };
                          delete attributes[k];
                          patch({ attributes });
                        }}
                      >
                        {t("catalog.remove")}
                      </button>
                    )}
                  </label>
                ))}
              </div>
            </div>
          )}
          {/* 历史无类型实体的适用字段发现入口：已存属性在上方兼容展示，
              本层级当前适用、尚未展示的字段在这里按需添加（加后即进入上方分组
              编辑，留空不提交，后端按同一字段集校验，不再“能填被拒”）。 */}
          {compatFieldOptions.length > 0 && (
            <div className="cv-section">
              <h4 className="cv-section-title">{t("catalog.applicableFields")}</h4>
              <p className="cv-hint">{t("catalog.applicableFieldsHint")}</p>
              <div className="cv-row">
                <select
                  aria-label={t("catalog.applicableFields")}
                  value={compatFieldPick}
                  onChange={(x) => setCompatFieldPick(x.target.value)}
                >
                  <option value="">{t("catalog.select")}</option>
                  {compatFieldOptions.map((code) => (
                    <option key={code} value={code}>
                      {getFieldName(defs as any, code, locale) || code}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!compatFieldPick}
                  onClick={() => {
                    // 占位值为 undefined：只为让该键进入展示字段集（JSON 序列化时丢弃，
                    // 不提交空值；填了值才随 attributes 提交，后端按同一字段集校验）。
                    patch({ attributes: { ...e.attributes, [compatFieldPick]: undefined } });
                    setCompatFieldPick("");
                  }}
                >
                  {t("catalog.add")}
                </button>
              </div>
            </div>
          )}
          {foldedFields.length > 0 && (
            <details className="cv-section">
              <summary className="cv-section-title">{t("catalog.hiddenFields")}</summary>
              <div className="cv-grid">
                {foldedFields.map((k) => (
                  <label key={k}>
                    {local(d.fields[k]?.names, locale, "", k)}
                    {d.fields[k]?.required && " *"}
                    <FieldInput
                      field={d.fields[k]}
                      value={e.attributes[k]}
                      onChange={(v) =>
                        patch({ attributes: { ...e.attributes, [k]: v } })
                      }
                    />
                    {e.attributes[k] !== undefined && (
                      <button
                        type="button"
                        onClick={() => {
                          const attributes = { ...e.attributes };
                          delete attributes[k];
                          patch({ attributes });
                        }}
                      >
                        {t("catalog.remove")}
                      </button>
                    )}
                  </label>
                ))}
              </div>
            </details>
          )}
        </fieldset>
      )}
      <fieldset>
        <legend>{t("catalog.externalIds")}</legend>
        {Object.entries(e.external_ids).map(([k, v]) => (
          <div key={k} className="cv-row">
            <label>
              {k}
              <input
                value={v}
                onChange={(x) =>
                  patch({
                    external_ids: { ...e.external_ids, [k]: x.target.value },
                  })
                }
              />
            </label>
            <button
              type="button"
              onClick={() =>
                patch({
                  external_ids: Object.fromEntries(
                    Object.entries(e.external_ids).filter(([key]) => key !== k),
                  ),
                })
              }
            >
              {t("catalog.remove")}
            </button>
          </div>
        ))}
        <div className="cv-row">
          <input
            value={externalKey}
            aria-label={t("catalog.code")}
            onChange={(x) => setExternalKey(x.target.value)}
          />
          <button
            type="button"
            disabled={!externalKey}
            onClick={() => {
              patch({ external_ids: { ...e.external_ids, [externalKey]: "" } });
              setExternalKey("");
            }}
          >
            {t("catalog.add")}
          </button>
        </div>
      </fieldset>
      <fieldset>
        <legend>{t("catalog.pictures")}</legend>
        {e.pictures.map((p, i) => (
          <div className="cv-group" key={i}>
            <label>
              {t("catalog.imageUrl")}
              <input
                type="url"
                required
                value={p.url}
                onChange={(x) =>
                  patch({
                    pictures: e.pictures.map((v, j) =>
                      i === j ? { ...v, url: x.target.value } : v,
                    ),
                  })
                }
              />
            </label>
            <label>
              {t("catalog.imageTakenAt")}
              <input
                placeholder="2020-08-07"
                value={p.taken_at || ""}
                onChange={(x) =>
                  patch({
                    pictures: e.pictures.map((v, j) =>
                      i === j ? { ...v, taken_at: x.target.value } : v,
                    ),
                  })
                }
              />
            </label>
            <label>
              {t("catalog.citation")}
              <input
                required
                value={p.source.citation}
                onChange={(x) =>
                  patch({
                    pictures: e.pictures.map((v, j) =>
                      i === j
                        ? {
                            ...v,
                            source: { ...v.source, citation: x.target.value },
                          }
                        : v,
                    ),
                  })
                }
              />
            </label>
            <button
              type="button"
              onClick={() =>
                patch({ pictures: e.pictures.filter((_, j) => i !== j) })
              }
            >
              {t("catalog.remove")}
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            patch({
              pictures: [
                ...e.pictures,
                {
                  url: "",
                  caption: {},
                  taken_at: "",
                  source: { kind: "self", citation: "" },
                },
              ],
            })
          }
        >
          {t("catalog.add")}
        </button>
      </fieldset>
      <Evidence
        note={note}
        setNote={setNote}
        sources={sources}
        setSources={setSources}
      />
      <button className="cv-primary" disabled={busy}>
        {t("catalog.save")}
      </button>
    </form>
  );
}
