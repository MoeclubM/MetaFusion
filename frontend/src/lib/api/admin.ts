// 由 frontend/src/lib/api.ts 按域拆分而来（机械搬运：导出名、签名、行为与拆分前一致）。
// 域：外部权威库的管理面端点
//
// 这里不再有插件管理面（fetchPublicPlugins / PluginItem / RegisterExternalPluginPayload …）：
// 后端 catalog、auth、community、storage 四仓都没有 /plugins* 的任何实现，唯一调用方
// 只能拿到 404 再被 .catch 吞掉——留着就是一条永远取不到数据的静默降级路径。

// ── 外部权威数据库预设定义 ──
export interface ExternalDatabaseDefinition {
  code: string;
  /** 四语名称映射；zh-CN 为必填基准。 */
  names: Record<string, string>;
  /** 适用实体 kind："all" 或固定八实体 kind 之一。 */
  category: string;
  url_pattern: string;
  icon: string;
  icon_url: string;
  validation_regex: string;
  description: string;
  sort_order: number;
  is_enabled: boolean;
  is_system: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface ExternalLinkDisplay {
  code: string;
  name: string;
  icon: string;
  icon_url: string;
  external_id: string;
  url: string;
}

export function fetchExternalDatabases(category?: string): Promise<{ items: ExternalDatabaseDefinition[] }> {
  const q = category ? `?category=${encodeURIComponent(category)}` : "";
  // 统一通过主系统 /api/catalog/external-databases 获取
  return fetch(`/api/catalog/external-databases${q}`, { credentials: "same-origin" })
    .then(async (res) => {
      if (!res.ok) return { items: [] };
      return res.json();
    })
    .catch(() => ({ items: [] }));
}

export function fetchAdminExternalDatabases(): Promise<{ items: ExternalDatabaseDefinition[] }> {
  return fetch("/api/admin/external-databases", { credentials: "same-origin" })
    .then(async (res) => {
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      return res.json();
    });
}

export function createExternalDatabase(data: Partial<ExternalDatabaseDefinition>): Promise<{ message: string; data: ExternalDatabaseDefinition }> {
  return fetch("/api/admin/external-databases", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }).then(async (res) => {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    return body;
  });
}

export function updateExternalDatabase(code: string, data: Partial<ExternalDatabaseDefinition>): Promise<{ message: string; data: ExternalDatabaseDefinition }> {
  return fetch(`/api/admin/external-databases/${encodeURIComponent(code)}`, {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }).then(async (res) => {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    return body;
  });
}

export function deleteExternalDatabase(code: string): Promise<{ message: string }> {
  return fetch(`/api/admin/external-databases/${encodeURIComponent(code)}`, {
    method: "DELETE",
    credentials: "same-origin",
  }).then(async (res) => {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    return body;
  });
}
