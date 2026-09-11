"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/i18n/I18nProvider";
import { useDefinitions, getRelationName } from "@/lib/definitions";
import { api, Entity, Source } from "@/components/catalog/api";
import { EntityPicker } from "@/components/catalog/Fields";
import { Plus, Trash2, ArrowLeftRight, AlertCircle } from "lucide-react";

interface Relation {
  id: string;
  version: number;
  type: string;
  source_id: string;
  target_id: string;
}

interface Props {
  /** 新建未保存时为空：此时提示先保存条目。 */
  entityId?: string;
  entityKind: string;
  /** 复用编辑器 Evidence 区的修改说明与来源：关系写入同样强制证据。 */
  note: string;
  sources: Source[];
}

/**
 * RelationEditorField：通用编辑器内的关系维护区（catalog 8-kind 维度）。
 *
 * 关系是独立资源（POST/DELETE /catalog/relations），不随实体 PUT 提交，
 * 因此本组件逐条立即写入并复用表单 Evidence（edit_note + sources）。
 * 词表来自服务端 definitions：本实体可作 source 的类型按正向展示；
 * 只能作 target 的类型按反向展示（提交时自动交换 source/target）。
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

  // 本实体可用的关系类型：kind 在 source_kinds → 正向；仅在 target_kinds → 反向。
  const typeOptions = useMemo(() => {
    const out: { code: string; forward: boolean; targetKinds: string[] }[] = [];
    for (const [code, rel] of Object.entries(defs?.relations || {})) {
      if (!rel.enabled) continue;
      if (rel.source_kinds?.includes(entityKind)) {
        out.push({ code, forward: true, targetKinds: rel.target_kinds || [] });
      } else if (rel.target_kinds?.includes(entityKind)) {
        out.push({ code, forward: false, targetKinds: rel.source_kinds || [] });
      }
    }
    out.sort((a, b) => a.code.localeCompare(b.code));
    return out;
  }, [defs, entityKind]);

  const selected = typeOptions.find((o) => o.code === addType);
  const evidenceReady =
    note.trim().length > 0 &&
    sources.length > 0 &&
    sources.every((s) => s.citation.trim().length > 0);

  const submit = async () => {
    if (!entityId || !selected || !addTarget) return;
    if (!evidenceReady) {
      setError(t("editor.relation.evidenceRequired"));
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
            attributes: {},
          },
          expected_version: 0,
          edit_note: note,
          sources,
        },
        { "Idempotency-Key": crypto.randomUUID() },
      );
      setAddType("");
      setAddTarget("");
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
              <li key={r.id} className="cv-row flex items-center justify-between gap-2 text-sm">
                <span className="inline-flex min-w-0 items-center gap-2">
                  <span className="shrink-0 rounded bg-black/[0.05] dark:bg-white/[0.08] px-1.5 py-0.5 font-mono text-xs">
                    {label}
                  </span>
                  {!forward && <ArrowLeftRight className="w-3 h-3 shrink-0 opacity-50" aria-label={t("editor.relation.reverse")} />}
                  <Link href={`/catalog/${peerId}`} className="truncate text-primary hover:underline">
                    {peerLabel(peerId)}
                  </Link>
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => remove(r)}
                  className="shrink-0 inline-flex items-center gap-1 text-xs opacity-60 hover:opacity-100 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-30"
                  title={t("editor.relation.remove")}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {t("editor.relation.remove")}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* 添加行 */}
      <div className="cv-row mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] sm:items-end">
        <label className="block text-sm">
          {t("editor.relation.addType")}
          <select
            value={addType}
            onChange={(x) => {
              setAddType(x.target.value);
              setAddTarget("");
            }}
            className="mt-1 block w-full"
          >
            <option value="">{t("editor.relation.pickType")}</option>
            {typeOptions.map((o) => (
              <option key={`${o.code}-${o.forward}`} value={o.code}>
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
    </fieldset>
  );
}

export default RelationEditorField;
