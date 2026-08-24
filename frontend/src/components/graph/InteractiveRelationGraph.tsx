"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { GraphNode, GraphLink, catalogEntityHref } from "@/lib/api";
import Link from "next/link";
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  RotateCcw,
  Sparkles,
  ExternalLink,
  Info,
  Network,
  Filter,
  Layers,
  Users,
  Compass,
} from "lucide-react";

interface InteractiveRelationGraphProps {
  centerEntityId: string;
  centerEntityType: string;
  nodes: GraphNode[];
  links: GraphLink[];
  height?: number | string;
  className?: string;
  onNodeClick?: (node: GraphNode) => void;
  onEdgeClick?: (link: GraphLink) => void;
  showInspector?: boolean;
}

interface LayoutNode extends GraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

export const InteractiveRelationGraph: React.FC<InteractiveRelationGraphProps> = ({
  centerEntityId,
  centerEntityType,
  nodes,
  links,
  height = 560,
  className = "",
  onNodeClick,
  onEdgeClick,
  showInspector = true,
}) => {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [layoutMode, setLayoutMode] = useState<"radial" | "hierarchy" | "force">("radial");
  const [filterType, setFilterType] = useState<"all" | "hierarchy" | "cast" | "media">("all");
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hoveredLinkId, setHoveredLinkId] = useState<string | null>(null);

  // 过滤连线
  const filteredLinks = useMemo(() => {
    if (filterType === "all") return links;
    if (filterType === "hierarchy") {
      return links.filter(
        (l) =>
          l.is_hierarchical ||
          l.type.includes("sequel") ||
          l.type.includes("prequel") ||
          l.type.includes("parent") ||
          l.type.includes("child") ||
          l.type.includes("franchise") ||
          l.type.includes("released_as")
      );
    }
    if (filterType === "cast") {
      return links.filter(
        (l) =>
          l.source_type === "artist" ||
          l.target_type === "artist" ||
          l.type.includes("author") ||
          l.type.includes("director") ||
          l.type.includes("composer") ||
          l.type.includes("publisher")
      );
    }
    if (filterType === "media") {
      return links.filter(
        (l) =>
          l.type.includes("adapt") ||
          l.type.includes("soundtrack") ||
          l.type.includes("spin_off") ||
          l.type.includes("remake")
      );
    }
    return links;
  }, [links, filterType]);

  // 根据过滤后的连线获取激活的节点
  const activeNodeIds = useMemo(() => {
    const set = new Set<string>([centerEntityId]);
    filteredLinks.forEach((l) => {
      set.add(l.source);
      set.add(l.target);
    });
    return set;
  }, [centerEntityId, filteredLinks]);

  const activeNodes = useMemo(() => {
    return nodes.filter((n) => activeNodeIds.has(n.id));
  }, [nodes, activeNodeIds]);

  // 计算节点布局坐标
  const layoutNodes = useMemo<Map<string, LayoutNode>>(() => {
    const map = new Map<string, LayoutNode>();
    const width = 800;
    const height = 560;
    const centerX = width / 2;
    const centerY = height / 2;

    const otherNodes = activeNodes.filter((n) => n.id !== centerEntityId);
    const totalOthers = otherNodes.length;

    // 中心节点
    const centerNode = activeNodes.find((n) => n.id === centerEntityId) || {
      id: centerEntityId,
      name: "Current",
      type: centerEntityType,
      category: "center",
      level: 0,
    };

    map.set(centerEntityId, {
      ...centerNode,
      x: centerX,
      y: centerY,
      vx: 0,
      vy: 0,
      radius: 40,
    });

    if (layoutMode === "radial") {
      const radius = totalOthers > 8 ? 220 : 180;
      otherNodes.forEach((node, i) => {
        const angle = (i / Math.max(1, totalOthers)) * 2 * Math.PI - Math.PI / 2;
        const x = centerX + radius * Math.cos(angle);
        const y = centerY + radius * Math.sin(angle);
        map.set(node.id, {
          ...node,
          x,
          y,
          vx: 0,
          vy: 0,
          radius: node.type === "artist" ? 28 : 32,
        });
      });
    } else if (layoutMode === "hierarchy") {
      // 分层布局：上层为原作/企划，中层为中心，下层为改编/衍生/发行
      const topNodes: GraphNode[] = [];
      const bottomNodes: GraphNode[] = [];
      const sideNodes: GraphNode[] = [];

      otherNodes.forEach((node) => {
        if (node.level < 0 || node.category === "parent_franchise" || node.category === "original_work") {
          topNodes.push(node);
        } else if (node.level > 0 || node.type === "release" || node.type === "medium") {
          bottomNodes.push(node);
        } else {
          sideNodes.push(node);
        }
      });

      // 放置 top
      topNodes.forEach((node, i) => {
        const span = Math.min(600, topNodes.length * 150);
        const startX = centerX - span / 2 + (span / Math.max(1, topNodes.length)) * (i + 0.5);
        map.set(node.id, { ...node, x: startX, y: centerY - 180, vx: 0, vy: 0, radius: 32 });
      });

      // 放置 bottom
      bottomNodes.forEach((node, i) => {
        const span = Math.min(680, bottomNodes.length * 130);
        const startX = centerX - span / 2 + (span / Math.max(1, bottomNodes.length)) * (i + 0.5);
        map.set(node.id, { ...node, x: startX, y: centerY + 180, vx: 0, vy: 0, radius: 30 });
      });

      // 放置 side (左右两侧)
      sideNodes.forEach((node, i) => {
        const isLeft = i % 2 === 0;
        const idxInSide = Math.floor(i / 2);
        const x = isLeft ? centerX - 240 : centerX + 240;
        const y = centerY - 60 + idxInSide * 80;
        map.set(node.id, { ...node, x, y, vx: 0, vy: 0, radius: 28 });
      });
    } else {
      // 力导向简易排布
      const radius = 200;
      otherNodes.forEach((node, i) => {
        const angle = (i / Math.max(1, totalOthers)) * 2 * Math.PI;
        const x = centerX + radius * Math.cos(angle) + (Math.random() - 0.5) * 40;
        const y = centerY + radius * Math.sin(angle) + (Math.random() - 0.5) * 40;
        map.set(node.id, { ...node, x, y, vx: 0, vy: 0, radius: 30 });
      });
    }

    return map;
  }, [activeNodes, centerEntityId, centerEntityType, layoutMode]);

  // 重置视图
  const handleResetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setSelectedNode(null);
  };

  // 缩放操作
  const handleZoom = (delta: number) => {
    setZoom((prev) => Math.min(2.8, Math.max(0.35, +(prev + delta).toFixed(2))));
  };

  // 鼠标滚轮缩放 - 绑定非被动原生事件，严格阻止外层页面滚动
  useEffect(() => {
    const el = canvasContainerRef.current;
    if (!el) return;

    const handleNativeWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY < 0 ? 0.12 : -0.12;
      setZoom((prev) => Math.min(2.8, Math.max(0.35, +(prev + delta).toFixed(2))));
    };

    el.addEventListener("wheel", handleNativeWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", handleNativeWheel);
    };
  }, []);

  // 画布拖拽平移
  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).tagName === "svg" || (e.target as HTMLElement).tagName === "rect") {
      setIsDragging(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      setPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    setDraggedNodeId(null);
  };

  const getNodeColor = (type: string, isCenter: boolean) => {
    if (isCenter) return "fill-primary text-primary-foreground stroke-primary";
    switch (type) {
      case "work":
        return "fill-sky-500/20 text-sky-600 dark:text-sky-400 stroke-sky-500";
      case "artist":
        return "fill-emerald-500/20 text-emerald-600 dark:text-emerald-400 stroke-emerald-500";
      case "release":
        return "fill-amber-500/20 text-amber-600 dark:text-amber-400 stroke-amber-500";
      case "franchise":
        return "fill-indigo-500/20 text-indigo-600 dark:text-indigo-400 stroke-indigo-500";
      case "medium":
        return "fill-purple-500/20 text-purple-600 dark:text-purple-400 stroke-purple-500";
      default:
        return "fill-zinc-500/20 text-zinc-600 dark:text-zinc-400 stroke-zinc-500";
    }
  };

  const getLinkColor = (color?: string) => {
    switch (color) {
      case "emerald":
        return "#10b981";
      case "sky":
        return "#0284c7";
      case "purple":
        return "#a855f7";
      case "indigo":
        return "#6366f1";
      case "amber":
        return "#f59e0b";
      case "rose":
        return "#f43f5e";
      default:
        return "#64748b";
    }
  };

  return (
    <div
      ref={containerRef}
      className={`relative flex flex-col rounded-2xl border border-border/70 bg-card/60 backdrop-blur-md overflow-hidden shadow-sm select-none ${
        isFullscreen ? "fixed inset-0 z-50 rounded-none h-screen w-screen" : ""
      } ${className}`}
      style={{ height: isFullscreen ? "100vh" : height }}
    >
      {/* 顶部工具栏与控制面板 */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 bg-background/80 border-b border-border/50 backdrop-blur-md z-10">
        <div className="flex items-center gap-2">
          <div className="p-1 rounded-md bg-primary/10 text-primary">
            <Network className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              {t("graph.title")}
              <span className="text-[10px] font-normal text-muted-foreground px-1.5 py-0.5 rounded-full bg-secondary">
                {t("graph.connectedNodes", { count: activeNodes.length })}
              </span>
            </h3>
          </div>
        </div>

        {/* 布局与过滤器 */}
        <div className="flex items-center gap-1.5">
          {/* 关系分类过滤 */}
          <div className="flex items-center bg-secondary/80 rounded-lg p-0.5 border border-border/50 text-[11px]">
            <button
              type="button"
              onClick={() => setFilterType("all")}
              className={`px-2 py-1 rounded-md font-medium transition-all ${
                filterType === "all" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t("graph.filterAll")}
            </button>
            <button
              type="button"
              onClick={() => setFilterType("hierarchy")}
              className={`px-2 py-1 rounded-md font-medium transition-all ${
                filterType === "hierarchy" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t("graph.filterHierarchy")}
            </button>
            <button
              type="button"
              onClick={() => setFilterType("cast")}
              className={`px-2 py-1 rounded-md font-medium transition-all ${
                filterType === "cast" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t("graph.filterCast")}
            </button>
            <button
              type="button"
              onClick={() => setFilterType("media")}
              className={`px-2 py-1 rounded-md font-medium transition-all ${
                filterType === "media" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t("graph.filterMedia")}
            </button>
          </div>

          {/* 拓扑排布模式 */}
          <div className="hidden sm:flex items-center bg-secondary/80 rounded-lg p-0.5 border border-border/50 text-[11px]">
            <button
              type="button"
              onClick={() => setLayoutMode("radial")}
              title={t("graph.layoutRadial")}
              className={`px-2 py-1 rounded-md font-medium transition-all ${
                layoutMode === "radial" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Compass className="w-3.5 h-3.5 inline mr-1" />
              {t("graph.layoutRadial")}
            </button>
            <button
              type="button"
              onClick={() => setLayoutMode("hierarchy")}
              title={t("graph.layoutHierarchy")}
              className={`px-2 py-1 rounded-md font-medium transition-all ${
                layoutMode === "hierarchy" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Layers className="w-3.5 h-3.5 inline mr-1" />
              {t("graph.layoutHierarchy")}
            </button>
            <button
              type="button"
              onClick={() => setLayoutMode("force")}
              title={t("graph.layoutForce")}
              className={`px-2 py-1 rounded-md font-medium transition-all ${
                layoutMode === "force" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 inline mr-1" />
              {t("graph.layoutForce")}
            </button>
          </div>

          {/* 缩放与全屏按钮 */}
          <div className="flex items-center gap-1 border-l border-border/60 pl-1.5">
            <button
              type="button"
              onClick={() => handleZoom(0.15)}
              title={t("graph.zoomIn")}
              className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => handleZoom(-0.15)}
              title={t("graph.zoomOut")}
              className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleResetView}
              title={t("graph.resetView")}
              className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setIsFullscreen(!isFullscreen)}
              title={isFullscreen ? t("graph.exitFullscreen") : t("graph.fullscreen")}
              className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      {/* 图谱主体 SVG 交互画布 */}
      <div
        ref={canvasContainerRef}
        className="flex-1 w-full h-full relative cursor-grab active:cursor-grabbing overflow-hidden bg-dot-grid touch-none"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      >
        <svg
          ref={svgRef}
          className="w-full h-full"
          viewBox="0 0 800 560"
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            {/* 连线箭头定义 */}
            <marker
              id="arrow-default"
              viewBox="0 0 10 10"
              refX="22"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#64748b" opacity="0.8" />
            </marker>
            <marker
              id="arrow-sky"
              viewBox="0 0 10 10"
              refX="24"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#0284c7" />
            </marker>
            <marker
              id="arrow-emerald"
              viewBox="0 0 10 10"
              refX="24"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#10b981" />
            </marker>
            <marker
              id="arrow-indigo"
              viewBox="0 0 10 10"
              refX="24"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#6366f1" />
            </marker>
            <marker
              id="arrow-purple"
              viewBox="0 0 10 10"
              refX="24"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#a855f7" />
            </marker>
          </defs>

          {/* 根视口变换容器 */}
          <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
            {/* 1. 渲染拓扑连线 (Edges) */}
            {filteredLinks.map((link, idx) => {
              const src = layoutNodes.get(link.source);
              const tgt = layoutNodes.get(link.target);
              if (!src || !tgt) return null;

              const isHovered = hoveredLinkId === (link.id || `${link.source}-${link.target}`);
              const colorHex = getLinkColor(link.color);
              const strokeWidth = isHovered ? 2.5 : 1.5;

              // 计算中点与倾斜角度用于摆放 Edge Badge
              const midX = (src.x + tgt.x) / 2;
              const midY = (src.y + tgt.y) / 2;

              return (
                <g
                  key={link.id || idx}
                  className="transition-opacity duration-200 cursor-pointer"
                  onMouseEnter={() => setHoveredLinkId(link.id || `${link.source}-${link.target}`)}
                  onMouseLeave={() => setHoveredLinkId(null)}
                  onClick={() => onEdgeClick?.(link)}
                >
                  {/* 背景粗线用于扩大点击响应区域 */}
                  <line
                    x1={src.x}
                    y1={src.y}
                    x2={tgt.x}
                    y2={tgt.y}
                    stroke="transparent"
                    strokeWidth={14}
                  />
                  {/* 实体连线 */}
                  <line
                    x1={src.x}
                    y1={src.y}
                    x2={tgt.x}
                    y2={tgt.y}
                    stroke={colorHex}
                    strokeWidth={strokeWidth}
                    strokeDasharray={link.is_hierarchical ? "none" : "4,2"}
                    opacity={isHovered ? 1 : 0.65}
                    markerEnd={`url(#arrow-${link.color || "default"})`}
                  />

                  {/* 语义边文本徽章 (Edge Badge) */}
                  <g transform={`translate(${midX}, ${midY})`}>
                    <rect
                      x={-(link.label.length * 4.5 + 8)}
                      y={-10}
                      width={link.label.length * 9 + 16}
                      height={20}
                      rx={10}
                      fill="var(--card)"
                      stroke={colorHex}
                      strokeWidth={isHovered ? 1.5 : 0.8}
                      className="shadow-xs"
                    />
                    <text
                      x={0}
                      y={3}
                      textAnchor="middle"
                      fontSize="9.5"
                      fontWeight="600"
                      fill={colorHex}
                      className="pointer-events-none font-sans"
                    >
                      {link.label}
                    </text>
                  </g>
                </g>
              );
            })}

            {/* 2. 渲染拓扑节点 (Nodes) */}
            {Array.from(layoutNodes.values()).map((node) => {
              const isCenter = node.id === centerEntityId;
              const isSelected = selectedNode?.id === node.id;
              const isHovered = hoveredNodeId === node.id;
              const r = node.radius;

              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x}, ${node.y})`}
                  className="cursor-pointer transition-transform duration-150"
                  onMouseEnter={() => setHoveredNodeId(node.id)}
                  onMouseLeave={() => setHoveredNodeId(null)}
                  onClick={() => {
                    setSelectedNode(node);
                    onNodeClick?.(node);
                  }}
                >
                  {/* 外圈光晕 */}
                  {(isCenter || isSelected || isHovered) && (
                    <circle
                      r={r + (isCenter ? 8 : 6)}
                      className={`animate-pulse ${
                        isCenter
                          ? "fill-primary/20 stroke-primary/50"
                          : "fill-sky-500/20 stroke-sky-500/50"
                      }`}
                      strokeWidth={1.5}
                    />
                  )}

                  {/* 节点圆形背景 */}
                  <circle
                    r={r}
                    className={`${getNodeColor(node.type, isCenter)} shadow-md`}
                    strokeWidth={isCenter ? 3 : 2}
                  />

                  {/* 节点头像/封面或类型图标缩写 */}
                  {node.cover_image_url ? (
                    <clipPath id={`clip-${node.id}`}>
                      <circle r={r - 3} />
                    </clipPath>
                  ) : null}

                  {node.cover_image_url ? (
                    <image
                      href={node.cover_image_url}
                      x={-(r - 3)}
                      y={-(r - 3)}
                      width={(r - 3) * 2}
                      height={(r - 3) * 2}
                      preserveAspectRatio="xMidYMid slice"
                      clipPath={`url(#clip-${node.id})`}
                    />
                  ) : (
                    <text
                      textAnchor="middle"
                      y={4}
                      fontSize={isCenter ? "13" : "11"}
                      fontWeight="bold"
                      fill="currentColor"
                      className="pointer-events-none font-mono"
                    >
                      {node.type.slice(0, 2).toUpperCase()}
                    </text>
                  )}

                  {/* 节点下方名称标签 */}
                  <g transform={`translate(0, ${r + 14})`}>
                    <rect
                      x={-Math.min(90, node.name.length * 5.5 + 8)}
                      y={-9}
                      width={Math.min(180, node.name.length * 11 + 16)}
                      height={18}
                      rx={6}
                      fill="var(--background)"
                      stroke="var(--border)"
                      strokeWidth={0.8}
                      opacity={0.92}
                    />
                    <text
                      textAnchor="middle"
                      y={3.5}
                      fontSize="10"
                      fontWeight="500"
                      fill="var(--foreground)"
                      className="pointer-events-none truncate"
                    >
                      {node.name.length > 14 ? `${node.name.slice(0, 13)}…` : node.name}
                    </text>
                  </g>
                </g>
              );
            })}
          </g>
        </svg>

        {/* 底部交互操作提示浮层 */}
        <div className="absolute bottom-3 left-4 pointer-events-none text-[11px] text-muted-foreground/80 flex items-center gap-1.5 bg-background/70 backdrop-blur-xs px-2.5 py-1 rounded-full border border-border/40">
          <Info className="w-3.5 h-3.5 text-primary shrink-0" />
          <span>{t("graph.interactiveHint")}</span>
        </div>
      </div>

      {/* 侧边/悬浮节点详细信息检查器 (Node Inspector Popover) */}
      {showInspector && selectedNode && (
        <div className="absolute top-14 right-4 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-border/80 bg-card/95 backdrop-blur-md p-4 shadow-xl z-20 space-y-3 animate-in fade-in slide-in-from-right-4 duration-200">
          <div className="flex items-start justify-between gap-2 pb-2 border-b border-border/50">
            <div className="min-w-0">
              <span className="text-[10px] font-mono font-semibold uppercase px-1.5 py-0.5 rounded bg-primary/10 text-primary inline-block mb-1">
                {selectedNode.type}
              </span>
              <h4 className="text-sm font-bold text-foreground truncate">{selectedNode.name}</h4>
              {selectedNode.original_name && (
                <p className="text-xs text-muted-foreground truncate">{selectedNode.original_name}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setSelectedNode(null)}
              className="text-muted-foreground hover:text-foreground text-xs p-1 rounded hover:bg-secondary"
            >
              ✕
            </button>
          </div>

          {selectedNode.cover_image_url && (
            <div className="relative w-full aspect-video rounded-lg overflow-hidden border border-border/40 bg-muted">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={selectedNode.cover_image_url}
                alt={selectedNode.name}
                className="w-full h-full object-cover"
              />
            </div>
          )}

          <div className="space-y-1.5 text-xs text-muted-foreground">
            {selectedNode.country && (
              <div className="flex justify-between">
                <span>地区/国别:</span>
                <span className="font-mono text-foreground font-medium">{selectedNode.country}</span>
              </div>
            )}
            {selectedNode.status && (
              <div className="flex justify-between">
                <span>状态:</span>
                <span className="text-foreground font-medium">{selectedNode.status}</span>
              </div>
            )}
            {selectedNode.disambiguation && (
              <div className="text-[11px] text-muted-foreground bg-secondary/50 p-2 rounded">
                {selectedNode.disambiguation}
              </div>
            )}
          </div>

          <div className="pt-2 border-t border-border/40 flex justify-end">
            <Link
              href={catalogEntityHref(selectedNode.type, selectedNode.id)}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
            >
              {t("graph.inspectEntity")}
              <ExternalLink className="w-3 h-3" />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
};
