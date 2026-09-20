"use client";
import React, { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import {
  api,
  Definitions,
  DefinitionVersionItem,
  Field,
  Names,
  Source,
  definitionVersions,
  kinds as fallbackKinds,
  local,
} from "./api";
import { CATALOG_DEFINITIONS_MANAGE, can } from "@/lib/permissions";
import { DefinitionHistory } from "./DefinitionHistory";
import { useCatalog } from "./CatalogProvider";
import { useAuth } from "@/lib/authContext";
import {
  getKindName,
  getPublishedDefinitionId,
  refreshDefinitions,
  resolveKindOptions,
  useDefinitions,
} from "@/lib/definitions";
import type { DynamicDefinitions } from "@/lib/definitions";
import { Evidence, ErrorMessage, NamesEditor } from "./Fields";

// 同一份服务端定义文档在前端有两个方向不同的类型：lib/definitions.ts 的 DynamicDefinitions
// 是只读消费视图（老文档缺键时为可选），./api 的 Definitions 是写入视图（字段齐全）。
// 已发布文档就是写入视图的输入，这里按写入视图收窄，免得编辑器整篇跟着换类型。
const asEditableDefinitions = (d: DynamicDefinitions): Definitions =>
  d as unknown as Definitions;

const newField = (): Field => ({ names: {}, type: "text", enabled: true });
function Checks({
  values,
  selected,
  onChange,
  label,
}: {
  values: Record<string, string>;
  selected: string[];
  onChange: (v: string[]) => void;
  label: string;
}) {
  return (
    <fieldset>
      <legend>{label}</legend>
      <div className="cv-checks">
        {Object.entries(values).map(([k, name]) => (
          <label key={k}>
            <input
              type="checkbox"
              checked={(selected || []).includes(k)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...(selected || []), k]
                    : (selected || []).filter((x) => x !== k),
                )
              }
            />
            {name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
function TextList({
  value,
  onChange,
  label,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  label: string;
}) {
  return (
    <label>
      {label}
      <input
        value={(value || []).join(", ")}
        onChange={(e) =>
          onChange(
            e.target.value
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean),
          )
        }
      />
    </label>
  );
}
function Dictionary<T extends { names: Names }>({
  value,
  onChange,
  create,
  render,
}: {
  value: Record<string, T>;
  onChange: (v: Record<string, T>) => void;
  create: () => T;
  render: (item: T, change: (v: T) => void, key: string) => React.ReactNode;
}) {
  const { t, locale } = useI18n();
  const [code, setCode] = useState("");
  return (
    <>
      <div className="cv-row">
        <label>
          {t("catalog.code")}
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            pattern="[a-z][a-z0-9_]*"
          />
        </label>
        <button
          type="button"
          disabled={!/^[a-z][a-z0-9_]*$/.test(code) || !!value[code]}
          onClick={() => {
            onChange({ ...value, [code]: create() });
            setCode("");
          }}
        >
          {t("catalog.add")}
        </button>
      </div>
      {Object.entries(value).map(([key, v]) => (
        <details className="cv-group" key={key}>
          <summary>
            {local(v.names, locale, "", key)} <small>({key})</small>
          </summary>
          {render(v, (x) => onChange({ ...value, [key]: x }), key)}
          <button
            type="button"
            onClick={() => {
              const next = { ...value };
              delete next[key];
              onChange(next);
            }}
          >
            {t("catalog.removeDefinition")}
          </button>
        </details>
      ))}
    </>
  );
}
function FieldDefinition({
  value,
  onChange,
  d,
  code = "",
  groupFields,
}: {
  value: Field;
  onChange: (v: Field) => void;
  d: Definitions;
  /** 本字段在所属组/字典中的码，用于排除"自己当自己的起点"。 */
  code?: string;
  /** 所属 group 的子字段集合：number 子字段可从中选区间起点。 */
  groupFields?: Record<string, Field>;
}) {
  const { t, tr, locale } = useI18n();
  const { kinds: serverKinds } = useDefinitions();
  const patch = (v: Partial<Field>) => onChange({ ...value, ...v });
  // 允许种类：可选项取服务端 definitions.kinds（未停用），名称服务端优先、字典兜底。
  const kindNames = useMemo(
    () =>
      Object.fromEntries(
        resolveKindOptions(serverKinds, fallbackKinds).map((k) => [
          k,
          getKindName(serverKinds, k, locale, tr(`catalog.kind.${k}`, k)),
        ]),
      ),
    [serverKinds, locale, tr],
  );
  return (
    <>
      <NamesEditor value={value.names} onChange={(names) => patch({ names })} />
      <label>
        {t("catalog.fieldType")}
        <select
          value={value.type}
          onChange={(e) =>
            onChange({
              ...newField(),
              names: value.names,
              type: e.target.value,
              ...(e.target.value === "list"
                ? { items: newField() }
                : e.target.value === "group"
                  ? { fields: {} }
                  : {}),
            })
          }
        >
          {[
            "text",
            "multilingual",
            "number",
            "date",
            "boolean",
            "url",
            "enum",
            "entity",
            "list",
            "group",
          ].map((k) => (
            <option key={k} value={k}>
              {t(`catalog.fieldTypeNames.${k}`)}
            </option>
          ))}
        </select>
      </label>
      <div className="cv-checks">
        {(["enabled", "required", "searchable", "comparable", "hidden"] as const).map(
          (k) => (
            <label key={k}>
              <input
                type="checkbox"
                checked={!!value[k]}
                onChange={(e) => patch({ [k]: e.target.checked })}
              />
              {t(`catalog.${k}`)}
            </label>
          ),
        )}
      </div>
      {/* 对比语义：闭集选择，只提供系统真正实现的规则，避免自由填写出不生效的配置。 */}
      <label>
        {t("catalog.semantics")}
        <select
          value={value.semantics || ""}
          onChange={(e) => patch({ semantics: e.target.value || undefined })}
        >
          <option value="">{t("catalog.semanticsDefault")}</option>
          <option value="content">{t("catalog.semanticsContent")}</option>
          <option value="locating">{t("catalog.semanticsLocating")}</option>
        </select>
      </label>
      {/* 锚点子字段：仅 group 字段有意义——组内其它子字段有值时该子字段必填。 */}
      {value.type === "group" && Object.keys(value.fields || {}).length > 0 && (
        <label>
          {t("catalog.anchorKey")}
          <select
            value={value.anchor_key || ""}
            onChange={(e) => patch({ anchor_key: e.target.value || undefined })}
          >
            <option value="">{t("catalog.none")}</option>
            {Object.keys(value.fields || {}).map((k) => (
              <option key={k} value={k}>
                {local(value.fields?.[k]?.names, locale, "", k)}
              </option>
            ))}
          </select>
        </label>
      )}
      {/* 区间顺序只认显式声明：number 子字段指定同组起点字段后才校验大小关系，
          后台新增数字字段不会因命名碰巧相似而触发隐含规则。 */}
      {value.type === "number" &&
        groupFields &&
        Object.keys(groupFields).filter((k) => k !== code).length > 0 && (
          <label>
            {t("catalog.rangeStart")}
            <select
              value={value.range_start || ""}
              onChange={(e) => patch({ range_start: e.target.value || undefined })}
            >
              <option value="">{t("catalog.none")}</option>
              {Object.keys(groupFields)
                .filter((k) => k !== code)
                .map((k) => (
                  <option key={k} value={k}>
                    {local(groupFields[k]?.names, locale, "", k)}
                  </option>
                ))}
            </select>
          </label>
        )}
      <label>{t("catalog.unit")}</label>
      <NamesEditor
        value={value.unit || {}}
        onChange={(unit) => patch({ unit })}
      />
      <div className="cv-grid">
        {(["min", "max"] as const).map((k) => (
          <label key={k}>
            {t(`catalog.${k}`)}
            <input
              type="number"
              step="any"
              value={value[k] ?? ""}
              onChange={(e) =>
                patch({
                  [k]:
                    e.target.value === "" ? undefined : Number(e.target.value),
                })
              }
            />
          </label>
        ))}
      </div>
      {value.type === "enum" && (
        <label>
          {t("catalog.vocabulary")}
          <select
            value={value.vocabulary || ""}
            onChange={(e) => patch({ vocabulary: e.target.value })}
          >
            <option value="">{t("catalog.select")}</option>
            {Object.entries(d.vocabularies).map(([k, v]) => (
              <option key={k} value={k}>
                {local(v.names, locale, "", k)}
              </option>
            ))}
          </select>
        </label>
      )}
      {value.type === "entity" && (
        <Checks
          label={t("catalog.allowedKinds")}
          values={kindNames}
          selected={value.kinds || []}
          onChange={(kinds) => patch({ kinds })}
        />
      )}{" "}
      {value.type === "list" && (
        <fieldset>
          <legend>{t("catalog.listItem")}</legend>
          <FieldDefinition
            value={value.items || newField()}
            onChange={(items) => patch({ items })}
            d={d}
          />
        </fieldset>
      )}
      {value.type === "group" && (
        <Dictionary
          value={value.fields || {}}
          onChange={(fields) => patch({ fields })}
          create={newField}
          render={(f, change, key) => (
            <FieldDefinition
              value={f}
              onChange={change}
              d={d}
              code={key}
              groupFields={value.fields}
            />
          )}
        />
      )}
    </>
  );
}
export function DefinitionsEditor() {
  const { t, tr, locale } = useI18n();
  const { modules } = useCatalog();
  const { user } = useAuth();
  // 防御式取值：/api/capabilities 契约漂移（缺 modules / 不是数组）时，下面两处 .map 会抛错并白屏。
  // 空列表 = "没有可用子系统"，与本页"模块开关已退役、只展示状态"的语义一致。
  const moduleList = Array.isArray(modules) ? modules : [];
  // 已发布定义与它的版本行 id 只从 lib/definitions.ts 取（同一响应的同一份缓存）：
  // 从 CatalogProvider 再拿一份副本，就是审计里"同一份定义两份缓存、发布后不同步"的根源，
  // 更别说这个 Provider 只在 /admin 路由挂着。
  const { definitions: published, kinds: serverKinds, versionId } = useDefinitions();
  const [d, setD] = useState<Definitions>();
  const [base, setBase] = useState(0);
  const [versions, setVersions] = useState<DefinitionVersionItem[]>([]);
  // 版本列表另用一个 nonce 触发重取：draft 只在"保存草稿"时变号，回滚后需要独立重取。
  const [versionsNonce, setVersionsNonce] = useState(0);
  const [versionsLoading, setVersionsLoading] = useState(true);
  const [versionsError, setVersionsError] = useState("");
  const [draft, setDraft] = useState(0);
  const [issues, setIssues] = useState<string[]>();
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [sources, setSources] = useState<Source[]>([
    { kind: "self", citation: "" },
  ]);
  const [tab, setTab] = useState<keyof Definitions | "schemes">("types");
  useEffect(() => {
    if (published && versionId !== null && !d) {
      setD(structuredClone(asEditableDefinitions(published)));
      setBase(versionId);
    }
  }, [published, versionId, d]);
  // 门槛按权限码判定：can() 在令牌没带 permissions 时回落到 role，老行为不变；
  // 持 catalog.definitions.manage 的管理组此前被 role 判断挡在门外，现在也能进。
  const manageDefinitions = can(user, CATALOG_DEFINITIONS_MANAGE);
  useEffect(() => {
    if (!manageDefinitions) return;
    // 回滚/保存草稿都会触发重取，迟到的旧响应不能覆盖新列表。
    let alive = true;
    setVersionsLoading(true);
    definitionVersions()
      .then((r) => {
        if (!alive) return;
        // 契约漂移防御：versions 是渲染路径上的 .map（下面版本列表），HTTP 200 但 items 不是数组时
        // 不能让 undefined 进 state，否则整块版本历史把页面带崩；取不到就按"没有版本列表"降级。
        setVersions(Array.isArray(r.items) ? r.items : []);
        setVersionsError("");
      })
      // 列表失败只降级版本历史那一块：写失败仍走 error（顶部 ErrorMessage）。
      .catch((e) => {
        if (alive) setVersionsError(e.message);
      })
      .finally(() => {
        if (alive) setVersionsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [manageDefinitions, draft, versionsNonce]);
  if (!manageDefinitions) return <p>{t("catalog.adminRequired")}</p>;
  if (!d) return <p>{t("catalog.loading")}</p>;
  const change = (next: Definitions) => {
    setD(next);
    setDraft(0);
    setIssues(undefined);
  };
  // 发布/回滚后刷新所有定义消费方：定义缓存只有 lib/definitions.ts 一处（带订阅），
  // refreshDefinitions() 会按新版本号重取、更新缓存并通知已挂载的组件；
  // 基线版本号从同一份响应里取，不再自己打一次 /catalog/definitions（第二条取数路径）。
  const reloadPublished = async () => {
    const current = await refreshDefinitions();
    const currentId = getPublishedDefinitionId();
    if (!current || currentId === null) {
      // 发布已经落库成功，只是本地刷新没拿到：如实说明，不要把刷新失败讲成发布失败。
      throw new Error("definition_refresh_failed");
    }
    setD(structuredClone(asEditableDefinitions(current)));
    setBase(currentId);
    setDraft(0);
    setIssues(undefined);
    setError("");
  };
  // 回滚已经落库成功，刷新失败只影响本地视图：用顶层 error 说明并要求手动重载，
  // 不能让"刷新失败"看起来像"回滚失败"。
  const afterRollback = async () => {
    setVersionsNonce((n) => n + 1);
    try {
      await reloadPublished();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const names = (items: Record<string, { names: Names }>) =>
    Object.fromEntries(
      Object.entries(items).map(([k, v]) => [k, local(v.names, locale, "", k)]),
    );
  // 骨架层级名：服务端 definitions.kinds 优先，字典只作兜底（缺键退原始码）。
  const kindNames = Object.fromEntries(
    resolveKindOptions(serverKinds, fallbackKinds).map((k) => [
      k,
      getKindName(serverKinds, k, locale, tr(`catalog.kind.${k}`, k)),
    ]),
  );
  return (
    <>
      <h1>{t("catalog.configure")}</h1>
      <ErrorMessage error={error} />
      <p className="cv-muted">{t("catalog.definitionHelp")}</p>
      <section>
        <h2>{t("catalog.modules")}</h2>
        {/* 模块开关已退役：PUT /api/admin/modules/:id 恒返回 409 module_toggle_retired（模块状态改由声明式配置决定，
            服务端保留该端点只为给旧客户端一个明确答复）。这里只展示状态，不再渲染必然失败的复选框。 */}
        {moduleList.map((m) => (
          <p className="cv-check" key={m.id}>
            {t(`catalog.module.${m.id}`)}{" "}
            {!m.healthy && t("catalog.unavailable")}
          </p>
        ))}
      </section>
      <div className="cv-row">
        <label>
          {t("catalog.definitionVersion")}
          <select
            value=""
            onChange={(e) => {
              const v = versions.find((x) => x.id === Number(e.target.value));
              // 列表按 include_document=true 取，每项都带文档；万一缺失就什么都不做，
              // 免得把编辑器改成"半份定义"。
              if (v?.document) {
                change(structuredClone(v.document));
                setBase(v.state === "draft" ? v.base_version : versionId ?? base);
                if (v.state === "draft") setDraft(v.id);
              }
            }}
          >
            <option value="">{t("catalog.select")}</option>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.id} · {t(`catalog.state.${v.state}`)}
              </option>
            ))}
          </select>
        </label>
        <span>
          {t("catalog.baseVersion")}: {base}
        </span>
      </div>
      <DefinitionHistory
        versions={versions}
        currentId={versionId ?? undefined}
        loading={versionsLoading}
        error={versionsError}
        onReload={() => setVersionsNonce((n) => n + 1)}
        onChanged={afterRollback}
      />
      <nav className="cv-tabs">
        {(
          ["types", "fields", "vocabularies", "relations", "templates", "schemes"] as const
        ).map((k) => (
          <button
            key={k}
            className={tab === k ? "cv-primary" : ""}
            onClick={() => setTab(k)}
          >
            {t(`catalog.${k}`)}
          </button>
        ))}
      </nav>
      {tab === "types" && (
        <Dictionary
          value={d.types}
          onChange={(types) => change({ ...d, types })}
          create={() => ({
            names: {},
            kinds: ["work"],
            fields: [],
            template: "",
            enabled: true,
          })}
          render={(v, set) => (
            <>
              <NamesEditor
                value={v.names}
                onChange={(names) => set({ ...v, names })}
              />
              <label className="cv-check">
                <input
                  type="checkbox"
                  checked={v.enabled}
                  onChange={(e) => set({ ...v, enabled: e.target.checked })}
                />
                {t("catalog.enabled")}
              </label>
              <Checks
                label={t("catalog.allowedKinds")}
                values={kindNames}
                selected={v.kinds}
                onChange={(kinds) => set({ ...v, kinds })}
              />
              <Checks
                label={t("catalog.fields")}
                values={names(d.fields)}
                selected={v.fields}
                onChange={(fields) => set({ ...v, fields })}
              />
              <label>
                {t("catalog.template")}
                <select
                  value={v.template}
                  onChange={(e) => set({ ...v, template: e.target.value })}
                >
                  <option value="">{t("catalog.none")}</option>
                  {Object.entries(names(d.templates)).map(([k, n]) => (
                    <option key={k} value={k}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
        />
      )}
      {tab === "fields" && (
        <Dictionary
          value={d.fields}
          onChange={(fields) => change({ ...d, fields })}
          create={newField}
          render={(v, set) => (
            <FieldDefinition value={v} onChange={set} d={d} />
          )}
        />
      )}
      {tab === "vocabularies" && (
        <Dictionary
          value={d.vocabularies}
          onChange={(vocabularies) => change({ ...d, vocabularies })}
          create={() => ({ names: {}, terms: {} })}
          render={(v, set) => (
            <>
              <NamesEditor
                value={v.names}
                onChange={(names) => set({ ...v, names })}
              />
              <Dictionary
                value={v.terms}
                onChange={(terms) => set({ ...v, terms })}
                create={() => ({ names: {}, enabled: true })}
                render={(term, change) => (
                  <>
                    <NamesEditor
                      value={term.names}
                      onChange={(names) => change({ ...term, names })}
                    />
                    <label className="cv-check">
                      <input
                        type="checkbox"
                        checked={term.enabled}
                        onChange={(e) =>
                          change({ ...term, enabled: e.target.checked })
                        }
                      />
                      {t("catalog.enabled")}
                    </label>
                  </>
                )}
              />
            </>
          )}
        />
      )}
      {tab === "relations" && (
        <Dictionary
          value={d.relations}
          onChange={(relations) => change({ ...d, relations })}
          create={() => ({
            names: {},
            reverse_names: {},
            source_kinds: ["agent"],
            target_kinds: ["work"],
            source_types: [],
            target_types: [],
            fields: [],
            symmetric: false,
            acyclic: false,
            aggregate: false,
            max_outgoing: 0,
            max_incoming: 0,
            group: "",
            enabled: true,
          })}
          render={(v, set, relCode) => (
            <>
              <NamesEditor
                value={v.names}
                onChange={(names) => set({ ...v, names })}
              />
              <label>{t("catalog.reverseNames")}</label>
              <NamesEditor
                value={v.reverse_names}
                onChange={(reverse_names) => set({ ...v, reverse_names })}
              />
              {(
                [
                  "source_kinds",
                  "target_kinds",
                  "source_types",
                  "target_types",
                  "fields",
                ] as const
              ).map((k) => (
                <Checks
                  key={k}
                  label={t(`catalog.${k}`)}
                  values={
                    k.endsWith("kinds")
                      ? kindNames
                      : k === "fields"
                        ? names(d.fields)
                        : names(d.types)
                  }
                  selected={v[k]}
                  onChange={(values) => set({ ...v, [k]: values })}
                />
              ))}
              <div className="cv-checks">
                {(["enabled", "symmetric", "acyclic", "aggregate"] as const).map((k) => (
                  <label key={k}>
                    <input
                      type="checkbox"
                      checked={v[k] === true}
                      onChange={(e) => set({ ...v, [k]: e.target.checked })}
                    />
                    {t(`catalog.${k}`)}
                  </label>
                ))}
              </div>
              <p className="cv-hint">{t("catalog.aggregateHint")}</p>
              {/* F04 样例预览：aggregate 开关的目录效果就地可见，与 WorkContentDirectory
                  的 componentEntries(isAggregate) 同口径（aggregate 才收进组成/所属区块）。
                  文案走字典插值，不硬编码关系码与区块名。 */}
              <p className="cv-hint" aria-live="polite">
                {v.aggregate === true
                  ? t("catalog.aggregatePreviewOn", {
                      type: relCode,
                      forward: local(v.names, locale, "", relCode),
                    })
                  : t("catalog.aggregatePreviewOff", { type: relCode })}
              </p>
              {(["max_outgoing", "max_incoming"] as const).map((k) => (
                <label key={k}>
                  {t(`catalog.${k}`)}
                  <input
                    type="number"
                    min="0"
                    value={v[k]}
                    onChange={(e) => set({ ...v, [k]: Number(e.target.value) })}
                  />
                </label>
              ))}
              <label>
                {t("catalog.displayGroup")}
                <input
                  value={v.group}
                  onChange={(e) => set({ ...v, group: e.target.value })}
                />
              </label>
              <label>{t("catalog.groupNames")}</label>
              <NamesEditor
                value={v.group_names || {}}
                onChange={(group_names) => set({ ...v, group_names })}
              />
            </>
          )}
        />
      )}
      {tab === "templates" && (
        <Dictionary
          value={d.templates}
          onChange={(templates) => change({ ...d, templates })}
          create={() => ({
            names: {},
            sections: [],
            columns: [],
            relation_groups: [],
            directory: "tree",
            modules: [],
          })}
          render={(v, set) => (
            <>
              <NamesEditor
                value={v.names}
                onChange={(names) => set({ ...v, names })}
              />
              {v.sections.map((s, i) => (
                <fieldset key={i}>
                  <legend>
                    {t("catalog.section")} {i + 1}
                  </legend>
                  <NamesEditor
                    value={s.names}
                    onChange={(names) =>
                      set({
                        ...v,
                        sections: v.sections.map((x, j) =>
                          i === j ? { ...x, names } : x,
                        ),
                      })
                    }
                  />
                  <TextList
                    label={t("catalog.fieldOrder")}
                    value={s.fields}
                    onChange={(fields) =>
                      set({
                        ...v,
                        sections: v.sections.map((x, j) =>
                          i === j ? { ...x, fields } : x,
                        ),
                      })
                    }
                  />
                  <button
                    type="button"
                    onClick={() =>
                      set({
                        ...v,
                        sections: v.sections.filter((_, j) => i !== j),
                      })
                    }
                  >
                    {t("catalog.remove")}
                  </button>
                </fieldset>
              ))}
              <button
                type="button"
                onClick={() =>
                  set({
                    ...v,
                    sections: [...v.sections, { names: {}, fields: [] }],
                  })
                }
              >
                {t("catalog.addSection")}
              </button>
              <TextList
                label={t("catalog.columns")}
                value={v.columns}
                onChange={(columns) => set({ ...v, columns })}
              />
              <TextList
                label={t("catalog.relationGroups")}
                value={v.relation_groups}
                onChange={(relation_groups) => set({ ...v, relation_groups })}
              />
              <label>
                {t("catalog.directoryMode")}
                <select
                  value={v.directory}
                  onChange={(e) => set({ ...v, directory: e.target.value })}
                >
                  {["tree", "list", "discs"].map((k) => (
                    <option key={k} value={k}>
                      {t(`catalog.directoryModes.${k}`)}
                    </option>
                  ))}
                </select>
              </label>
              <TextList
                label={t("catalog.badgeFields")}
                value={v.badge_fields || []}
                onChange={(badge_fields) => set({ ...v, badge_fields })}
              />
              <TextList
                label={t("catalog.facetFields")}
                value={v.facet_fields || []}
                onChange={(facet_fields) => set({ ...v, facet_fields })}
              />
              <label>
                {t("catalog.primaryDateField")}
                <input
                  value={v.primary_date_field || ""}
                  onChange={(e) =>
                    set({ ...v, primary_date_field: e.target.value })
                  }
                />
              </label>
              <Checks
                label={t("catalog.modules")}
                values={Object.fromEntries(
                  moduleList.map((m) => [m.id, t(`catalog.module.${m.id}`)]),
                )}
                selected={v.modules}
                onChange={(modules) => set({ ...v, modules })}
              />
            </>
          )}
        />
      )}
      {tab === "schemes" && (
        <Dictionary
          value={d.schemes || {}}
          onChange={(schemes) => change({ ...d, schemes })}
          create={() => ({
            names: {},
            slot: "locator",
            kinds: [],
            types: [],
            fields: [],
            required: [],
            require_range: false,
            enabled: true,
          })}
          render={(v, set) => {
            // 子字段候选：所选 slot 全局组已声明的子字段（顺序即全局声明顺序）。
            const groupFields: Record<string, string> = Object.fromEntries(
              Object.entries((d.fields as any)?.[v.slot]?.fields || {}).map(
                ([k, f]: [string, any]) => [k, local((f as any)?.names, locale, "", k)],
              ),
            );
            return (
              <>
                <NamesEditor
                  value={v.names}
                  onChange={(names) => set({ ...v, names })}
                />
                <label>
                  {t("catalog.schemeSlot")}
                  <select
                    value={v.slot}
                    onChange={(e) =>
                      set({ ...v, slot: e.target.value, fields: [], required: [] })
                    }
                  >
                    {["locator", "inclusion_attributes", "subject_attributes"].map((k) => (
                      <option key={k} value={k}>
                        {t(`catalog.schemeSlotNames.${k}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <Checks
                  label={t("catalog.allowedKinds")}
                  values={kindNames}
                  selected={v.kinds || []}
                  onChange={(kinds) => set({ ...v, kinds })}
                />
                <Checks
                  label={t("catalog.schemeTypes")}
                  values={names(d.types)}
                  selected={v.types || []}
                  onChange={(types) => set({ ...v, types })}
                />
                <Checks
                  label={t("catalog.schemeFields")}
                  values={groupFields}
                  selected={v.fields || []}
                  onChange={(fields) =>
                    set({
                      ...v,
                      fields,
                      required: (v.required || []).filter((k) => fields.includes(k)),
                    })
                  }
                />
                <Checks
                  label={t("catalog.schemeRequired")}
                  values={groupFields}
                  selected={v.required || []}
                  onChange={(required) => set({ ...v, required })}
                />
                <div className="cv-checks">
                  {(["require_range", "enabled"] as const).map((k) => (
                    <label key={k}>
                      <input
                        type="checkbox"
                        checked={!!(v as any)[k]}
                        onChange={(e) => set({ ...v, [k]: e.target.checked } as any)}
                      />
                      {t(`catalog.${k}`)}
                    </label>
                  ))}
                </div>
              </>
            );
          }}
        />
      )}
      <Evidence
        note={note}
        setNote={setNote}
        sources={sources}
        setSources={setSources}
      />
      <div className="cv-row">
        <button
          onClick={async () => {
            try {
              const r = await api("/admin/catalog-definitions", "POST", {
                document: d,
                base_version: base,
                edit_note: note,
                sources,
              });
              setDraft(r.id);
              setIssues(
                (await api(`/admin/catalog-definitions/${r.id}/impact`)).issues,
              );
              setError("");
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        >
          {t("catalog.saveDraft")}
        </button>
        {draft > 0 && (
          <button
            onClick={async () => {
              try {
                setIssues(
                  (await api(`/admin/catalog-definitions/${draft}/impact`))
                    .issues,
                );
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            {t("catalog.impact")}
          </button>
        )}
        {draft > 0 && issues?.length === 0 && (
          <button
            className="cv-primary"
            onClick={async () => {
              try {
                await api(
                  `/admin/catalog-definitions/${draft}/publish`,
                  "POST",
                  { edit_note: note, sources },
                );
                await reloadPublished();
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            {t("catalog.publish")}
          </button>
        )}
      </div>
      {issues && (
        <section>
          <h2>{t("catalog.impact")}</h2>
          {issues.length ? (
            <ul>
              {issues.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          ) : (
            <p>{t("catalog.noIssues")}</p>
          )}
        </section>
      )}
      {/* 这里原本有一个"词表新词冒烟验证"面板：它只是再调一次 /impact 再按词条名本地过滤，
          不产生任何新的服务端校验，等于一个点了也没用的按钮。服务端的真实校验路径是
          「保存草稿」（POST /admin/catalog-definitions，跑 Definitions.Validate）与
          「影响检查」（上一段，跑 impact 全量回放），因此整块删除而不是换个说法保留。 */}
    </>
  );
}
