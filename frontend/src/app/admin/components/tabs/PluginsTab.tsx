"use client";

import React, { useEffect, useState } from "react";
import {
  Puzzle,
  Plus,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Settings,
  Activity,
  Trash2,
  Globe,
  Disc,
  Film,
  Tv,
  Gamepad2,
  BookOpen,
  Bell,
  Share2,
  Music,
  Power,
  ExternalLink,
  Code,
  Send,
  Sliders,
  Shield,
  Eye,
  EyeOff,
} from "lucide-react";
import {
  fetchAdminPlugins,
  updatePlugin,
  registerExternalPlugin,
  deletePlugin,
  testPluginHealth,
  testPluginNotification,
  PluginItem,
  PluginConfigField,
  RegisterExternalPluginPayload,
} from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";

const ICON_MAP: Record<string, any> = {
  Disc,
  Film,
  Tv,
  Gamepad2,
  BookOpen,
  Bell,
  Share2,
  Music,
  Globe,
  Puzzle,
  Plug: Puzzle,
};

export function PluginsTab() {
  const { t } = useI18n();

  const [plugins, setPlugins] = useState<PluginItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [filterCap, setFilterCap] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Config Modal state
  const [configModalPlugin, setConfigModalPlugin] = useState<PluginItem | null>(null);
  const [configForm, setConfigForm] = useState<Record<string, any>>({});
  const [configRawJson, setConfigRawJson] = useState<string>("");
  const [configMode, setConfigMode] = useState<"form" | "json">("form");
  const [savingConfig, setSavingConfig] = useState(false);
  const [testingHealthId, setTestingHealthId] = useState<string | null>(null);
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});

  // Register Modal state
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);
  const [registerForm, setRegisterForm] = useState<RegisterExternalPluginPayload>({
    id: "",
    name: "",
    version: "1.0.0",
    description: "",
    author: "",
    icon: "Puzzle",
    type: "external_http",
    endpoint_url: "",
    secret_token: "",
    capabilities: ["importer"],
    is_enabled: true,
  });
  const [registering, setRegistering] = useState(false);

  // Load plugins
  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchAdminPlugins();
      setPlugins(res.items || []);
    } catch (err: any) {
      setError(err.message || "Failed to load plugins");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Toggle enable/disable
  const handleToggle = async (plugin: PluginItem) => {
    const nextState = !plugin.is_enabled;
    // Optimistic update
    setPlugins((prev) =>
      prev.map((p) => (p.id === plugin.id ? { ...p, is_enabled: nextState } : p))
    );

    try {
      await updatePlugin(plugin.id, { is_enabled: nextState });
      setSuccessMsg(`插件 "${plugin.name}" 已${nextState ? "启用" : "禁用"}`);
      setTimeout(() => setSuccessMsg(null), 3000);
      loadData();
    } catch (err: any) {
      setError(err.message || "Failed to update plugin state");
      loadData();
    }
  };

  // Open config modal
  const handleOpenConfig = (plugin: PluginItem) => {
    setConfigModalPlugin(plugin);
    const cfg = plugin.config || {};
    setConfigForm({ ...cfg });
    setConfigRawJson(JSON.stringify(cfg, null, 2));
    setConfigMode(plugin.config_schema?.fields?.length ? "form" : "json");
  };

  // Save config
  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!configModalPlugin) return;

    setSavingConfig(true);
    setError(null);

    let finalConfig = configForm;
    if (configMode === "json") {
      try {
        finalConfig = JSON.parse(configRawJson);
      } catch (err) {
        setError("JSON 格式错误，请检查输入语法");
        setSavingConfig(false);
        return;
      }
    }

    try {
      await updatePlugin(configModalPlugin.id, { config: finalConfig });
      setSuccessMsg(`插件 "${configModalPlugin.name}" 配置已保存`);
      setConfigModalPlugin(null);
      setTimeout(() => setSuccessMsg(null), 3000);
      loadData();
    } catch (err: any) {
      setError(err.message || "Failed to save configuration");
    } finally {
      setSavingConfig(false);
    }
  };

  // Test single plugin connectivity
  const handleTestHealth = async (id: string) => {
    setTestingHealthId(id);
    try {
      const res = await testPluginHealth(id);
      setPlugins((prev) =>
        prev.map((p) => (p.id === id ? { ...p, health: res } : p))
      );
      if (res.status === "healthy") {
        setSuccessMsg(`连通性测试成功 (耗时: ${res.latency_ms}ms)`);
      } else {
        setError(`插件健康异常: ${res.message} (${res.status})`);
      }
      setTimeout(() => {
        setSuccessMsg(null);
        setError(null);
      }, 4000);
    } catch (err: any) {
      setError(err.message || "Health test failed");
    } finally {
      setTestingHealthId(null);
    }
  };

  // Broadcast test notification
  const handleTestNotification = async () => {
    try {
      const res = await testPluginNotification();
      setSuccessMsg(res.message || "广播测试通知成功触发");
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: any) {
      setError(err.message || "Failed to broadcast notification");
    }
  };

  // Delete external plugin
  const handleDelete = async (plugin: PluginItem) => {
    if (!window.confirm(`确定要删除外部插件 "${plugin.name}" 吗？此操作无法撤销。`)) return;

    try {
      await deletePlugin(plugin.id);
      setSuccessMsg(`已删除插件 "${plugin.name}"`);
      setTimeout(() => setSuccessMsg(null), 3000);
      loadData();
    } catch (err: any) {
      setError(err.message || "Failed to delete plugin");
    }
  };

  // Register external plugin
  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegistering(true);
    setError(null);

    try {
      await registerExternalPlugin(registerForm);
      setIsRegisterOpen(false);
      setRegisterForm({
        id: "",
        name: "",
        version: "1.0.0",
        description: "",
        author: "",
        icon: "Puzzle",
        type: "external_http",
        endpoint_url: "",
        secret_token: "",
        capabilities: ["importer"],
        is_enabled: true,
      });
      setSuccessMsg("外部插件注册成功并已挂载到插件内核");
      setTimeout(() => setSuccessMsg(null), 3000);
      loadData();
    } catch (err: any) {
      setError(err.message || "Failed to register external plugin");
    } finally {
      setRegistering(false);
    }
  };

  // Filtering
  const filteredPlugins = plugins.filter((p) => {
    const matchesSearch =
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.description.toLowerCase().includes(searchQuery.toLowerCase());

    if (!matchesSearch) return false;
    if (filterCap === "all") return true;
    return p.capabilities.includes(filterCap);
  });

  const activeCount = plugins.filter((p) => p.is_enabled).length;
  const nativeCount = plugins.filter((p) => p.type === "native").length;
  const externalCount = plugins.length - nativeCount;

  return (
    <div className="space-y-6">
      {/* Header & Quick Stats */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <Puzzle className="w-4 h-4 text-amber-400" />
            <span>插件中心 (Plugin Center)</span>
          </h2>
          <p className="text-xs text-gray-400 mt-1">
            MetaFusion 全栈插件内核与驱动管理：内置数据源、外部微服务扩展、语义网导出与 Webhook 广播。
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={handleTestNotification}
            className="px-3 py-1.5 bg-white/[0.04] hover:bg-white/[0.08] text-gray-300 hover:text-white rounded-lg text-xs font-medium border border-white/[0.08] flex items-center gap-1.5 transition-all"
            title="向所有已启用的通知插件广播一条测试事件"
          >
            <Send className="w-3.5 h-3.5 text-amber-400" />
            <span>测试广播</span>
          </button>
          <button
            onClick={() => setIsRegisterOpen(true)}
            className="px-3 py-1.5 bg-amber-400 hover:bg-amber-300 text-black font-semibold rounded-lg text-xs flex items-center gap-1.5 shadow-sm transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>注册外部插件</span>
          </button>
        </div>
      </div>

      {/* Metrics Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-[#121216] border border-white/[0.06] rounded-xl p-3.5 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shrink-0">
            <Puzzle className="w-4 h-4" />
          </div>
          <div>
            <div className="text-[11px] text-gray-400 font-mono">已安装插件</div>
            <div className="text-base font-bold text-white mt-0.5">{plugins.length}</div>
          </div>
        </div>

        <div className="bg-[#121216] border border-white/[0.06] rounded-xl p-3.5 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
            <Power className="w-4 h-4" />
          </div>
          <div>
            <div className="text-[11px] text-gray-400 font-mono">运行中 (Active)</div>
            <div className="text-base font-bold text-white mt-0.5">{activeCount}</div>
          </div>
        </div>

        <div className="bg-[#121216] border border-white/[0.06] rounded-xl p-3.5 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 shrink-0">
            <Shield className="w-4 h-4" />
          </div>
          <div>
            <div className="text-[11px] text-gray-400 font-mono">原生内置驱动</div>
            <div className="text-base font-bold text-white mt-0.5">{nativeCount}</div>
          </div>
        </div>

        <div className="bg-[#121216] border border-white/[0.06] rounded-xl p-3.5 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 shrink-0">
            <Globe className="w-4 h-4" />
          </div>
          <div>
            <div className="text-[11px] text-gray-400 font-mono">外部/Webhook 扩展</div>
            <div className="text-base font-bold text-white mt-0.5">{externalCount}</div>
          </div>
        </div>
      </div>

      {/* Alert Messages */}
      {error && (
        <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-xs text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Filters and Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#121216]/60 border border-white/[0.06] p-2.5 rounded-xl">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          {[
            { id: "all", label: "全部" },
            { id: "importer", label: "📥 数据源导入" },
            { id: "metadata_provider", label: "🌐 外部元数据" },
            { id: "notification", label: "🔔 Webhook 通知" },
            { id: "export", label: "📤 数据导出" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilterCap(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                filterCap === tab.id
                  ? "bg-amber-400 text-black font-semibold shadow-sm"
                  : "text-gray-400 hover:text-white hover:bg-white/[0.04]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative">
          <input
            type="text"
            placeholder="搜索插件名称、ID 或描述..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full sm:w-64 bg-black/40 border border-white/[0.08] focus:border-amber-400/50 rounded-lg px-3 py-1.5 text-xs text-white placeholder-gray-500 outline-none transition-all"
          />
        </div>
      </div>

      {/* Plugins Grid */}
      {loading ? (
        <div className="py-20 flex flex-col items-center justify-center text-gray-500 gap-2 font-mono text-xs">
          <RefreshCw className="w-5 h-5 animate-spin text-amber-400" />
          <span>加载插件内核中...</span>
        </div>
      ) : filteredPlugins.length === 0 ? (
        <div className="py-16 text-center text-gray-500 border border-dashed border-white/[0.08] rounded-xl">
          <Puzzle className="w-8 h-8 mx-auto mb-2 text-gray-600 opacity-50" />
          <p className="text-xs">暂无匹配的插件</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredPlugins.map((plugin) => {
            const IconComp = ICON_MAP[plugin.icon] || Puzzle;
            const isNative = plugin.type === "native";
            const isTesting = testingHealthId === plugin.id;

            return (
              <div
                key={plugin.id}
                className={`bg-[#121216] border rounded-xl p-4 flex flex-col justify-between transition-all group ${
                  plugin.is_enabled
                    ? "border-white/[0.08] hover:border-amber-400/30"
                    : "border-white/[0.04] opacity-75 hover:opacity-100"
                }`}
              >
                <div>
                  {/* Card Header */}
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${
                          plugin.is_enabled
                            ? "bg-amber-500/10 text-amber-400 border-amber-500/20 shadow-sm"
                            : "bg-white/[0.03] text-gray-500 border-white/[0.06]"
                        }`}
                      >
                        <IconComp className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-xs font-semibold text-white tracking-wide">
                            {plugin.name}
                          </h3>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 text-[10px] font-mono text-gray-400">
                          <span>v{plugin.version}</span>
                          <span>•</span>
                          <span className="truncate max-w-[120px]">{plugin.author}</span>
                        </div>
                      </div>
                    </div>

                    {/* Enable / Disable Switch */}
                    <button
                      onClick={() => handleToggle(plugin)}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        plugin.is_enabled ? "bg-amber-400" : "bg-white/[0.12]"
                      }`}
                      title={plugin.is_enabled ? "点击禁用插件" : "点击启用插件"}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-black shadow ring-0 transition duration-200 ease-in-out ${
                          plugin.is_enabled ? "translate-x-4 bg-black" : "translate-x-0 bg-gray-300"
                        }`}
                      />
                    </button>
                  </div>

                  {/* Description */}
                  <p className="text-xs text-gray-400 line-clamp-2 leading-relaxed mb-3 min-h-[36px]">
                    {plugin.description}
                  </p>

                  {/* Badges & Tags */}
                  <div className="flex flex-wrap items-center gap-1.5 mb-4">
                    <span
                      className={`text-[9px] font-mono px-2 py-0.5 rounded border ${
                        isNative
                          ? "bg-cyan-500/10 text-cyan-300 border-cyan-500/20"
                          : plugin.type === "webhook"
                          ? "bg-amber-500/10 text-amber-300 border-amber-500/20"
                          : "bg-purple-500/10 text-purple-300 border-purple-500/20"
                      }`}
                    >
                      {isNative ? "原生驱动" : plugin.type === "webhook" ? "Webhook" : "外部进程"}
                    </span>

                    {plugin.capabilities.map((cap) => (
                      <span
                        key={cap}
                        className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/[0.04] text-gray-300 border border-white/[0.06]"
                      >
                        {cap === "importer"
                          ? "导入源"
                          : cap === "metadata_provider"
                          ? "权威关联"
                          : cap === "export"
                          ? "数据导出"
                          : cap === "notification"
                          ? "事件广播"
                          : cap}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Card Footer Actions */}
                <div className="pt-3 border-t border-white/[0.06] flex items-center justify-between gap-2">
                  {/* Health status indicator */}
                  <div className="flex items-center gap-1.5 text-[11px] font-mono">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        !plugin.is_enabled
                          ? "bg-gray-600"
                          : plugin.health?.status === "healthy"
                          ? "bg-emerald-400 animate-pulse"
                          : plugin.health?.status === "warning"
                          ? "bg-amber-400"
                          : "bg-rose-400"
                      }`}
                    />
                    <span className="text-gray-400 text-[10px]">
                      {!plugin.is_enabled
                        ? "已停用"
                        : plugin.health?.status === "healthy"
                        ? `正常 (${plugin.health?.latency_ms || 0}ms)`
                        : plugin.health?.status === "warning"
                        ? "需配置"
                        : "异常"}
                    </span>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleTestHealth(plugin.id)}
                      disabled={isTesting || !plugin.is_enabled}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/[0.06] disabled:opacity-40 transition-colors"
                      title="连通性与可用性探测"
                    >
                      <Activity className={`w-3.5 h-3.5 ${isTesting ? "animate-spin text-amber-400" : ""}`} />
                    </button>

                    <button
                      onClick={() => handleOpenConfig(plugin)}
                      className="px-2.5 py-1 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-gray-300 hover:text-white text-xs font-medium border border-white/[0.06] flex items-center gap-1 transition-all"
                    >
                      <Settings className="w-3.5 h-3.5 text-gray-400" />
                      <span>配置</span>
                    </button>

                    {!plugin.is_system && (
                      <button
                        onClick={() => handleDelete(plugin)}
                        className="p-1.5 rounded-lg text-rose-400/80 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                        title="删除外部插件"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Plugin Configuration Drawer/Modal */}
      {configModalPlugin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-[#121216] border border-white/[0.12] rounded-2xl w-full max-w-xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="p-4 border-b border-white/[0.08] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                  <Sliders className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">
                    配置插件: {configModalPlugin.name}
                  </h3>
                  <p className="text-[10px] font-mono text-gray-400 mt-0.5">
                    ID: {configModalPlugin.id} • 类型: {configModalPlugin.type}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex items-center bg-black/40 border border-white/[0.08] rounded-lg p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setConfigMode("form")}
                    className={`px-2 py-0.5 rounded text-[11px] font-medium transition-all ${
                      configMode === "form" ? "bg-amber-400 text-black font-semibold" : "text-gray-400 hover:text-white"
                    }`}
                  >
                    表单
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setConfigMode("json");
                      setConfigRawJson(JSON.stringify(configForm, null, 2));
                    }}
                    className={`px-2 py-0.5 rounded text-[11px] font-medium transition-all ${
                      configMode === "json" ? "bg-amber-400 text-black font-semibold" : "text-gray-400 hover:text-white"
                    }`}
                  >
                    JSON
                  </button>
                </div>
                <button
                  onClick={() => setConfigModalPlugin(null)}
                  className="text-gray-400 hover:text-white p-1"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSaveConfig} className="flex-1 overflow-y-auto p-5 space-y-4">
              {configMode === "form" && configModalPlugin.config_schema?.fields?.length > 0 ? (
                <div className="space-y-4">
                  {configModalPlugin.config_schema.fields.map((field: PluginConfigField) => {
                    const isPassword = field.type === "password";
                    const isVisible = showPasswords[field.key];
                    const val = configForm[field.key] ?? field.default_value ?? "";

                    return (
                      <div key={field.key} className="space-y-1.5">
                        <label className="block text-xs font-medium text-gray-300">
                          {field.label}
                          {field.required && <span className="text-amber-400 ml-1">*</span>}
                        </label>

                        {field.type === "textarea" ? (
                          <textarea
                            rows={3}
                            value={val}
                            onChange={(e) =>
                              setConfigForm({ ...configForm, [field.key]: e.target.value })
                            }
                            placeholder={field.description}
                            className="w-full bg-black/40 border border-white/[0.08] focus:border-amber-400/50 rounded-xl px-3 py-2 text-xs text-white placeholder-gray-500 outline-none font-mono"
                          />
                        ) : field.type === "select" ? (
                          <select
                            value={val}
                            onChange={(e) =>
                              setConfigForm({ ...configForm, [field.key]: e.target.value })
                            }
                            className="w-full bg-black/40 border border-white/[0.08] focus:border-amber-400/50 rounded-xl px-3 py-2 text-xs text-white outline-none"
                          >
                            {(field.options || []).map((opt) => (
                              <option key={opt} value={opt} className="bg-[#121216] text-white">
                                {opt}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <div className="relative">
                            <input
                              type={isPassword && !isVisible ? "password" : "text"}
                              value={val}
                              onChange={(e) =>
                                setConfigForm({ ...configForm, [field.key]: e.target.value })
                              }
                              placeholder={field.description}
                              className="w-full bg-black/40 border border-white/[0.08] focus:border-amber-400/50 rounded-xl px-3 py-2 text-xs text-white placeholder-gray-500 outline-none font-mono"
                            />
                            {isPassword && (
                              <button
                                type="button"
                                onClick={() =>
                                  setShowPasswords({
                                    ...showPasswords,
                                    [field.key]: !isVisible,
                                  })
                                }
                                className="absolute right-3 top-2.5 text-gray-400 hover:text-white"
                              >
                                {isVisible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                              </button>
                            )}
                          </div>
                        )}

                        {field.description && (
                          <p className="text-[10px] text-gray-500">{field.description}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="block text-xs font-mono text-gray-400">
                    JSON 配置对象 (Key-Value Schema):
                  </label>
                  <textarea
                    rows={12}
                    value={configRawJson}
                    onChange={(e) => setConfigRawJson(e.target.value)}
                    className="w-full bg-black/60 border border-white/[0.08] focus:border-amber-400/50 rounded-xl p-3 text-xs text-amber-200 font-mono outline-none"
                    placeholder="{}"
                  />
                </div>
              )}

              {/* Modal Footer Actions */}
              <div className="pt-4 border-t border-white/[0.08] flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => handleTestHealth(configModalPlugin.id)}
                  className="px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-gray-300 hover:text-white text-xs font-medium border border-white/[0.08] flex items-center gap-1.5 transition-all"
                >
                  <Activity className="w-3.5 h-3.5 text-amber-400" />
                  <span>测试连通性</span>
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setConfigModalPlugin(null)}
                    className="px-4 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white hover:bg-white/[0.04]"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={savingConfig}
                    className="px-4 py-1.5 bg-amber-400 hover:bg-amber-300 text-black font-semibold rounded-lg text-xs shadow-sm disabled:opacity-50 transition-all flex items-center gap-1"
                  >
                    {savingConfig && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                    <span>保存配置</span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Register External Plugin Modal */}
      {isRegisterOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-[#121216] border border-white/[0.12] rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-white/[0.08] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                  <Plus className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">注册外部微服务 / Webhook 插件</h3>
                  <p className="text-[10px] text-gray-400 mt-0.5">接入独立运行的 HTTP / Webhook 驱动程序</p>
                </div>
              </div>
              <button onClick={() => setIsRegisterOpen(false)} className="text-gray-400 hover:text-white p-1">
                ✕
              </button>
            </div>

            <form onSubmit={handleRegisterSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-300">
                    插件 ID (唯一标识符) <span className="text-amber-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="如 custom_manga_importer"
                    value={registerForm.id}
                    onChange={(e) => setRegisterForm({ ...registerForm, id: e.target.value })}
                    className="w-full bg-black/40 border border-white/[0.08] focus:border-amber-400/50 rounded-xl px-3 py-2 text-xs text-white font-mono outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-300">
                    显示名称 <span className="text-amber-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="如 漫画数据源导入器"
                    value={registerForm.name}
                    onChange={(e) => setRegisterForm({ ...registerForm, name: e.target.value })}
                    className="w-full bg-black/40 border border-white/[0.08] focus:border-amber-400/50 rounded-xl px-3 py-2 text-xs text-white outline-none"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-300">
                  端点服务地址 (Endpoint URL) <span className="text-amber-400">*</span>
                </label>
                <input
                  type="url"
                  required
                  placeholder="https://plugin.example.com 或 http://127.0.0.1:9090"
                  value={registerForm.endpoint_url}
                  onChange={(e) => setRegisterForm({ ...registerForm, endpoint_url: e.target.value })}
                  className="w-full bg-black/40 border border-white/[0.08] focus:border-amber-400/50 rounded-xl px-3 py-2 text-xs text-white font-mono outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-300">插件驱动类型</label>
                  <select
                    value={registerForm.type}
                    onChange={(e) => setRegisterForm({ ...registerForm, type: e.target.value })}
                    className="w-full bg-black/40 border border-white/[0.08] focus:border-amber-400/50 rounded-xl px-3 py-2 text-xs text-white outline-none"
                  >
                    <option value="external_http" className="bg-[#121216] text-white">
                      外部独立 HTTP 微服务
                    </option>
                    <option value="webhook" className="bg-[#121216] text-white">
                      Webhook 事件监听器
                    </option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-300">HMAC 验签 Token (可选)</label>
                  <input
                    type="password"
                    placeholder="用于 X-MetaFusion-Signature 签名"
                    value={registerForm.secret_token}
                    onChange={(e) => setRegisterForm({ ...registerForm, secret_token: e.target.value })}
                    className="w-full bg-black/40 border border-white/[0.08] focus:border-amber-400/50 rounded-xl px-3 py-2 text-xs text-white font-mono outline-none"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-300">声明的能力 (Capabilities)</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: "importer", label: "数据源导入 (Importer)" },
                    { id: "metadata_provider", label: "权威关联 (Metadata Provider)" },
                    { id: "notification", label: "事件广播 (Webhook Notification)" },
                    { id: "export", label: "格式导出 (Export Format)" },
                  ].map((cap) => {
                    const checked = registerForm.capabilities.includes(cap.id);
                    return (
                      <label
                        key={cap.id}
                        className={`flex items-center gap-2 p-2.5 rounded-xl border text-xs cursor-pointer transition-all ${
                          checked
                            ? "bg-amber-500/10 border-amber-500/30 text-amber-200"
                            : "bg-black/20 border-white/[0.06] text-gray-400 hover:text-white"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? [...registerForm.capabilities, cap.id]
                              : registerForm.capabilities.filter((c) => c !== cap.id);
                            setRegisterForm({ ...registerForm, capabilities: next });
                          }}
                          className="accent-amber-400"
                        />
                        <span>{cap.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-300">插件功能描述</label>
                <textarea
                  rows={2}
                  placeholder="简述该插件支持的数据源或能力..."
                  value={registerForm.description}
                  onChange={(e) => setRegisterForm({ ...registerForm, description: e.target.value })}
                  className="w-full bg-black/40 border border-white/[0.08] focus:border-amber-400/50 rounded-xl px-3 py-2 text-xs text-white outline-none"
                />
              </div>

              <div className="pt-4 border-t border-white/[0.08] flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsRegisterOpen(false)}
                  className="px-4 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white hover:bg-white/[0.04]"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={registering}
                  className="px-4 py-1.5 bg-amber-400 hover:bg-amber-300 text-black font-semibold rounded-lg text-xs shadow-sm disabled:opacity-50 transition-all flex items-center gap-1"
                >
                  {registering && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>注册插件</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
