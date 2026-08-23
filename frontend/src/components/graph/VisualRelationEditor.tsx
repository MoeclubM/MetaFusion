"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import {
  RelationType,
  GraphNode,
  GraphLink,
  catalogHubOf,
  fetchApi,
} from "@/lib/api";
import { InteractiveRelationGraph } from "./InteractiveRelationGraph";
import { RelationRow } from "../editor/EditorRelationsField";
import {
  Plus,
  Trash2,
  Search,
  AlertTriangle,
  Link2,
  Sparkles,
  Check,
  X,
  Network,
  List,
} from "lucide-react";

interface VisualRelationEditorProps {
  sourceId?: string;
  sourceType: "work" | "artist" | "release" | "franchise";
  sourceName?: string;
  sourceCover?: string;
  relations: RelationRow[];
  relationTypes: RelationType[];
  onAddRelation: (rel: RelationRow) => void;
  onRemoveRelation: (idx: number) => void;
  onUpdateRelation?: (idx: number, patch: Partial<RelationRow>) => void;
  className?: string;
}

export const VisualRelationEditor: React.FC<VisualRelationEditorProps> = ({
  sourceId = "temp-center-id",
  sourceType,
  sourceName = "Current Entity",
  sourceCover,
  relations,
  relationTypes,
  onAddRelation,
  onRemoveRelation,
  onUpdateRelation,
  className = "",
}) => {
  const { t, locale } = useI18n();
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedEdge, setSelectedEdge] = useState<{ link: GraphLink; idx: number } | null>(null);

  // 搜索目标实体表单状态
  const [searchQuery, setSearchQuery] = useState("");
  const [searchType, setSearchType] = useState<string>("work");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState<any | null>(null);
  const [selectedPredicate, setSelectedPredicate] = useState<string>("");
  const [qualifier, setQualifier] = useState<string>("");

  // 根据 relations 与 relationTypes 动态生成拓扑 Graph Nodes & Links
  const { nodes, links } = useMemo(() => {
    const nodeMap = new Map<string, GraphNode>();
    const linkList: GraphLink[] = [];

    // 中心主体节点
    nodeMap.set(sourceId, {
      id: sourceId,
      name: sourceName,
      type: sourceType,
      category: "center",
      level: 0,
      cover_image_url: sourceCover,
    });

    relations.forEach((rel, idx) => {
      const targetId = rel.target_id || `temp-target-${idx}`;
      const targetType = catalogHubOf(rel.target_type || "work");
      const targetName = rel.target_label || `${targetType}:${targetId.slice(0, 8)}`;

      if (!nodeMap.has(targetId)) {
        nodeMap.set(targetId, {
          id: targetId,
          name: targetName,
          type: targetType,
          category: rel.relationship_type,
          level: targetType === "artist" ? 2 : 1,
        });
      }

      const rt = relationTypes.find((r) => r.code === rel.relationship_type);
      const label = locale.startsWith("zh")
        ? rt?.name_zh || rt?.names?.["zh-CN"] || rel.relationship_type
        : rt?.name_en || rt?.names?.["en-US"] || rt?.name_zh || rel.relationship_type;

      linkList.push({
        id: `link-${idx}`,
        source: sourceId,
        target: targetId,
        source_type: sourceType,
        target_type: targetType,
        type: rel.relationship_type,
        label: rel.qualifier ? `${label} (${rel.qualifier})` : label,
        qualifier: rel.qualifier,
        color: rt?.color || "indigo",
        is_hierarchical: rt?.is_hierarchical || false,
      });
    });

    return {
      nodes: Array.from(nodeMap.values()),
      links: linkList,
    };
  }, [sourceId, sourceType, sourceName, sourceCover, relations, relationTypes, locale]);

  // 搜索候选目标实体
  useEffect(() => {
    const term = searchQuery.trim();
    if (!term || !showAddModal) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const path =
          searchType === "artist"
            ? "artists"
            : searchType === "work"
            ? "works"
            : searchType === "release"
            ? "releases"
            : searchType === "franchise"
            ? "franchises"
            : "works";

        const res = await fetchApi<{ items: any[] }>(
          `/catalog/${path}?q=${encodeURIComponent(term)}&page_size=6`
        );
        setSearchResults(res.items || []);
      } catch (err) {
        console.error("Search failed:", err);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 280);

    return () => clearTimeout(timer);
  }, [searchQuery, searchType, showAddModal]);

  // 过滤合法谓词
  const availablePredicates = useMemo(() => {
    return relationTypes.filter((rt) => {
      const allowedSrc = rt.allowed_source_types || [];
      const allowedTgt = rt.allowed_target_types || [];

      const srcMatch =
        allowedSrc.length === 0 ||
        allowedSrc.includes(sourceType) ||
        allowedSrc.some((s) => catalogHubOf(s) === sourceType);

      const tgtMatch =
        allowedTgt.length === 0 ||
        allowedTgt.includes(searchType) ||
        allowedTgt.some((s) => catalogHubOf(s) === searchType);

      return srcMatch && tgtMatch;
    });
  }, [relationTypes, sourceType, searchType]);

  // DAG 循环与冲突检测
  const hasPotentialCycle = useMemo(() => {
    if (!selectedTarget) return false;
    if (selectedTarget.id === sourceId) return true;
    // 检查是否已经存在反向或相同连接
    const alreadyConnected = relations.some(
      (r) => r.target_id === selectedTarget.id && r.relationship_type === selectedPredicate
    );
    return alreadyConnected;
  }, [selectedTarget, sourceId, relations, selectedPredicate]);

  // 确认新增关联
  const handleConfirmAdd = () => {
    if (!selectedTarget || !selectedPredicate) return;

    const targetTitle =
      selectedTarget.title ||
      selectedTarget.name ||
      selectedTarget.edition_name ||
      selectedTarget.id;

    onAddRelation({
      target_id: selectedTarget.id,
      target_type: searchType,
      relationship_type: selectedPredicate,
      qualifier: qualifier.trim() || undefined,
      target_label: targetTitle,
    });

    setShowAddModal(false);
    setSelectedTarget(null);
    setSearchQuery("");
    setQualifier("");
  };

  const handleEdgeClick = (link: GraphLink) => {
    const idx = parseInt((link.id || "").replace("link-", ""), 10);
    if (!isNaN(idx) && idx >= 0 && idx < relations.length) {
      setSelectedEdge({ link, idx });
    }
  };

  const handleDeleteSelectedEdge = () => {
    if (selectedEdge) {
      onRemoveRelation(selectedEdge.idx);
      setSelectedEdge(null);
    }
  };

  return (
    <div className={`space-y-4 ${className}`}>
      {/* 顶部操作条 */}
      <div className="flex items-center justify-between gap-2 p-3 bg-secondary/40 rounded-xl border border-border/50">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
            <Network className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-xs font-semibold text-foreground">
              {t("graph.visualEditor")}
            </h4>
            <p className="text-[11px] text-muted-foreground">
              {t("graph.subtitle")} ({relations.length} 关联)
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            setShowAddModal(true);
            setSelectedPredicate(availablePredicates[0]?.code || "");
          }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors shadow-xs"
        >
          <Plus className="w-3.5 h-3.5" />
          {t("graph.addRelation")}
        </button>
      </div>

      {/* 关系拓扑图谱 */}
      <div className="relative">
        <InteractiveRelationGraph
          centerEntityId={sourceId}
          centerEntityType={sourceType}
          nodes={nodes}
          links={links}
          height={480}
          onEdgeClick={handleEdgeClick}
        />

        {/* 选中边弹出的快捷操作卡片 */}
        {selectedEdge && (
          <div className="absolute top-16 left-4 z-20 w-80 rounded-xl border border-border bg-card/95 backdrop-blur-md p-3.5 shadow-xl space-y-2 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start justify-between">
              <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                <Link2 className="w-3.5 h-3.5 text-primary" />
                {t("graph.editEdge")}
              </span>
              <button
                type="button"
                onClick={() => setSelectedEdge(null)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                ✕
              </button>
            </div>

            <div className="text-xs text-muted-foreground bg-secondary/50 p-2 rounded-md space-y-1">
              <div>
                <span className="font-medium text-foreground">关系谓词:</span>{" "}
                <span className="font-mono text-primary font-semibold">{selectedEdge.link.label}</span>
              </div>
              <div>
                <span className="font-medium text-foreground">目标实体:</span>{" "}
                <span>{selectedEdge.link.target}</span>
              </div>
            </div>

            <div className="pt-2 flex justify-end gap-2 border-t border-border/40">
              <button
                type="button"
                onClick={() => setSelectedEdge(null)}
                className="px-2.5 py-1 text-xs rounded-md border border-border text-foreground hover:bg-secondary"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleDeleteSelectedEdge}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {t("graph.deleteRelation")}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 智能添加关联弹窗 (Add Relation Modal) */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-border/50">
              <div className="flex items-center gap-2">
                <div className="p-1 rounded-md bg-primary/10 text-primary">
                  <Sparkles className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-bold text-foreground">{t("graph.addRelation")}</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="text-muted-foreground hover:text-foreground text-xs p-1 rounded hover:bg-secondary"
              >
                ✕
              </button>
            </div>

            {/* 1. 目标实体类型选择 */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">
                {t("graph.selectTargetEntity")}
              </label>
              <div className="grid grid-cols-4 gap-1.5 text-xs">
                {(["work", "artist", "franchise", "release"] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => {
                      setSearchType(type);
                      setSelectedTarget(null);
                    }}
                    className={`py-1.5 px-2 rounded-lg font-medium border text-center transition-all ${
                      searchType === type
                        ? "bg-primary text-primary-foreground border-primary shadow-xs"
                        : "bg-secondary/60 text-muted-foreground border-border/40 hover:text-foreground"
                    }`}
                  >
                    {type === "work"
                      ? "作品 Work"
                      : type === "artist"
                      ? "创作者 Artist"
                      : type === "franchise"
                      ? "企划 Franchise"
                      : "发行 Release"}
                  </button>
                ))}
              </div>
            </div>

            {/* 2. 目标实体实时联想搜索 */}
            <div className="space-y-1.5">
              <div className="relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t("graph.searchTarget")}
                  className="w-full pl-9 pr-4 py-2 text-xs rounded-lg bg-background border border-border focus:border-primary focus:outline-hidden"
                />
                <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-2.5 pointer-events-none" />
                {isSearching && (
                  <span className="absolute right-3 top-2.5 text-[10px] text-primary animate-pulse">
                    搜索中...
                  </span>
                )}
              </div>

              {/* 搜索候选列表 */}
              {searchResults.length > 0 && (
                <div className="max-h-40 overflow-auto rounded-lg border border-border/70 bg-secondary/30 p-1 divide-y divide-border/30">
                  {searchResults.map((item) => {
                    const isPicked = selectedTarget?.id === item.id;
                    const title = item.title || item.name || item.edition_name;
                    return (
                      <div
                        key={item.id}
                        onClick={() => setSelectedTarget(item)}
                        className={`flex items-center justify-between p-2 rounded-md cursor-pointer text-xs transition-colors ${
                          isPicked ? "bg-primary text-primary-foreground font-semibold" : "hover:bg-secondary"
                        }`}
                      >
                        <div className="min-w-0 pr-2">
                          <div className="truncate">{title}</div>
                          {item.original_title && (
                            <div className={`text-[10px] truncate ${isPicked ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                              {item.original_title}
                            </div>
                          )}
                        </div>
                        {isPicked && <Check className="w-4 h-4 shrink-0" />}
                      </div>
                    );
                  })}
                </div>
              )}

              {selectedTarget && (
                <div className="p-2.5 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-between text-xs">
                  <div className="min-w-0">
                    <span className="text-[10px] uppercase font-mono px-1 rounded bg-primary/20 text-primary font-bold mr-1.5">
                      已选择
                    </span>
                    <span className="font-semibold text-foreground">
                      {selectedTarget.title || selectedTarget.name || selectedTarget.edition_name}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedTarget(null)}
                    className="text-muted-foreground hover:text-foreground text-xs"
                  >
                    重选
                  </button>
                </div>
              )}
            </div>

            {/* 3. 语义关系谓词选择 */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">
                {t("graph.selectRelationType")}
              </label>
              <select
                value={selectedPredicate}
                onChange={(e) => setSelectedPredicate(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg bg-background border border-border focus:border-primary focus:outline-hidden font-mono"
              >
                {availablePredicates.map((rt) => {
                  const label = locale.startsWith("zh")
                    ? rt.name_zh || rt.names?.["zh-CN"] || rt.code
                    : rt.name_en || rt.names?.["en-US"] || rt.name_zh || rt.code;
                  return (
                    <option key={rt.code} value={rt.code}>
                      {label} ({rt.code})
                    </option>
                  );
                })}
              </select>
            </div>

            {/* 4. 限定修饰词 */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">
                {t("graph.qualifierLabel")}
              </label>
              <input
                type="text"
                value={qualifier}
                onChange={(e) => setQualifier(e.target.value)}
                placeholder={t("graph.qualifierPlaceholder")}
                className="w-full px-3 py-2 text-xs rounded-lg bg-background border border-border focus:border-primary focus:outline-hidden"
              />
            </div>

            {/* 循环预警提示 */}
            {hasPotentialCycle && (
              <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{t("graph.cycleWarning")}</span>
              </div>
            )}

            {/* 底部按钮 */}
            <div className="pt-2 border-t border-border/40 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 text-xs font-medium rounded-lg border border-border text-foreground hover:bg-secondary"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleConfirmAdd}
                disabled={!selectedTarget || !selectedPredicate}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors shadow-xs"
              >
                {t("graph.saveRelation")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
