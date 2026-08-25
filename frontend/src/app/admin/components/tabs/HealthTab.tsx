"use client";

import React, { useEffect, useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import {
  Activity,
  Database,
  HardDrive,
  Cpu,
  RefreshCw,
  Search,
  Server,
  Layers,
  Pause,
  Play,
  Clock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import {
  fetchSystemHealthDetail,
  pauseQueue,
  unpauseQueue,
  SystemHealthDetail,
  QueueStatItem,
} from "@/lib/api";
import { formatBytes } from "../types";

export function HealthTab() {
  const { t } = useI18n();
  const [data, setData] = useState<SystemHealthDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [queueActioning, setQueueActioning] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchSystemHealthDetail();
      setData(res);
    } catch (err: any) {
      setError(err.message || t("admin.health.loadFailed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(() => {
      loadData();
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  const handleTogglePause = async (q: QueueStatItem) => {
    setQueueActioning(q.queue);
    try {
      if (q.paused) {
        await unpauseQueue(q.queue);
      } else {
        await pauseQueue(q.queue);
      }
      await loadData();
    } catch (err: any) {
      alert(err.message || t("admin.health.queueActionFailed"));
    } finally {
      setQueueActioning(null);
    }
  };

  const getStatusBadge = (status?: string) => {
    switch (status) {
      case "healthy":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-mono">
            <CheckCircle2 className="w-3 h-3" />
            <span>{t("admin.health.statusHealthy")}</span>
          </span>
        );
      case "warning":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 text-xs font-mono">
            <AlertTriangle className="w-3 h-3" />
            <span>{t("admin.health.statusWarning")}</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20 text-xs font-mono">
            <XCircle className="w-3 h-3" />
            <span>{t("admin.health.statusUnhealthy")}</span>
          </span>
        );
    }
  };

  const pg = data?.components?.postgres;
  const redis = data?.components?.redis;
  const s3 = data?.components?.s3_storage;
  const opensearch = data?.components?.opensearch;

  return (
    <div className="space-y-6">
      {/* 顶部控制栏 */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white/[0.02] p-5 rounded-2xl border border-white/[0.06]">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Activity className="w-5 h-5 text-emerald-400" />
            <span>{t("admin.health.title")}</span>
            {data && getStatusBadge(data.status)}
          </h2>
          <p className="text-xs text-gray-400 mt-1">
            {t("admin.health.subtitle")}
          </p>
        </div>
        <button
          onClick={loadData}
          disabled={loading}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-gray-300 hover:text-white font-mono text-xs transition-all border border-white/10"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-amber-400" : ""}`} />
          <span>{t("common.refresh")}</span>
        </button>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* 核心基础设施节点状态 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* PostgreSQL */}
        <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/[0.06] flex flex-col justify-between space-y-3">
          <div>
            <div className="flex items-center justify-between text-xs mb-2">
              <span className="font-mono text-gray-400 flex items-center gap-1.5">
                <Database className="w-4 h-4 text-emerald-400" />
                PostgreSQL
              </span>
              <span className="font-mono text-[11px] text-gray-500">{pg?.latency_ms ?? 0}ms</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-white">{t("admin.health.nodeDatabase")}</span>
              {getStatusBadge(pg?.status)}
            </div>
          </div>
          {pg?.details && (
            <div className="p-2.5 rounded-xl bg-black/30 border border-white/5 text-[11px] font-mono text-gray-400 space-y-1">
              <div className="flex justify-between">
                <span>{t("admin.health.dbConnections")}:</span>
                <span className="text-white">{pg.details.open_connections} / {pg.details.max_open_conns}</span>
              </div>
              <div className="flex justify-between">
                <span>{t("admin.health.dbInUse")}:</span>
                <span className="text-emerald-400">{pg.details.in_use}</span>
              </div>
            </div>
          )}
        </div>

        {/* Redis */}
        <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/[0.06] flex flex-col justify-between space-y-3">
          <div>
            <div className="flex items-center justify-between text-xs mb-2">
              <span className="font-mono text-gray-400 flex items-center gap-1.5">
                <Server className="w-4 h-4 text-rose-400" />
                Redis Broker
              </span>
              <span className="font-mono text-[11px] text-gray-500">{redis?.latency_ms ?? 0}ms</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-white">{t("admin.health.nodeRedis")}</span>
              {getStatusBadge(redis?.status)}
            </div>
          </div>
          {redis?.details?.info && (
            <div className="p-2.5 rounded-xl bg-black/30 border border-white/5 text-[11px] font-mono text-gray-400 space-y-1">
              <div className="flex justify-between">
                <span>{t("admin.health.redisMemory")}:</span>
                <span className="text-white">{redis.details.info.used_memory_human || "-"}</span>
              </div>
              <div className="flex justify-between">
                <span>{t("admin.health.redisClients")}:</span>
                <span className="text-rose-400">{redis.details.info.connected_clients || "-"}</span>
              </div>
            </div>
          )}
        </div>

        {/* RustFS / MinIO S3 */}
        <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/[0.06] flex flex-col justify-between space-y-3">
          <div>
            <div className="flex items-center justify-between text-xs mb-2">
              <span className="font-mono text-gray-400 flex items-center gap-1.5">
                <HardDrive className="w-4 h-4 text-sky-400" />
                RustFS (S3)
              </span>
              <span className="font-mono text-[11px] text-gray-500">{s3?.latency_ms ?? 0}ms</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-white">{t("admin.health.nodeStorage")}</span>
              {getStatusBadge(s3?.status)}
            </div>
          </div>
          {s3?.details && (
            <div className="p-2.5 rounded-xl bg-black/30 border border-white/5 text-[11px] font-mono text-gray-400 space-y-1">
              <div className="flex justify-between">
                <span>Master:</span>
                <span className={s3.details.master_exists ? "text-emerald-400" : "text-rose-400"}>
                  {s3.details.master_exists ? "OK" : "Missing"}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Preview:</span>
                <span className={s3.details.preview_exists ? "text-emerald-400" : "text-rose-400"}>
                  {s3.details.preview_exists ? "OK" : "Missing"}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* OpenSearch */}
        <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/[0.06] flex flex-col justify-between space-y-3">
          <div>
            <div className="flex items-center justify-between text-xs mb-2">
              <span className="font-mono text-gray-400 flex items-center gap-1.5">
                <Search className="w-4 h-4 text-amber-400" />
                OpenSearch
              </span>
              <span className="font-mono text-[11px] text-gray-500">{opensearch?.latency_ms ?? 0}ms</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-white">{t("admin.health.nodeSearch")}</span>
              {getStatusBadge(opensearch?.status)}
            </div>
          </div>
          {opensearch?.details && (
            <div className="p-2.5 rounded-xl bg-black/30 border border-white/5 text-[11px] font-mono text-gray-400 space-y-1">
              <div className="flex justify-between">
                <span>Index:</span>
                <span className="text-amber-400">{opensearch.details.index}</span>
              </div>
              <div className="flex justify-between">
                <span>Status:</span>
                <span className="text-white">Active</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 异步任务队列 (Task Queues) 流转看板 */}
      <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/[0.06] space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-amber-400" />
            <h3 className="font-bold text-sm text-white">{t("admin.health.queuesTitle")}</h3>
          </div>
          <span className="text-xs font-mono text-gray-500">
            {t("admin.health.queuesTotal", { count: data?.queues?.length || 0 })}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {(data?.queues || []).map((q) => (
            <div
              key={q.queue}
              className="p-4 rounded-xl bg-black/20 border border-white/5 flex flex-col justify-between space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-bold font-mono text-sm text-white">{q.queue}</span>
                  {q.paused && (
                    <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-amber-500/15 text-amber-300 border border-amber-500/30">
                      PAUSED
                    </span>
                  )}
                </div>
                <button
                  onClick={() => handleTogglePause(q)}
                  disabled={queueActioning === q.queue}
                  className="p-1 rounded bg-white/[0.04] hover:bg-white/[0.08] text-gray-400 hover:text-white transition-colors"
                  title={q.paused ? t("admin.health.queueResume") : t("admin.health.queuePause")}
                >
                  {q.paused ? <Play className="w-3.5 h-3.5 text-emerald-400" /> : <Pause className="w-3.5 h-3.5 text-amber-400" />}
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                <div className="p-2 rounded bg-white/[0.02] border border-white/5">
                  <div className="text-gray-500 text-[10px]">{t("admin.health.queueActive")}</div>
                  <div className="text-emerald-400 font-bold text-sm">{q.active}</div>
                </div>
                <div className="p-2 rounded bg-white/[0.02] border border-white/5">
                  <div className="text-gray-500 text-[10px]">{t("admin.health.queuePending")}</div>
                  <div className="text-sky-400 font-bold text-sm">{q.pending}</div>
                </div>
                <div className="p-2 rounded bg-white/[0.02] border border-white/5">
                  <div className="text-gray-500 text-[10px]">{t("admin.health.queueRetry")}</div>
                  <div className="text-amber-400 font-bold text-sm">{q.retry}</div>
                </div>
                <div className="p-2 rounded bg-white/[0.02] border border-white/5">
                  <div className="text-gray-500 text-[10px]">{t("admin.health.queueArchived")}</div>
                  <div className="text-rose-400 font-bold text-sm">{q.archived}</div>
                </div>
              </div>

              <div className="pt-2 border-t border-white/5 flex items-center justify-between text-[10px] font-mono text-gray-500">
                <span>{t("admin.health.queueCompleted")}: {q.completed}</span>
                <span>{formatBytes(q.memory_usage || 0)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 系统资源与 Go 运行时统计 */}
      {data?.system_stats && (
        <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/[0.06] space-y-3">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-purple-400" />
            <h3 className="font-bold text-sm text-white">{t("admin.health.runtimeTitle")}</h3>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
            <div className="p-3 rounded-xl bg-black/20 border border-white/5">
              <span className="text-gray-500 block text-[10px]">Goroutines</span>
              <span className="text-white font-bold text-sm">{data.system_stats.goroutines}</span>
            </div>
            <div className="p-3 rounded-xl bg-black/20 border border-white/5">
              <span className="text-gray-500 block text-[10px]">CPU Cores</span>
              <span className="text-white font-bold text-sm">{data.system_stats.cpus}</span>
            </div>
            <div className="p-3 rounded-xl bg-black/20 border border-white/5">
              <span className="text-gray-500 block text-[10px]">Heap Alloc</span>
              <span className="text-emerald-400 font-bold text-sm">{formatBytes(data.system_stats.heap_alloc)}</span>
            </div>
            <div className="p-3 rounded-xl bg-black/20 border border-white/5">
              <span className="text-gray-500 block text-[10px]">Go Version</span>
              <span className="text-purple-400 font-bold text-sm">{data.system_stats.go_version}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
