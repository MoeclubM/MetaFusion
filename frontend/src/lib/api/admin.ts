// 由 frontend/src/lib/api.ts 按域拆分而来（机械搬运：导出名、签名、行为与拆分前一致）。
// 域：插件与外部权威库的管理面端点
import { fetchApi } from "./client";

export interface PluginConfigField {
  key: string;
  label: string;
  type: string; // "string" | "password" | "number" | "boolean" | "select" | "textarea"
  default_value?: any;
  description?: string;
  required?: boolean;
  options?: string[];
}

export interface PluginConfigSchema {
  fields: PluginConfigField[];
}

export interface PluginHealthStatus {
  status: "healthy" | "warning" | "unhealthy" | "disabled" | "unknown";
  message: string;
  latency_ms: number;
  last_checked: string;
}

export interface PluginItem {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  icon: string;
  type: "native" | "external_http" | "webhook";
  endpoint_url?: string;
  capabilities: string[];
  dependencies?: Record<string, string>;
  dependents?: string[];
  dependency_status?: "satisfied" | "missing_dependencies" | "unmet_versions" | "inactive_dependencies" | string;
  missing_dependencies?: string[];
  inactive_dependencies?: string[];
  load_order?: number;
  config_schema: PluginConfigSchema;
  config: Record<string, any>;
  is_enabled: boolean;
  is_system: boolean;
  health: PluginHealthStatus;
  supported_sources?: string[];
  supported_formats?: string[];
  supported_events?: string[];
  created_at: string;
  updated_at: string;
}

export interface RegisterExternalPluginPayload {
  id: string;
  name: string;
  version?: string;
  description?: string;
  author?: string;
  icon?: string;
  type?: string;
  endpoint_url: string;
  secret_token?: string;
  capabilities: string[];
  dependencies?: Record<string, string>;
  config_schema?: PluginConfigSchema;
  config?: Record<string, any>;
  is_enabled?: boolean;
}

export interface UpdatePluginPayload {
  is_enabled?: boolean;
  config?: Record<string, any>;
  cascade?: boolean;
}

export function fetchPublicPlugins(capability?: string): Promise<{ items: PluginItem[]; count: number }> {
  const query = capability ? `?capability=${encodeURIComponent(capability)}` : "";
  return fetchApi<{ items: PluginItem[]; count: number }>(`/plugins${query}`);
}

export function fetchAdminPlugins(): Promise<{ items: PluginItem[]; count: number }> {
  return fetchApi<{ items: PluginItem[]; count: number }>("/admin/plugins");
}

export function fetchAdminPlugin(id: string): Promise<PluginItem> {
  return fetchApi<PluginItem>(`/admin/plugins/${id}`);
}

export function registerExternalPlugin(payload: RegisterExternalPluginPayload): Promise<{ message: string; plugin: PluginItem }> {
  return fetchApi<{ message: string; plugin: PluginItem }>("/admin/plugins", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updatePlugin(id: string, payload: UpdatePluginPayload): Promise<{ message: string; plugin: PluginItem }> {
  return fetchApi<{ message: string; plugin: PluginItem }>(`/admin/plugins/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deletePlugin(id: string): Promise<{ message: string }> {
  return fetchApi<{ message: string }>(`/admin/plugins/${id}`, {
    method: "DELETE",
  });
}

export function testPluginHealth(id: string): Promise<PluginHealthStatus> {
  return fetchApi<PluginHealthStatus>(`/admin/plugins/${id}/test`, {
    method: "POST",
  });
}

export function testPluginNotification(): Promise<{ message: string }> {
  return fetchApi<{ message: string }>("/admin/plugins/test-notify", {
    method: "POST",
  });
}

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
