"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/i18n/I18nProvider";
import { useDefinitions, getFieldName, getRelationName } from "@/lib/definitions";
import { api, Entity, Source } from "@/components/catalog/api";
import { EntityPicker, FieldInput } from "@/components/catalog/Fields";
import { FieldValue } from "@/components/catalog/TemplateAttributeSections";
import { Plus, Trash2, Pencil, ArrowLeftRight, AlertCircle } from "lucide-react";

interface Relation {
  id: string;
  version: number;
  type: string;
  source_id: string;
  target_id: string;
  position?: number;
  attributes?: Record<string, any>;
}

interface Props {
  /** 新建未保存时为空：此时提示先保存条目。 */
  entityId?: string;
  entityKind: string;
  /** 复用编辑器 Evidence 区的修改说明与来源：关系写入同样强制证据。 */
  note: string;
  sources: Source[];
}

type TypeOption = { code: string; forward: boolean; targetKinds: string[] };

// 选项值编码"关系＋方向"：两端同 kind 的关系（如 Work→Work）正向/反向是两个选项。
const optionKey = (o: TypeOption) => `${o.code}|${o.forward ? "f" : "r"}`;

/**
 * RelationEditorField：通用编辑器内的关系维护区（catalog 8-kind 维度）。
 *
 * 关系是独立资源（POST/PUT/DELETE /catalog/relations），不随实体 PUT 提交，
 * 因此本组件逐条立即写入并复用表单 Evidence（edit_note + sources）。
 * 词表来自服务端 definitions：本实体可作 source 的类型按正向展示，只能作
 * target 的按反向展示；两端都可时正反均为选项（提交时按方向放置端点）。
 * 关系可携带的属性字段由关系定义的 fields 声明，创建与编辑共用同一套动态表单；
 * 已有关系的属性可就地修改（PUT，端点与类型不可变，version 乐观锁）。
 */
