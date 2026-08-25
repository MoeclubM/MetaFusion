"use client";

import React, { useEffect, useState } from "react";
import {
  Puzzle,
  Plus,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
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
  Send,
  Sliders,
  Shield,
  Eye,
  EyeOff,
  GitFork,
  Layers,
  Sparkles,
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
  Activity,
  Sparkles,
};

export function PluginsTab() {
  const { t } = useI18n();

  const [plugins, setPlugins] = useState<PluginItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [filterCap, setFilterCap] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Cascade confirmation modal state
  const [cascadeModal, setCascadeModal] = useState<{
    type: "enable" | "disable";
    plugin: PluginItem;
    depsOrDependents: string[];
  } | null>(null);
  const [togglingCascade, setTogglingCascade] = useState(false);

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
    dependencies: {},
    is_enabled: true,
  });
  const [dependenciesInput, setDependenciesInput] = useState<string>("");
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

  // Handle direct toggle or trigger cascade modal
  const handleToggle = async (plugin: PluginItem) => {
    const nextState = !plugin.is_enabled;

    if (nextState) {
      // 启用检查：是否有未启用的前置依赖
      if (plugin.inactive_dependencies && plugin.inactive_dependencies.length > 0) {
        setCascadeModal({
          type: "enable",
          plugin,
          depsOrDependents: plugin.inactive_dependencies,
        });
        return;
      }
      if (plugin.missing_dependencies && plugin.missing_dependencies.length > 0) {
        setError(
          `${t("admin.plugins.depMissing")}: ${plugin.missing_dependencies.join(", ")}`
        );
        return;
      }
    } else {
      // 停用检查：是否有活跃插件依赖它
      const activeDependents: string[] = [];
      if (plugin.dependents && plugin.dependents.length > 0) {
        for (const depId of plugin.dependents) {
          const found = plugins.find((p) => p.id === depId);
          if (found && found.is_enabled) {
            activeDependents.push(found.name || depId);
          }
        }
      }
      if (activeDependents.length > 0) {
        setCascadeModal({
          type: "disable",
          plugin,
          depsOrDependents: activeDependents,
        });
        return;
      }
    }

    // 执行普通启停
    await executeToggle(plugin.id, nextState, false, plugin.name);
  };

  const executeToggle = async (
    pluginId: string,
    nextState: boolean,
    cascade: boolean,
    pluginName: string
  ) => {
    setTogglingCascade(true);
    setError(null);
    try {
      await updatePlugin(pluginId, { is_enabled: nextState, cascade });
      setSuccessMsg(
        nextState
          ? t("admin.plugins.enabledSuccess", { name: pluginName })
          : t("admin.plugins.disabledSuccess", { name: pluginName })
      );
      setTimeout(() => setSuccessMsg(null), 3000);
      setCascadeModal(null);
      await loadData();
    } catch (err: any) {
      setError(err.message || "Failed to update plugin state");
      await loadData();
    } finally {
      setTogglingCascade(false);
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
      } catch (err: any) {
        setError(`JSON 解析失败: ${err.message}`);
        setSavingConfig(false);
        return;
      }
    }

    try {
      await updatePlugin(configModalPlugin.id, { config: finalConfig });
      setSuccessMsg(t("admin.plugins.configSaved", { name: configModalPlugin.name }));
      setTimeout(() => setSuccessMsg(null), 3000);
      setConfigModalPlugin(null);
      loadData();
    } catch (err: any) {
      setError(err.message || "Failed to save plugin configuration");
    } finally {
      setSavingConfig(false);
    }
  };

  // Test plugin health
  const handleTestHealth = async (id: string) => {
    setTestingHealthId(id);
    try {
      const res = await testPluginHealth(id);
      setPlugins((prev) =>
        prev.map((p) => (p.id === id ? { ...p, health: res } : p))
      );
    } catch (err: any) {
      setError(err.message || "Health test request failed");
    } finally {
      setTestingHealthId(null);
    }
  };

  // Test broadcast
  const handleTestNotification = async () => {
    setError(null);
    try {
      await testPluginNotification();
      setSuccessMsg(t("admin.plugins.broadcastSuccess"));
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: any) {
      setError(err.message || "Failed to dispatch test notification");
    }
  };

  // Delete external plugin
  const handleDelete = async (plugin: PluginItem) => {
    if (
      !window.confirm(
        t("admin.plugins.deleteConfirm", { name: plugin.name, id: plugin.id })
      )
    ) {
      return;
    }
    try {
      await deletePlugin(plugin.id);
      setSuccessMsg(t("admin.plugins.deletedSuccess", { id: plugin.id }));
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

    let parsedDeps: Record<string, string> = {};
    if (dependenciesInput.trim()) {
      try {
        parsedDeps = JSON.parse(dependenciesInput);
      } catch (err) {
        // 支持逗号分隔简单格式如 "musicbrainz, tmdb"
        for (const item of dependenciesInput.split(",")) {
          const clean = item.trim();
          if (clean) {
            parsedDeps[clean] = ">=1.0.0";
          }
        }
      }
    }

    try {
      const payload = {
        ...registerForm,
        dependencies: parsedDeps,
      };
      await registerExternalPlugin(payload);
      setSuccessMsg(t("admin.plugins.registeredSuccess", { name: registerForm.name }));
      setTimeout(() => setSuccessMsg(null), 3000);
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
        dependencies: {},
        is_enabled: true,
      });
      setDependenciesInput("");
      loadData();
    } catch (err: any) {
      setError(err.message || "Failed to register plugin");
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
            <span>{t("admin.plugins.title")}</span>
          </h2>
          <p className="text-xs text-gray-400 mt-1">
            {t("admin.plugins.desc")}
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={handleTestNotification}
            className="px-3 py-1.5 bg-white/[0.04] hover:bg-white/[0.08] text-gray-300 hover:text-white rounded-lg text-xs font-medium border border-white/[0.08] flex items-center gap-1.5 transition-all"
            title={t("admin.plugins.testBroadcastTitle")}
          >
            <Send className="w-3.5 h-3.5 text-amber-400" />
            <span>{t("admin.plugins.testBroadcast")}</span>
          </button>
          <button
            onClick={() => setIsRegisterOpen(true)}
            className="px-3 py-1.5 bg-amber-400 hover:bg-amber-300 text-black font-semibold rounded-lg text-xs flex items-center gap-1.5 shadow-sm transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t("admin.plugins.registerExternal")}</span>
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
            <div className="text-[11px] text-gray-400 font-mono">
              {t("admin.plugins.totalInstalled")}
            </div>
            <div className="text-base font-bold text-white mt-0.5">{plugins.length}</div>
          </div>
        </div>

        <div className="bg-[#121216] border border-white/[0.06] rounded-xl p-3.5 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
            <Power className="w-4 h-4" />
          </div>
          <div>
            <div className="text-[11px] text-gray-400 font-mono">
              {t("admin.plugins.runningActive")}
            </div>
            <div className="text-base font-bold text-white mt-0.5">{activeCount}</div>
          </div>
        </div>

        <div className="bg-[#121216] border border-white/[0.06] rounded-xl p-3.5 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 shrink-0">
            <Shield className="w-4 h-4" />
          </div>
          <div>
            <div className="text-[11px] text-gray-400 font-mono">
              {t("admin.plugins.nativeDrivers")}
            </div>
            <div className="text-base font-bold text-white mt-0.5">{nativeCount}</div>
          </div>
        </div>

        <div className="bg-[#121216] border border-white/[0.06] rounded-xl p-3.5 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 shrink-0">
            <Globe className="w-4 h-4" />
          </div>
          <div>
            <div className="text-[11px] text-gray-400 font-mono">
              {t("admin.plugins.externalWebhooks")}
            </div>
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
            { id: "all", label: t("admin.plugins.filterAll") },
            { id: "importer", label: t("admin.plugins.filterImporter") },
            { id: "metadata_provider", label: t("admin.plugins.filterMetadata") },
            { id: "notification", label: t("admin.plugins.filterNotification") },
            { id: "export", label: t("admin.plugins.filterExport") },
            { id: "ai_enrichment", label: t("admin.plugins.filterAI") },
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
            placeholder={t("admin.plugins.searchPlaceholder")}
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
          <span>{t("admin.plugins.loading")}</span>
        </div>
      ) : filteredPlugins.length === 0 ? (
        <div className="py-16 text-center text-gray-500 bg-[#121216]/40 border border-white/[0.06] rounded-2xl p-8">
          <Puzzle className="w-8 h-8 mx-auto text-gray-600 mb-2" />
          <p className="text-xs">{t("admin.plugins.empty")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredPlugins.map((plugin) => {
            const IconComp = ICON_MAP[plugin.icon] || Puzzle;
            const isTesting = testingHealthId === plugin.id;
            const hasDependencies =
              plugin.dependencies && Object.keys(plugin.dependencies).length > 0;
            const hasDependents =
              plugin.dependents && plugin.dependents.length > 0;

            return (
              <div
                key={plugin.id}
                className={`bg-[#121216] border rounded-2xl p-4 flex flex-col justify-between transition-all relative ${
                  plugin.is_enabled
                    ? "border-white/[0.08] hover:border-amber-400/30"
                    : "border-white/[0.04] opacity-75 hover:opacity-100"
                }`}
              >
                {/* Top Header */}
                <div>
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${
                          plugin.is_enabled
                            ? "bg-amber-500/10 border-amber-500/20 text-amber-400"
                            : "bg-white/[0.03] border-white/[0.06] text-gray-500"
                        }`}
                      >
                        <IconComp className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-xs font-semibold text-white line-clamp-1">
                            {plugin.name}
                          </h3>
                          {plugin.load_order && plugin.load_order > 0 ? (
                            <span
                              className="px-1.5 py-0.2 bg-white/[0.04] border border-white/[0.08] text-[9px] font-mono text-gray-400 rounded"
                              title={`${t("admin.plugins.loadOrder")}: #${plugin.load_order}`}
                            >
                              #{plugin.load_order}
                            </span>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px] font-mono text-gray-400 mt-0.5">
                          <span>v{plugin.version}</span>
                          <span>•</span>
                          <span className="line-clamp-1">{plugin.author}</span>
                        </div>
                      </div>
                    </div>

                    {/* Enable / Disable Switch */}
                    <button
                      onClick={() => handleToggle(plugin)}
                      disabled={togglingCascade}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        plugin.is_enabled ? "bg-amber-400" : "bg-gray-700"
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-black shadow-lg ring-0 transition duration-200 ease-in-out ${
                          plugin.is_enabled ? "translate-x-4" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>

                  {/* Plugin Description */}
                  <p className="text-xs text-gray-400 line-clamp-2 leading-relaxed min-h-[32px]">
                    {plugin.description || "No description provided."}
                  </p>

                  {/* Dependency & Topology Badges */}
                  <div className="mt-3 pt-2.5 border-t border-white/[0.04] space-y-1.5">
                    {/* Dependencies Display */}
                    {hasDependencies && (
                      <div className="flex flex-wrap items-center gap-1 text-[10px]">
                        <span className="text-gray-500 font-mono flex items-center gap-0.5">
                          <Layers className="w-2.5 h-2.5" />
                          {t("admin.plugins.dependenciesLabel")}:
                        </span>
                        {Object.entries(plugin.dependencies || {}).map(([depId, constraint]) => {
                          const depPlugin = plugins.find((p) => p.id === depId);
                          const isDepActive = depPlugin?.is_enabled;
                          return (
                            <span
                              key={depId}
                              className={`px-1.5 py-0.5 rounded text-[9px] font-mono border ${
                                !depPlugin
                                  ? "bg-rose-500/10 border-rose-500/30 text-rose-300"
                                  : isDepActive
                                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                                  : "bg-amber-500/10 border-amber-500/30 text-amber-300"
                              }`}
                              title={`${depId} (${constraint}) ${
                                !depPlugin
                                  ? "[缺失]"
                                  : isDepActive
                                  ? "[运行中]"
                                  : "[未启用]"
                              }`}
                            >
                              {depId} {constraint !== "*" && constraint !== "" ? `(${constraint})` : ""}
                            </span>
                          );
                        })}
                      </div>
                    )}

                    {/* Dependents Display */}
                    {hasDependents && (
                      <div className="flex flex-wrap items-center gap-1 text-[10px]">
                        <span className="text-gray-500 font-mono flex items-center gap-0.5">
                          <GitFork className="w-2.5 h-2.5" />
                          {t("admin.plugins.dependentsLabel")}:
                        </span>
                        {plugin.dependents?.map((depId) => {
                          const depPlugin = plugins.find((p) => p.id === depId);
                          return (
                            <span
                              key={depId}
                              className="px-1.5 py-0.5 bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 rounded text-[9px] font-mono"
                            >
                              {depPlugin?.name || depId}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Capabilities Tags */}
                  <div className="flex flex-wrap gap-1.5 mt-2.5 mb-3">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-mono border ${
                        plugin.type === "native"
                          ? "bg-amber-400/10 text-amber-300 border-amber-400/20"
                          : plugin.type === "webhook"
                          ? "bg-purple-400/10 text-purple-300 border-purple-400/20"
                          : "bg-cyan-400/10 text-cyan-300 border-cyan-400/20"
                      }`}
                    >
                      {plugin.type === "native"
                        ? t("admin.plugins.nativeTag")
                        : plugin.type === "webhook"
                        ? t("admin.plugins.webhookTag")
                        : t("admin.plugins.externalTag")}
                    </span>

                    {plugin.capabilities.map((cap) => (
                      <span
                        key={cap}
                        className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-white/[0.04] text-gray-400 border border-white/[0.06]"
                      >
                        {cap}
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
                        ? t("admin.plugins.statusDisabled")
                        : plugin.health?.status === "healthy"
                        ? (plugin.health?.latency_ms && plugin.health.latency_ms > 0)
                          ? t("admin.plugins.statusLatency", {
                              latency: plugin.health.latency_ms,
                            })
                          : t("admin.plugins.statusActive")
                        : plugin.health?.status === "warning"
                        ? t("admin.plugins.statusWarning")
                        : t("admin.plugins.statusUnhealthy")}
                    </span>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleTestHealth(plugin.id)}
                      disabled={isTesting || !plugin.is_enabled}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/[0.06] disabled:opacity-40 transition-colors"
                      title={t("admin.plugins.testHealthTitle")}
                    >
                      <Activity
                        className={`w-3.5 h-3.5 ${
                          isTesting ? "animate-spin text-amber-400" : ""
                        }`}
                      />
                    </button>

                    <button
                      onClick={() => handleOpenConfig(plugin)}
                      className="px-2.5 py-1 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-gray-300 hover:text-white text-xs font-medium border border-white/[0.06] flex items-center gap-1 transition-all"
                    >
                      <Settings className="w-3.5 h-3.5 text-gray-400" />
                      <span>{t("admin.plugins.configure")}</span>
                    </button>

                    {!plugin.is_system && (
                      <button
                        onClick={() => handleDelete(plugin)}
                        className="p-1.5 rounded-lg text-rose-400/80 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                        title={t("admin.plugins.deleteTitle")}
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

      {/* Cascade Confirmation Modal */}
      {cascadeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-[#121216] border border-amber-500/30 rounded-2xl w-full max-w-md p-5 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">
                  {cascadeModal.type === "enable"
                    ? t("admin.plugins.cascadeEnablePromptTitle")
                    : t("admin.plugins.cascadeDisablePromptTitle")}
                </h3>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  ID: {cascadeModal.plugin.id}
                </p>
              </div>
            </div>

            <p className="text-xs text-gray-300 leading-relaxed bg-black/30 p-3 rounded-xl border border-white/[0.06]">
              {cascadeModal.type === "enable"
                ? t("admin.plugins.cascadeEnablePromptDesc", {
                    name: cascadeModal.plugin.name,
                    deps: cascadeModal.depsOrDependents.join(", "),
                  })
                : t("admin.plugins.cascadeDisablePromptDesc", {
                    name: cascadeModal.plugin.name,
                    dependents: cascadeModal.depsOrDependents.join(", "),
                  })}
            </p>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setCascadeModal(null)}
                disabled={togglingCascade}
                className="px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white border border-white/[0.08] hover:bg-white/[0.04]"
              >
                {t("admin.plugins.cancel")}
              </button>
              <button
                type="button"
                onClick={() =>
                  executeToggle(
                    cascadeModal.plugin.id,
                    cascadeModal.type === "enable",
                    true,
                    cascadeModal.plugin.name
                  )
                }
                disabled={togglingCascade}
                className="px-3.5 py-1.5 bg-amber-400 hover:bg-amber-300 text-black font-semibold rounded-lg text-xs flex items-center gap-1.5 shadow-sm transition-all"
              >
                {togglingCascade && (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                )}
                <span>
                  {cascadeModal.type === "enable"
                    ? t("admin.plugins.cascadeEnableBtn")
                    : t("admin.plugins.cascadeDisableBtn")}
                </span>
              </button>
            </div>
          </div>
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
                    {configModalPlugin.name}
                  </h3>
                  <p className="text-[10px] font-mono text-gray-400 mt-0.5">
                    ID: {configModalPlugin.id} • {configModalPlugin.type}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex items-center bg-black/40 border border-white/[0.08] rounded-lg p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setConfigMode("form")}
                    className={`px-2 py-0.5 rounded text-[11px] font-medium transition-all ${
                      configMode === "form"
                        ? "bg-amber-400 text-black font-semibold"
                        : "text-gray-400 hover:text-white"
                    }`}
                  >
                    Form
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setConfigMode("json");
                      setConfigRawJson(JSON.stringify(configForm, null, 2));
                    }}
                    className={`px-2 py-0.5 rounded text-[11px] font-medium transition-all ${
                      configMode === "json"
                        ? "bg-amber-400 text-black font-semibold"
                        : "text-gray-400 hover:text-white"
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
              {configMode === "form" &&
              configModalPlugin.config_schema?.fields?.length > 0 ? (
                <div className="space-y-4">
                  {configModalPlugin.config_schema.fields.map(
                    (field: PluginConfigField) => {
                      const isPassword = field.type === "password";
                      const isVisible = showPasswords[field.key];
                      const val =
                        configForm[field.key] ?? field.default_value ?? "";

                      return (
                        <div key={field.key} className="space-y-1.5">
                          <label className="block text-xs font-medium text-gray-300">
                            {field.label}
                            {field.required && (
                              <span className="text-amber-400 ml-1">*</span>
                            )}
                          </label>

                          {field.type === "textarea" ? (
                            <textarea
                              rows={3}
                              value={val}
                              onChange={(e) =>
                                setConfigForm({
                                  ...configForm,
                                  [field.key]: e.target.value,
                                })
                              }
                              placeholder={field.description}
                              className="w-full bg-black/40 border border-white/[0.08] focus:border-amber-400/50 rounded-xl px-3 py-2 text-xs text-white placeholder-gray-500 outline-none font-mono"
                            />
                          ) : field.type === "select" ? (
                            <select
                              value={val}
                              onChange={(e) =>
                                setConfigForm({
                                  ...configForm,
                                  [field.key]: e.target.value,
                                })
                              }
                              className="w-full bg-black/40 border border-white/[0.08] focus:border-amber-400/50 rounded-xl px-3 py-2 text-xs text-white outline-none"
                            >
                              {field.options?.map((opt) => (
                                <option
                                  key={opt}
                                  value={opt}
                                  className="bg-[#121216] text-white"
                                >
                                  {opt}
                                </option>
                              ))}
                            </select>
                          ) : field.type === "boolean" ? (
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={Boolean(val)}
                                onChange={(e) =>
                                  setConfigForm({
                                    ...configForm,
                                    [field.key]: e.target.checked,
                                  })
                                }
                                className="w-4 h-4 rounded bg-black/40 border-white/[0.2] text-amber-400 focus:ring-0"
                              />
                              <span className="text-xs text-gray-300">
                                {field.description || "开启此项"}
                              </span>
                            </label>
                          ) : (
                            <div className="relative">
                              <input
                                type={
                                  isPassword
                                    ? isVisible
                                      ? "text"
                                      : "password"
                                    : field.type === "number"
                                    ? "number"
                                    : "text"
                                }
                                value={val}
                                onChange={(e) =>
                                  setConfigForm({
                                    ...configForm,
                                    [field.key]:
                                      field.type === "number"
                                        ? Number(e.target.value)
                                        : e.target.value,
                                  })
                                }
                                placeholder={field.description}
                                className="w-full bg-black/40 border border-white/[0.08] focus:border-amber-400/50 rounded-xl px-3 py-2 text-xs text-white placeholder-gray-500 outline-none"
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
                                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                                >
                                  {isVisible ? (
                                    <EyeOff className="w-3.5 h-3.5" />
                                  ) : (
                                    <Eye className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              )}
                            </div>
                          )}

                          {field.description && field.type !== "boolean" && (
                            <p className="text-[10px] text-gray-500">
                              {field.description}
                            </p>
                          )}
                        </div>
                      );
                    }
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-gray-300 font-mono">
                    {t("admin.plugins.fieldJsonConfig")}
                  </label>
                  <textarea
                    rows={12}
                    value={configRawJson}
                    onChange={(e) => setConfigRawJson(e.target.value)}
                    className="w-full bg-black/60 border border-white/[0.08] focus:border-amber-400/50 rounded-xl p-3 text-xs text-amber-300 font-mono outline-none"
                    placeholder="{}"
                  />
                </div>
              )}

              {/* Modal Footer */}
              <div className="pt-4 border-t border-white/[0.08] flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setConfigModalPlugin(null)}
                  className="px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white border border-white/[0.08] hover:bg-white/[0.04]"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={savingConfig}
                  className="px-3.5 py-1.5 bg-amber-400 hover:bg-amber-300 text-black font-semibold rounded-lg text-xs flex items-center gap-1.5 shadow-sm transition-all"
                >
                  {savingConfig && (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  )}
                  <span>{t("common.save")}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Register External Plugin Modal */}
      {isRegisterOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-[#121216] border border-white/[0.12] rounded-2xl w-full max-w-xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-white/[0.08] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                  <Plus className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">
                    {t("admin.plugins.registerExternal")}
                  </h3>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    {t("admin.plugins.registerModalSubtitle")}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsRegisterOpen(false)}
                className="text-gray-400 hover:text-white p-1"
              >
                ✕
              </button>
            </div>

            <form
              onSubmit={handleRegisterSubmit}
              className="flex-1 overflow-y-auto p-5 space-y-4"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-gray-300">
                    {t("admin.plugins.fieldId")} <span className="text-amber-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="my_custom_importer"
                    value={registerForm.id}
                    onChange={(e) =>
                      setRegisterForm({ ...registerForm, id: e.target.value })
                    }
                    className="w-full bg-black/40 border border-white/[0.08] focus:border-amber-400/50 rounded-xl px-3 py-2 text-xs text-white placeholder-gray-500 outline-none font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-medium text-gray-300">
                    {t("admin.plugins.fieldName")} <span className="text-amber-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="自定义媒体元数据抓取器"
                    value={registerForm.name}
                    onChange={(e) =>
                      setRegisterForm({ ...registerForm, name: e.target.value })
                    }
                    className="w-full bg-black/40 border border-white/[0.08] focus:border-amber-400/50 rounded-xl px-3 py-2 text-xs text-white placeholder-gray-500 outline-none"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-300">
                  {t("admin.plugins.fieldEndpoint")} <span className="text-amber-400">*</span>
                </label>
                <input
                  type="url"
                  required
                  placeholder="https://plugins.mycompany.org/metafusion/v1"
                  value={registerForm.endpoint_url}
                  onChange={(e) =>
                    setRegisterForm({
                      ...registerForm,
                      endpoint_url: e.target.value,
                    })
                  }
                  className="w-full bg-black/40 border border-white/[0.08] focus:border-amber-400/50 rounded-xl px-3 py-2 text-xs text-white placeholder-gray-500 outline-none font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-300">
                  {t("admin.plugins.fieldDeps")}
                </label>
                <input
                  type="text"
                  placeholder='{"musicbrainz": ">=1.0.0"} 或逗号分隔插件 ID'
                  value={dependenciesInput}
                  onChange={(e) => setDependenciesInput(e.target.value)}
                  className="w-full bg-black/40 border border-white/[0.08] focus:border-amber-400/50 rounded-xl px-3 py-2 text-xs text-white placeholder-gray-500 outline-none font-mono"
                />
                <p className="text-[10px] text-gray-500">
                  {t("admin.plugins.fieldDepsHint")}
                </p>
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-300">
                  {t("admin.plugins.fieldDesc")}
                </label>
                <textarea
                  rows={2}
                  placeholder={t("admin.plugins.fieldDescPlaceholder")}
                  value={registerForm.description}
                  onChange={(e) =>
                    setRegisterForm({
                      ...registerForm,
                      description: e.target.value,
                    })
                  }
                  className="w-full bg-black/40 border border-white/[0.08] focus:border-amber-400/50 rounded-xl px-3 py-2 text-xs text-white placeholder-gray-500 outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-gray-300">
                    {t("admin.plugins.fieldAuthor")}
                  </label>
                  <input
                    type="text"
                    placeholder="Community Team"
                    value={registerForm.author}
                    onChange={(e) =>
                      setRegisterForm({
                        ...registerForm,
                        author: e.target.value,
                      })
                    }
                    className="w-full bg-black/40 border border-white/[0.08] focus:border-amber-400/50 rounded-xl px-3 py-2 text-xs text-white placeholder-gray-500 outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-medium text-gray-300">
                    {t("admin.plugins.fieldVersion")}
                  </label>
                  <input
                    type="text"
                    placeholder="1.0.0"
                    value={registerForm.version}
                    onChange={(e) =>
                      setRegisterForm({
                        ...registerForm,
                        version: e.target.value,
                      })
                    }
                    className="w-full bg-black/40 border border-white/[0.08] focus:border-amber-400/50 rounded-xl px-3 py-2 text-xs text-white placeholder-gray-500 outline-none font-mono"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-300">
                  {t("admin.plugins.fieldSecret")}
                </label>
                <input
                  type="password"
                  placeholder={t("admin.plugins.fieldSecretPlaceholder")}
                  value={registerForm.secret_token}
                  onChange={(e) =>
                    setRegisterForm({
                      ...registerForm,
                      secret_token: e.target.value,
                    })
                  }
                  className="w-full bg-black/40 border border-white/[0.08] focus:border-amber-400/50 rounded-xl px-3 py-2 text-xs text-white placeholder-gray-500 outline-none"
                />
              </div>

              <div className="pt-4 border-t border-white/[0.08] flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsRegisterOpen(false)}
                  className="px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white border border-white/[0.08] hover:bg-white/[0.04]"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={registering}
                  className="px-3.5 py-1.5 bg-amber-400 hover:bg-amber-300 text-black font-semibold rounded-lg text-xs flex items-center gap-1.5 shadow-sm transition-all"
                >
                  {registering && (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  )}
                  <span>{t("admin.plugins.registerExternal")}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