export function RelationEditorField({ entityId, entityKind, note, sources }: Props) {
  const { t, locale } = useI18n();
  const { definitions: defs } = useDefinitions();

  const [items, setItems] = useState<Relation[]>([]);
  const [peers, setPeers] = useState<Record<string, Entity>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [addType, setAddType] = useState("");
  const [addTarget, setAddTarget] = useState("");
  const [addAttrs, setAddAttrs] = useState<Record<string, any>>({});
  const [editingId, setEditingId] = useState("");
  const [editAttrs, setEditAttrs] = useState<Record<string, any>>({});

  const load = React.useCallback(async () => {
    if (!entityId) return;
    setLoading(true);
    setError("");
    try {
      const res = await api<{ items: Relation[]; entities: Record<string, Entity> }>(
        `/catalog/entities/${entityId}/relations`,
      );
      setItems(res.items || []);
      setPeers(res.entities || {});
    } catch (e) {
      setError(t("editor.relation.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [entityId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // 本实体可用的"关系＋方向"选项：kind 在 source_kinds → 正向；在 target_kinds → 反向。
  const typeOptions = useMemo(() => {
    const out: TypeOption[] = [];
    for (const [code, rel] of Object.entries(defs?.relations || {})) {
      if (!rel.enabled) continue;
      const inSource = rel.source_kinds?.includes(entityKind) ?? false;
      const inTarget = rel.target_kinds?.includes(entityKind) ?? false;
      if (inSource) out.push({ code, forward: true, targetKinds: rel.target_kinds || [] });
      if (inTarget) out.push({ code, forward: false, targetKinds: rel.source_kinds || [] });
    }
    out.sort((a, b) => optionKey(a).localeCompare(optionKey(b)));
    return out;
  }, [defs, entityKind]);

  const selected = typeOptions.find((o) => optionKey(o) === addType);
  const evidenceReady =
    note.trim().length > 0 &&
    sources.length > 0 &&
    sources.every((s) => s.citation.trim().length > 0);

  // 关系定义声明的可携带属性字段（definitions.fields 引用），无声明则不出现表单。
  const relationFieldCodes = (code: string): string[] => defs?.relations?.[code]?.fields || [];

  const missingRequired = (code: string, attrs: Record<string, any>): string[] =>
    relationFieldCodes(code).filter((fc) => {
      const f = defs?.fields?.[fc];
      const v = attrs?.[fc];
      return !!f?.required && (v === undefined || v === null || v === "");
    });

  const submit = async () => {
    if (!entityId || !selected || !addTarget) return;
    if (!evidenceReady) {
      setError(t("editor.relation.evidenceRequired"));
      return;
    }
    const missing = missingRequired(selected.code, addAttrs);
    if (missing.length > 0) {
      setError(
        t("editor.relation.requiredMissing", {
          fields: missing.map((c) => getFieldName(defs, c, locale)).join("、"),
        }),
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api(
        "/catalog/relations",
        "POST",
        {
          relation: {
            type: selected.code,
            source_id: selected.forward ? entityId : addTarget,
            target_id: selected.forward ? addTarget : entityId,
            position: 0,
            attributes: addAttrs,
          },
          expected_version: 0,
          edit_note: note,
          sources,
        },
        { "Idempotency-Key": crypto.randomUUID() },
      );
      setAddType("");
      setAddTarget("");
      setAddAttrs({});
      await load();
    } catch (e) {
      setError(friendly((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (r: Relation) => {
    setEditingId(r.id);
    setEditAttrs({ ...(r.attributes || {}) });
    setError("");
  };

  const saveEdit = async (r: Relation) => {
    if (!evidenceReady) {
      setError(t("editor.relation.evidenceRequired"));
      return;
    }
    const missing = missingRequired(r.type, editAttrs);
    if (missing.length > 0) {
      setError(
        t("editor.relation.requiredMissing", {
          fields: missing.map((c) => getFieldName(defs, c, locale)).join("、"),
        }),
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api(`/catalog/relations/${r.id}`, "PUT", {
        relation: {
          id: r.id,
          type: r.type,
          source_id: r.source_id,
          target_id: r.target_id,
          position: r.position || 0,
          attributes: editAttrs,
        },
        expected_version: r.version,
        edit_note: note,
        sources,
      });
      setEditingId("");
      setEditAttrs({});
      await load();
    } catch (e) {
      setError(friendly((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (rel: Relation) => {
    if (!confirm(t("editor.relation.removeConfirm"))) return;
    if (!evidenceReady) {
      setError(t("editor.relation.evidenceRequired"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api(`/catalog/relations/${rel.id}`, "DELETE", {
        expected_version: rel.version,
        target_id: "",
        edit_note: note,
        sources,
      });
      await load();
    } catch (e) {
      setError(friendly((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  const friendly = (msg: string) =>
    msg === "forbidden" ? t("editor.relation.forbidden") : msg;

  const peerLabel = (id: string) => {
    const p = peers[id];
    if (!p) return id.slice(0, 8);
    return p.title || id.slice(0, 8);
  };

  // 关系属性动态输入区：创建与编辑共用，字段集合/类型/必填全部来自后台定义。
  const attrInputs = (
    code: string,
    attrs: Record<string, any>,
    onChange: (next: Record<string, any>) => void,
  ) => {
    const codes = relationFieldCodes(code).filter((fc) => defs?.fields?.[fc]);
    if (codes.length === 0) return null;
    return (
      <div className="cv-grid mt-2">
        {codes.map((fc) => {
          const f = defs?.fields?.[fc]!;
          return (
            <label key={fc} className="text-sm">
              {getFieldName(defs, fc, locale)}
              {f.required ? " *" : ""}
              <FieldInput
                field={f}
                value={attrs?.[fc]}
                onChange={(v) => onChange({ ...attrs, [fc]: v })}
              />
            </label>
          );
        })}
      </div>
    );
  };

  // 已有关系的属性摘要：仅显示有值的字段，枚举/实体引用按 definitions 本地化。
  const attrSummary = (r: Relation) => {
    const codes = relationFieldCodes(r.type).filter((fc) => {
      const v = r.attributes?.[fc];
      return v !== undefined && v !== null && v !== "";
    });
    if (codes.length === 0) return null;
    return (
      <span className="flex w-full flex-wrap gap-1.5 text-xs opacity-80">
        {codes.map((fc) => (
          <span key={fc} className="rounded bg-black/[0.04] px-1.5 py-0.5 dark:bg-white/[0.06]">
            {getFieldName(defs, fc, locale)}:{" "}
            <FieldValue defs={defs} code={fc} value={r.attributes?.[fc]} locale={locale} />
          </span>
        ))}
      </span>
    );
  };

  if (!entityId) {
    return (
      <fieldset>
        <legend>{t("catalog.relations")}</legend>
        <p className="text-sm opacity-60">{t("editor.relation.needSave")}</p>
      </fieldset>
    );
  }

  return (
    <fieldset>
      <legend>{t("catalog.relations")}</legend>

      {error && (
        <p role="alert" className="cv-error inline-flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </p>
      )}

      {/* 已有关系列表 */}
      {loading ? (
        <p className="text-sm opacity-60">{t("catalog.loading")}</p>
      ) : items.length === 0 ? (
        <p className="text-sm opacity-60">{t("editor.relation.none")}</p>
      ) : (
        <ul className="cv-relation-list space-y-1.5">
          {items.map((r) => {
            const forward = r.source_id === entityId;
            const rel = defs?.relations?.[r.type];
            const label = rel
              ? getRelationName(defs, r.type, forward, locale)
              : r.type;
            const peerId = forward ? r.target_id : r.source_id;
            return (
              <React.Fragment key={r.id}>
                <li className="cv-row flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="inline-flex min-w-0 flex-1 flex-wrap items-center gap-2">
                    <span className="shrink-0 rounded bg-black/[0.05] px-1.5 py-0.5 font-mono text-xs dark:bg-white/[0.08]">
                      {label}
                    </span>
                    {!forward && <ArrowLeftRight className="w-3 h-3 shrink-0 opacity-50" aria-label={t("editor.relation.reverse")} />}
                    <Link href={`/catalog/${peerId}`} className="truncate text-primary hover:underline">
                      {peerLabel(peerId)}
                    </Link>
                    {attrSummary(r)}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {defs?.relations?.[r.type] && (defs.relations[r.type].fields || []).length > 0 && (
                      <button
                        type="button"
                        disabled={busy || editingId === r.id}
                        onClick={() => startEdit(r)}
                        className="inline-flex items-center gap-1 text-xs opacity-60 hover:opacity-100 hover:text-primary disabled:opacity-30"
                        title={t("common.edit")}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        {t("common.edit")}
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => remove(r)}
                      className="inline-flex items-center gap-1 text-xs opacity-60 hover:opacity-100 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-30"
                      title={t("editor.relation.remove")}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      {t("editor.relation.remove")}
                    </button>
                  </span>
                </li>
                {editingId === r.id && (
                  <li className="cv-row rounded border border-black/10 p-2.5 dark:border-white/10">
                    {attrInputs(r.type, editAttrs, setEditAttrs)}
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => saveEdit(r)}
                        className="inline-flex items-center gap-1.5 whitespace-nowrap"
                      >
                        {t("common.save")}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setEditingId("");
                          setEditAttrs({});
                        }}
                        className="inline-flex items-center gap-1.5 whitespace-nowrap"
                      >
                        {t("common.cancel")}
                      </button>
                    </div>
                  </li>
                )}
              </React.Fragment>
            );
          })}
        </ul>
      )}

      {/* 添加行 */}
      <div className="cv-row mt-3 space-y-2">
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] sm:items-end">
          <label className="block text-sm">
            {t("editor.relation.addType")}
            <select
              value={addType}
              onChange={(x) => {
                setAddType(x.target.value);
                setAddTarget("");
                setAddAttrs({});
              }}
              className="mt-1 block w-full"
            >
              <option value="">{t("editor.relation.pickType")}</option>
              {typeOptions.map((o) => (
                <option key={optionKey(o)} value={optionKey(o)}>
                  {getRelationName(defs, o.code, o.forward, locale)}
                  {o.forward ? "" : `（${t("editor.relation.reverse")}）`}
                </option>
              ))}
            </select>
          </label>
          <div className="text-sm">
            {t("editor.relation.addTarget")}
            {selected && (
              <EntityPicker
                kinds={selected.targetKinds}
                value={addTarget}
                onChange={setAddTarget}
              />
            )}
          </div>
          <button
            type="button"
            disabled={busy || !addType || !addTarget}
            onClick={submit}
            className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            {t("editor.relation.add")}
          </button>
        </div>
        {selected && attrInputs(selected.code, addAttrs, setAddAttrs)}
      </div>
    </fieldset>
  );
}

export default RelationEditorField;
