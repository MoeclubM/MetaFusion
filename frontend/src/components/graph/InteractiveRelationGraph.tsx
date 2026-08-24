"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { useTheme } from "@/lib/themeContext";
import { GraphNode, GraphLink, catalogEntityHref } from "@/lib/api";
import Link from "next/link";
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  Sparkles,
  ExternalLink,
  Info,
  Network,
  Layers,
  Compass,
  ArrowRight,
  ArrowLeft,
  Tag,
  Globe,
  Disc,
  User,
  Film,
  X,
  Scan,
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
  title?: string;
}

interface LayoutNode extends GraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

// 实体类型视觉主题配置与本地化辅助（支持明暗双模式高保真渲染）
const getEntityTypeTheme = (type: string, t: (k: string) => string, isDark = false) => {
  switch (type) {
    case "work":
      return {
        label: t("graph.type.work"),
        primaryColor: isDark ? "#38bdf8" : "#0284c7",
        bgFill: isDark ? "#0c4a6e" : "#e0f2fe",
        textFill: isDark ? "#7dd3fc" : "#0369a1",
        stroke: isDark ? "#0284c7" : "#38bdf8",
        badgeBgClass: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30",
        icon: Film,
      };
    case "artist":
      return {
        label: t("graph.type.artist"),
        primaryColor: isDark ? "#34d399" : "#059669",
        bgFill: isDark ? "#064e3b" : "#dcfce7",
        textFill: isDark ? "#86efac" : "#15803d",
        stroke: isDark ? "#059669" : "#34d399",
        badgeBgClass: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
        icon: User,
      };
    case "release":
      return {
        label: t("graph.type.release"),
        primaryColor: isDark ? "#fbbf24" : "#d97706",
        bgFill: isDark ? "#78350f" : "#ffedd5",
        textFill: isDark ? "#fed7aa" : "#c2410c",
        stroke: isDark ? "#d97706" : "#fbbf24",
        badgeBgClass: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
        icon: Disc,
      };
    case "franchise":
      return {
        label: t("graph.type.franchise"),
        primaryColor: isDark ? "#818cf8" : "#4f46e5",
        bgFill: isDark ? "#312e81" : "#e0e7ff",
        textFill: isDark ? "#a5b4fc" : "#4338ca",
        stroke: isDark ? "#4f46e5" : "#818cf8",
        badgeBgClass: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/30",
        icon: Layers,
      };
    case "medium":
      return {
        label: t("graph.type.medium"),
        primaryColor: isDark ? "#c084fc" : "#9333ea",
        bgFill: isDark ? "#581c87" : "#f3e8ff",
        textFill: isDark ? "#d8b4fe" : "#7e22ce",
        stroke: isDark ? "#9333ea" : "#c084fc",
        badgeBgClass: "bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30",
        icon: Disc,
      };
    case "canonical_entry":
      return {
        label: t("graph.type.canonical_entry"),
        primaryColor: isDark ? "#2dd4bf" : "#0d9488",
        bgFill: isDark ? "#134e4a" : "#ccfbf1",
        textFill: isDark ? "#5eead4" : "#0f766e",
        stroke: isDark ? "#0d9488" : "#2dd4bf",
        badgeBgClass: "bg-teal-500/15 text-teal-700 dark:text-teal-300 border-teal-500/30",
        icon: Sparkles,
      };
    default:
      return {
        label: type,
        primaryColor: isDark ? "#94a3b8" : "#64748b",
        bgFill: isDark ? "#27272a" : "#f1f5f9",
        textFill: isDark ? "#e4e4e7" : "#475569",
        stroke: isDark ? "#52525b" : "#94a3b8",
        badgeBgClass: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300 border-zinc-500/30",
        icon: Tag,
      };
  }
};

const getLinkColorHex = (color?: string) => {
  switch (color) {
    case "emerald":
      return "#10b981";
    case "sky":
    case "blue":
      return "#0284c7";
    case "purple":
      return "#a855f7";
    case "indigo":
      return "#6366f1";
    case "amber":
      return "#f59e0b";
    case "rose":
    case "red":
      return "#f43f5e";
    case "teal":
      return "#14b8a6";
    default:
      return "#64748b";
  }
};

// 连线谓词徽标智能定位与包围盒避让算法 (Smart Edge Badge Placement & Node Capsule Boundary Avoidance)
const calculateEdgeBadgePosition = (
  src: LayoutNode,
  tgt: LayoutNode,
  pillHalfWidth = 115
): { x: number; y: number } => {
  const dx = tgt.x - src.x;
  const dy = tgt.y - src.y;
  const dist = Math.hypot(dx, dy) || 1;

  // 节点下方胶囊边界估计：高度 28px，下移 r + 20px，加上阴影安全外边距至 r + 46px
  const capsuleBottomOffset = 46;

  // 初始参数区间（排除两端节点中心圆）
  let tMin = (src.radius + 24) / dist;
  let tMax = 1 - (tgt.radius + 24) / dist;

  // 若从 src 向下连线 (dy > 0)，可能穿过 src 下方的标题胶囊
  if (dy > 0) {
    const capHeightDist = src.radius + capsuleBottomOffset;
    const xOffsetAtCapBottom = Math.abs((dx / dy) * capHeightDist);
    if (xOffsetAtCapBottom < pillHalfWidth + 16) {
      const tClearSrcCap = (src.radius + capsuleBottomOffset + 14) / dy;
      tMin = Math.max(tMin, Math.min(0.48, tClearSrcCap));
    }
  }

  // 若连线向上到达 tgt (dy < 0，tgt 在上方)，可能被 tgt 下方的标题胶囊挡住
  if (dy < 0) {
    const capHeightDist = tgt.radius + capsuleBottomOffset;
    const xOffsetAtCapBottom = Math.abs((dx / Math.abs(dy)) * capHeightDist);
    if (xOffsetAtCapBottom < pillHalfWidth + 16) {
      const tClearTgtCap = 1 - (tgt.radius + capsuleBottomOffset + 14) / Math.abs(dy);
      tMax = Math.min(tMax, Math.max(0.52, tClearTgtCap));
    }
  }

  // 最佳插值参数
  let t = 0.5;
  if (tMin < tMax) {
    t = (tMin + tMax) / 2;
  } else {
    t = 0.5;
  }

  let posX = src.x + t * dx;
  let posY = src.y + t * dy;

  // 如果极端情况下两节点垂直间距过小 (tMin >= tMax)，向法线方向侧移 28px 避开胶囊正中
  if (tMin >= tMax) {
    const normalX = -dy / dist;
    const normalY = dx / dist;
    posX += normalX * 28;
    posY += normalY * 28;
  }

  return { x: posX, y: posY };
};

export const InteractiveRelationGraph: React.FC<InteractiveRelationGraphProps> = ({
  centerEntityId,
  centerEntityType,
  nodes,
  links,
  height = 580,
  className = "",
  onNodeClick,
  onEdgeClick,
  showInspector = true,
  title,
}) => {
  const { t } = useI18n();
  const { resolvedMode } = useTheme();
  const isDark = resolvedMode === "dark";

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // 拖拽手势状态追踪 Ref
  const dragRef = useRef<{
    isDown: boolean;
    startX: number;
    startY: number;
    startPanX: number;
    startPanY: number;
    hasMoved: boolean;
  }>({
    isDown: false,
    startX: 0,
    startY: 0,
    startPanX: 0,
    startPanY: 0,
    hasMoved: false,
  });

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [layoutMode, setLayoutMode] = useState<"radial" | "hierarchy" | "force">("hierarchy");
  const [filterType, setFilterType] = useState<"all" | "hierarchy" | "cast" | "media">("all");
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hoveredLinkId, setHoveredLinkId] = useState<string | null>(null);

  // 主题自适应高保真颜色
  const capsuleBg = isDark ? "#18181b" : "#ffffff";
  const capsuleStroke = isDark ? "#27272a" : "#e4e4e7";
  const nodeNameFill = isDark ? "#f4f4f5" : "#09090b";
  const edgeBadgeBg = isDark ? "#27272a" : "#ffffff";
  const edgeBadgeStroke = isDark ? "#3f3f46" : "#d4d4d8";
  const edgeBadgeText = isDark ? "#e4e4e7" : "#3f3f46";
  const centerFill = isDark ? "#3b82f6" : "#2563eb";
  const centerBorder = isDark ? "#0b0f17" : "#ffffff";

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
          l.type.includes("released_as") ||
          l.type.includes("medium")
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
          l.type.includes("publisher") ||
          l.type.includes("staff") ||
          l.type.includes("voice") ||
          l.type.includes("actor")
      );
    }
    if (filterType === "media") {
      return links.filter(
        (l) =>
          l.type.includes("adapt") ||
          l.type.includes("soundtrack") ||
          l.type.includes("spin_off") ||
          l.type.includes("remake") ||
          l.type.includes("crossover")
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

  // 计算节点布局坐标 (宽 1000, 高 680 基准坐标系)
  const layoutNodes = useMemo<Map<string, LayoutNode>>(() => {
    const map = new Map<string, LayoutNode>();
    const width = 1000;
    const height = 680;
    const centerX = width / 2;
    const centerY = height / 2;

    const otherNodes = activeNodes.filter((n) => n.id !== centerEntityId);
    const totalOthers = otherNodes.length;

    // 中心节点配置
    const centerNode = activeNodes.find((n) => n.id === centerEntityId) || {
      id: centerEntityId,
      name: centerEntityId,
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
      radius: 38, // 中心节点 76px 直径
    });

    if (layoutMode === "radial") {
      // 放射状布局：单环或双层同心环交错排布
      if (totalOthers <= 7) {
        const radius = Math.max(270, 200 + totalOthers * 16);
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
            radius: 30, // 普通节点 60px 直径
          });
        });
      } else {
        const innerCount = Math.min(6, Math.ceil(totalOthers / 2));
        const outerCount = totalOthers - innerCount;
        const rInner = 250;
        const rOuter = 410;

        for (let i = 0; i < innerCount; i++) {
          const node = otherNodes[i];
          const angle = (i / innerCount) * 2 * Math.PI - Math.PI / 2;
          const x = centerX + rInner * Math.cos(angle);
          const y = centerY + rInner * Math.sin(angle);
          map.set(node.id, {
            ...node,
            x,
            y,
            vx: 0,
            vy: 0,
            radius: 30,
          });
        }

        const offsetAngle = Math.PI / innerCount;
        for (let i = 0; i < outerCount; i++) {
          const node = otherNodes[innerCount + i];
          const angle = (i / outerCount) * 2 * Math.PI - Math.PI / 2 + offsetAngle;
          const x = centerX + rOuter * Math.cos(angle);
          const y = centerY + rOuter * Math.sin(angle);
          map.set(node.id, {
            ...node,
            x,
            y,
            vx: 0,
            vy: 0,
            radius: 30,
          });
        }
      }
    } else if (layoutMode === "hierarchy") {
      // 层次结构布局：充裕的层级间距
      const topNodes: GraphNode[] = [];
      const bottomReleaseNodes: GraphNode[] = [];
      const bottomMediumNodes: GraphNode[] = [];
      const leftArtistNodes: GraphNode[] = [];
      const rightOtherNodes: GraphNode[] = [];

      otherNodes.forEach((node) => {
        if (
          node.level < 0 ||
          node.category === "parent_franchise" ||
          node.category === "original_work" ||
          node.type === "franchise"
        ) {
          topNodes.push(node);
        } else if (node.type === "medium") {
          bottomMediumNodes.push(node);
        } else if (node.level > 0 || node.type === "release" || node.category === "release") {
          bottomReleaseNodes.push(node);
        } else if (node.type === "artist" || node.category === "artist") {
          leftArtistNodes.push(node);
        } else {
          rightOtherNodes.push(node);
        }
      });

      // Top (企划、原作、前作)
      topNodes.forEach((node, i) => {
        const span = Math.max(0, (topNodes.length - 1) * 240);
        const startX = centerX - span / 2 + (topNodes.length > 1 ? (span / (topNodes.length - 1)) * i : 0);
        map.set(node.id, { ...node, x: startX, y: centerY - 230, vx: 0, vy: 0, radius: 32 });
      });

      // Bottom 1 (发行版、续作、改编)
      bottomReleaseNodes.forEach((node, i) => {
        const span = Math.max(0, (bottomReleaseNodes.length - 1) * 240);
        const startX =
          centerX - span / 2 + (bottomReleaseNodes.length > 1 ? (span / (bottomReleaseNodes.length - 1)) * i : 0);
        map.set(node.id, {
          ...node,
          x: startX,
          y: centerY + (bottomMediumNodes.length > 0 ? 190 : 230),
          vx: 0,
          vy: 0,
          radius: 30,
        });
      });

      // Bottom 2 (分碟载体 Mediums)
      bottomMediumNodes.forEach((node, i) => {
        const span = Math.max(0, (bottomMediumNodes.length - 1) * 210);
        const startX =
          centerX - span / 2 + (bottomMediumNodes.length > 1 ? (span / (bottomMediumNodes.length - 1)) * i : 0);
        map.set(node.id, { ...node, x: startX, y: centerY + 300, vx: 0, vy: 0, radius: 28 });
      });

      // Left (创作者、演职员)
      leftArtistNodes.forEach((node, i) => {
        const total = leftArtistNodes.length;
        const startY = centerY - ((total - 1) * 130) / 2;
        map.set(node.id, { ...node, x: centerX - 380, y: startY + i * 130, vx: 0, vy: 0, radius: 30 });
      });

      // Right (衍生品、跨媒介联动等)
      rightOtherNodes.forEach((node, i) => {
        const total = rightOtherNodes.length;
        const startY = centerY - ((total - 1) * 130) / 2;
        map.set(node.id, { ...node, x: centerX + 380, y: startY + i * 130, vx: 0, vy: 0, radius: 30 });
      });
    } else {
      // 自然力导向模拟排布
      const simNodes: LayoutNode[] = [
        {
          ...centerNode,
          x: centerX,
          y: centerY,
          vx: 0,
          vy: 0,
          radius: 38,
        },
      ];

      otherNodes.forEach((node, i) => {
        const angle = (i / Math.max(1, totalOthers)) * 2 * Math.PI;
        const initDist = 260;
        simNodes.push({
          ...node,
          x: centerX + initDist * Math.cos(angle) + (Math.random() - 0.5) * 20,
          y: centerY + initDist * Math.sin(angle) + (Math.random() - 0.5) * 20,
          vx: 0,
          vy: 0,
          radius: 30,
        });
      });

      const kRep = 80000;
      const targetLen = 270;
      const kSpring = 0.04;
      const kCenter = 0.012;

      for (let iter = 0; iter < 60; iter++) {
        for (let i = 0; i < simNodes.length; i++) {
          for (let j = i + 1; j < simNodes.length; j++) {
            const n1 = simNodes[i];
            const n2 = simNodes[j];
            const dx = n2.x - n1.x;
            const dy = n2.y - n1.y;
            const dist = Math.hypot(dx, dy) || 1;
            if (dist < 200) {
              const force = (kRep / (dist * dist)) * 1.5;
              const fx = (dx / dist) * force;
              const fy = (dy / dist) * force;
              if (i !== 0) {
                n1.x -= fx;
                n1.y -= fy;
              }
              if (j !== 0) {
                n2.x += fx;
                n2.y += fy;
              }
            }
          }
        }

        filteredLinks.forEach((link) => {
          const sIdx = simNodes.findIndex((n) => n.id === link.source);
          const tIdx = simNodes.findIndex((n) => n.id === link.target);
          if (sIdx >= 0 && tIdx >= 0) {
            const sNode = simNodes[sIdx];
            const tNode = simNodes[tIdx];
            const dx = tNode.x - sNode.x;
            const dy = tNode.y - sNode.y;
            const dist = Math.hypot(dx, dy) || 1;
            const displacement = dist - targetLen;
            const fx = (dx / dist) * displacement * kSpring;
            const fy = (dy / dist) * displacement * kSpring;
            if (sIdx !== 0) {
              sNode.x += fx;
              sNode.y += fy;
            }
            if (tIdx !== 0) {
              tNode.x -= fx;
              tNode.y -= fy;
            }
          }
        });

        for (let i = 1; i < simNodes.length; i++) {
          const n = simNodes[i];
          n.x += (centerX - n.x) * kCenter;
          n.y += (centerY - n.y) * kCenter;
          n.x = Math.max(120, Math.min(880, n.x));
          n.y = Math.max(100, Math.min(580, n.y));
        }
      }

      simNodes.forEach((node) => {
        map.set(node.id, node);
      });
    }

    return map;
  }, [activeNodes, centerEntityId, centerEntityType, layoutMode, filteredLinks]);

  // 将屏幕 Client 坐标精确转换为 SVG viewBox (0..1000, 0..680) 坐标
  const getSvgPoint = useCallback((clientX: number, clientY: number): { x: number; y: number } => {
    const svg = svgRef.current;
    if (!svg) return { x: 500, y: 340 };
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (ctm) {
      const inverted = ctm.inverse();
      const svgPoint = pt.matrixTransform(inverted);
      return { x: svgPoint.x, y: svgPoint.y };
    }
    const rect = svg.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      return {
        x: ((clientX - rect.left) / rect.width) * 1000,
        y: ((clientY - rect.top) / rect.height) * 680,
      };
    }
    return { x: 500, y: 340 };
  }, []);

  // 自适应适配视口 (Fit to View / Auto-Center)：根据所有节点包围盒计算优雅缩放与居中
  const fitToView = useCallback(
    (customNodes?: Map<string, LayoutNode>) => {
      const nodesMap = customNodes || layoutNodes;
      if (!nodesMap || nodesMap.size === 0) {
        setZoom(1);
        setPan({ x: 0, y: 0 });
        return;
      }

      const nodeList = Array.from(nodesMap.values());
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;

      nodeList.forEach((n) => {
        const halfPillWidth = 110;
        const topOffset = n.radius + 15;
        const bottomOffset = n.radius + 45;

        minX = Math.min(minX, n.x - halfPillWidth);
        maxX = Math.max(maxX, n.x + halfPillWidth);
        minY = Math.min(minY, n.y - topOffset);
        maxY = Math.max(maxY, n.y + bottomOffset);
      });

      const boxWidth = Math.max(120, maxX - minX);
      const boxHeight = Math.max(120, maxY - minY);
      const boxCenterX = (minX + maxX) / 2;
      const boxCenterY = (minY + maxY) / 2;

      const svgWidth = 1000;
      const svgHeight = 680;
      const padding = 55;

      const availableWidth = svgWidth - padding * 2;
      const availableHeight = svgHeight - padding * 2;

      const scaleX = availableWidth / boxWidth;
      const scaleY = availableHeight / boxHeight;

      // 缩放范围限制在 [0.45, 1.25]
      const idealZoom = Math.min(1.2, Math.max(0.45, Math.min(scaleX, scaleY)));
      const roundedZoom = +idealZoom.toFixed(2);

      // 将包围盒几何中心对准 SVG 视口中心 (500, 340)
      const targetPanX = +(svgWidth / 2 - roundedZoom * boxCenterX).toFixed(1);
      const targetPanY = +(svgHeight / 2 - roundedZoom * boxCenterY).toFixed(1);

      setZoom(roundedZoom);
      setPan({ x: targetPanX, y: targetPanY });
    },
    [layoutNodes]
  );

  // 布局模式或过滤切换时自动适配居中视角
  useEffect(() => {
    fitToView();
  }, [layoutMode, filterType, centerEntityId, fitToView]);

  // 监听 Escape 键退出全屏
  useEffect(() => {
    if (!isFullscreen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsFullscreen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isFullscreen]);

  // 全屏切换时重新适配居中
  useEffect(() => {
    const timer = setTimeout(() => {
      fitToView();
    }, 50);
    return () => clearTimeout(timer);
  }, [isFullscreen, fitToView]);

  // 重置视图
  const handleResetView = useCallback(() => {
    fitToView();
    setSelectedNode(null);
  }, [fitToView]);

  // 工具栏按钮定点缩放（以视口中心 (500, 340) 为锚点）
  const handleZoom = useCallback((factor: number) => {
    setZoom((prevZoom) => {
      const nextZoom = Math.min(3.5, Math.max(0.3, +(prevZoom * factor).toFixed(3)));
      if (nextZoom === prevZoom) return prevZoom;
      const scaleChange = nextZoom / prevZoom;
      const cx = 500;
      const cy = 340;
      setPan((prevPan) => ({
        x: +(cx - (cx - prevPan.x) * scaleChange).toFixed(2),
        y: +(cy - (cy - prevPan.y) * scaleChange).toFixed(2),
      }));
      return nextZoom;
    });
  }, []);

  // 鼠标滚轮以光标所在 SVG 真实坐标为原点进行定点缩放 (Anchor Zooming)
  useEffect(() => {
    const el = canvasContainerRef.current;
    if (!el) return;

    const handleNativeWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const { x: mx, y: my } = getSvgPoint(e.clientX, e.clientY);

      setZoom((prevZoom) => {
        const nextZoom = Math.min(3.5, Math.max(0.3, +(prevZoom * factor).toFixed(3)));
        if (nextZoom === prevZoom) return prevZoom;
        const scaleChange = nextZoom / prevZoom;
        setPan((prevPan) => ({
          x: +(mx - (mx - prevPan.x) * scaleChange).toFixed(2),
          y: +(my - (my - prevPan.y) * scaleChange).toFixed(2),
        }));
        return nextZoom;
      });
    };

    el.addEventListener("wheel", handleNativeWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", handleNativeWheel);
    };
  }, [getSvgPoint]);

  // 鼠标 / 触控指针拖拽平移事件处理（使用精准 Pointer Events 并在拖拽期间保持 1:1 位移）
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;

    const target = e.target as HTMLElement | SVGElement;
    if (target.closest("[data-node-interactive='true']")) {
      return;
    }

    const svgPt = getSvgPoint(e.clientX, e.clientY);
    dragRef.current = {
      isDown: true,
      startX: svgPt.x,
      startY: svgPt.y,
      startPanX: pan.x,
      startPanY: pan.y,
      hasMoved: false,
    };
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.isDown) return;

    const svgPt = getSvgPoint(e.clientX, e.clientY);
    const dx = svgPt.x - dragRef.current.startX;
    const dy = svgPt.y - dragRef.current.startY;

    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      dragRef.current.hasMoved = true;
    }

    setPan({
      x: +(dragRef.current.startPanX + dx).toFixed(2),
      y: +(dragRef.current.startPanY + dy).toFixed(2),
    });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current.isDown) {
      dragRef.current.isDown = false;
      setIsDragging(false);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // 忽略 releasePointerCapture 异常
      }
    }
  };

  // 选中的节点所连接的所有图谱关系 (用于 Inspector 详细卡片)
  const selectedNodeRelations = useMemo(() => {
    if (!selectedNode) return [];
    const list: {
      link: GraphLink;
      otherNode: LayoutNode | GraphNode | undefined;
      isOutgoing: boolean;
    }[] = [];

    filteredLinks.forEach((link) => {
      if (link.source === selectedNode.id) {
        const otherNode = layoutNodes.get(link.target) || nodes.find((n) => n.id === link.target);
        list.push({ link, otherNode, isOutgoing: true });
      } else if (link.target === selectedNode.id) {
        const otherNode = layoutNodes.get(link.source) || nodes.find((n) => n.id === link.source);
        list.push({ link, otherNode, isOutgoing: false });
      }
    });

    return list;
  }, [selectedNode, filteredLinks, layoutNodes, nodes]);

  return (
    <div
      ref={containerRef}
      className={`relative flex flex-col rounded-2xl border border-border/80 bg-card/60 backdrop-blur-md overflow-hidden shadow-sm select-none ${
        isFullscreen ? "fixed inset-0 z-[9999] rounded-none h-screen w-screen bg-background/95 backdrop-blur-2xl" : ""
      } ${className}`}
      style={{ height: isFullscreen ? "100vh" : height }}
    >
      {/* 顶部工具栏与控制面板 */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 bg-background/85 border-b border-border/60 backdrop-blur-md z-10">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
            <Network className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              {title || t("graph.title")}
              <span className="text-[10px] font-mono font-medium text-muted-foreground px-2 py-0.5 rounded-full bg-secondary border border-border/40">
                {t("graph.connectedNodes", { count: activeNodes.length })}
              </span>
            </h3>
          </div>
        </div>

        {/* 布局与过滤器 */}
        <div className="flex flex-wrap items-center gap-1.5">
          {/* 关系分类过滤 */}
          <div className="flex items-center bg-secondary/80 rounded-lg p-0.5 border border-border/50 text-[11px]">
            <button
              type="button"
              onClick={() => setFilterType("all")}
              className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                filterType === "all"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t("graph.filterAll")}
            </button>
            <button
              type="button"
              onClick={() => setFilterType("hierarchy")}
              className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                filterType === "hierarchy"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t("graph.filterHierarchy")}
            </button>
            <button
              type="button"
              onClick={() => setFilterType("cast")}
              className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                filterType === "cast"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t("graph.filterCast")}
            </button>
            <button
              type="button"
              onClick={() => setFilterType("media")}
              className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                filterType === "media"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
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
              className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                layoutMode === "radial"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Compass className="w-3.5 h-3.5 inline mr-1" />
              {t("graph.layoutRadial")}
            </button>
            <button
              type="button"
              onClick={() => setLayoutMode("hierarchy")}
              title={t("graph.layoutHierarchy")}
              className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                layoutMode === "hierarchy"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Layers className="w-3.5 h-3.5 inline mr-1" />
              {t("graph.layoutHierarchy")}
            </button>
            <button
              type="button"
              onClick={() => setLayoutMode("force")}
              title={t("graph.layoutForce")}
              className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                layoutMode === "force"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 inline mr-1" />
              {t("graph.layoutForce")}
            </button>
          </div>

          {/* 缩放、自适应与全屏控制区 */}
          <div className="flex items-center gap-1 border-l border-border/60 pl-1.5">
            <button
              type="button"
              onClick={() => handleZoom(1.2)}
              title={t("graph.zoomIn")}
              className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <span className="text-[11px] font-mono text-muted-foreground/80 px-1 select-none min-w-[38px] text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => handleZoom(1 / 1.2)}
              title={t("graph.zoomOut")}
              className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleResetView}
              title={t("graph.fitView")}
              className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            >
              <Scan className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setIsFullscreen(!isFullscreen)}
              title={isFullscreen ? t("graph.exitFullscreen") : t("graph.fullscreen")}
              className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      {/* 图谱主体 SVG 交互画布 */}
      <div
        ref={canvasContainerRef}
        className="flex-1 w-full h-full relative cursor-grab active:cursor-grabbing overflow-hidden bg-dot-grid touch-none select-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <svg
          ref={svgRef}
          className="w-full h-full"
          viewBox="0 0 1000 680"
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            {/* 连线与标签投影滤镜 */}
            <filter id="badge-drop-shadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="1.5" stdDeviation="2.5" floodColor="#000000" floodOpacity={isDark ? "0.35" : "0.08"} />
            </filter>
            <filter id="node-drop-shadow" x="-30%" y="-30%" width="160%" height="160%">
              <feDropShadow dx="0" dy="3" stdDeviation="4" floodColor="#000000" floodOpacity={isDark ? "0.45" : "0.15"} />
            </filter>

            {/* 中心节点柔和环境光晕与聚焦光环渐变 */}
            <radialGradient id="grad-center-halo" cx="50%" cy="50%" r="50%">
              <stop offset="50%" stopColor={isDark ? "#38bdf8" : "#0284c7"} stopOpacity="0.28" />
              <stop offset="100%" stopColor={isDark ? "#38bdf8" : "#0284c7"} stopOpacity="0" />
            </radialGradient>
            <linearGradient id="grad-center-ring" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={isDark ? "#38bdf8" : "#0284c7"} />
              <stop offset="100%" stopColor={isDark ? "#818cf8" : "#4f46e5"} />
            </linearGradient>

            {/* 节点通用渐变定义 */}
            <linearGradient id="grad-work" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#0284c7" />
              <stop offset="100%" stopColor="#0369a1" />
            </linearGradient>
            <linearGradient id="grad-artist" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#059669" />
              <stop offset="100%" stopColor="#047857" />
            </linearGradient>
            <linearGradient id="grad-release" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#d97706" />
              <stop offset="100%" stopColor="#b45309" />
            </linearGradient>
            <linearGradient id="grad-medium" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#9333ea" />
              <stop offset="100%" stopColor="#7e22ce" />
            </linearGradient>
            <linearGradient id="grad-franchise" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#4f46e5" />
              <stop offset="100%" stopColor="#4338ca" />
            </linearGradient>
            <linearGradient id="grad-canonical_entry" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#0d9488" />
              <stop offset="100%" stopColor="#0f766e" />
            </linearGradient>
            <linearGradient id="grad-default" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#64748b" />
              <stop offset="100%" stopColor="#475569" />
            </linearGradient>

            {/* 连线箭头定义 */}
            <marker
              id="arrow-default"
              viewBox="0 0 10 10"
              refX="26"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill={isDark ? "#94a3b8" : "#64748b"} opacity="0.9" />
            </marker>
            <marker
              id="arrow-sky"
              viewBox="0 0 10 10"
              refX="26"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#0284c7" />
            </marker>
            <marker
              id="arrow-emerald"
              viewBox="0 0 10 10"
              refX="26"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#10b981" />
            </marker>
            <marker
              id="arrow-indigo"
              viewBox="0 0 10 10"
              refX="26"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#6366f1" />
            </marker>
            <marker
              id="arrow-purple"
              viewBox="0 0 10 10"
              refX="26"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#a855f7" />
            </marker>
            <marker
              id="arrow-amber"
              viewBox="0 0 10 10"
              refX="26"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#f59e0b" />
            </marker>
            <marker
              id="arrow-rose"
              viewBox="0 0 10 10"
              refX="26"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#f43f5e" />
            </marker>
            <marker
              id="arrow-teal"
              viewBox="0 0 10 10"
              refX="26"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#14b8a6" />
            </marker>
          </defs>

          {/* 根视口变换容器 (平移与缩放矩阵) */}
          <g
            transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}
            style={{
              transition: isDragging ? "none" : "transform 200ms cubic-bezier(0.16, 1, 0.3, 1)",
            }}
          >
            {/* 1. 渲染拓扑连线底层 (Edges Lines Layer) */}
            <g className="edges-lines-layer">
              {filteredLinks.map((link, idx) => {
                const src = layoutNodes.get(link.source);
                const tgt = layoutNodes.get(link.target);
                if (!src || !tgt) return null;

                const isHovered = hoveredLinkId === (link.id || `${link.source}-${link.target}`);
                const colorHex = getLinkColorHex(link.color);
                const strokeWidth = isHovered ? 2.5 : 1.8;

                return (
                  <g
                    key={`line-${link.id || idx}`}
                    data-node-interactive="true"
                    className="transition-opacity duration-200 cursor-pointer"
                    onMouseEnter={() => setHoveredLinkId(link.id || `${link.source}-${link.target}`)}
                    onMouseLeave={() => setHoveredLinkId(null)}
                    onClick={() => onEdgeClick?.(link)}
                  >
                    {/* 背景透明粗线扩大鼠标交互区域 */}
                    <line
                      x1={src.x}
                      y1={src.y}
                      x2={tgt.x}
                      y2={tgt.y}
                      stroke="transparent"
                      strokeWidth={18}
                    />

                    {/* 实体连线 */}
                    <line
                      x1={src.x}
                      y1={src.y}
                      x2={tgt.x}
                      y2={tgt.y}
                      stroke={colorHex}
                      strokeWidth={strokeWidth}
                      strokeDasharray={link.is_hierarchical ? "none" : "5,3"}
                      opacity={isHovered ? 1 : 0.75}
                      markerEnd={`url(#arrow-${link.color || "default"})`}
                    />
                  </g>
                );
              })}
            </g>

            {/* 2. 渲染拓扑节点层 (Nodes Layer: 主圆、呼吸光环、封面、标题胶囊) */}
            <g className="nodes-layer">
              {Array.from(layoutNodes.values()).map((node) => {
                const isCenter = node.id === centerEntityId;
                const isSelected = selectedNode?.id === node.id;
                const isHovered = hoveredNodeId === node.id;
                const r = node.radius;
                const theme = getEntityTypeTheme(node.type, t, isDark);

                const typeLabel = theme.label;
                const typeBadgeWidth = Math.max(34, typeLabel.length * 11 + 10);
                const maxNameChars = 16;
                const truncatedName =
                  node.name.length > maxNameChars ? `${node.name.slice(0, maxNameChars - 1)}…` : node.name;
                const nameWidth = truncatedName.length * 12.5;
                const pillWidth = Math.min(240, Math.max(110, typeBadgeWidth + nameWidth + 24));
                const pillHeight = 28;

                return (
                  <g
                    key={node.id}
                    data-node-interactive="true"
                    transform={`translate(${node.x}, ${node.y})`}
                    className="cursor-pointer transition-transform duration-150 group"
                    onMouseEnter={() => setHoveredNodeId(node.id)}
                    onMouseLeave={() => setHoveredNodeId(null)}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedNode(node);
                      onNodeClick?.(node);
                    }}
                  >
                    <title>{`${node.name} (${typeLabel})`}</title>

                    {/* 中心节点高雅呼吸光环与聚焦环 (Focus Ring) */}
                    {isCenter && (
                      <>
                        {/* 外围柔和呼吸光晕 */}
                        <circle
                          r={r + 14}
                          fill="url(#grad-center-halo)"
                          className="animate-pulse pointer-events-none"
                        />
                        {/* 细腻质感同心外环 */}
                        <circle
                          r={r + 6}
                          fill="none"
                          stroke="url(#grad-center-ring)"
                          strokeWidth={1.8}
                          strokeDasharray="4 3"
                          opacity={0.85}
                          className="pointer-events-none"
                        />
                      </>
                    )}

                    {/* 选中/悬浮状态的高亮光环 (非中心节点) */}
                    {!isCenter && (isSelected || isHovered) && (
                      <circle
                        r={r + 6}
                        fill="none"
                        stroke={theme.primaryColor}
                        strokeWidth={2}
                        strokeOpacity={0.65}
                        className="pointer-events-none animate-pulse"
                      />
                    )}

                    {/* 节点主圆底色 */}
                    <circle
                      r={r}
                      fill={isCenter ? centerFill : `url(#grad-${node.type})`}
                      stroke={isCenter ? centerBorder : theme.stroke}
                      strokeWidth={isCenter ? 3.5 : 2.5}
                      filter="url(#node-drop-shadow)"
                    />

                    {/* 封面图片剪裁区 */}
                    {node.cover_image_url ? (
                      <>
                        <clipPath id={`clip-${node.id}`}>
                          <circle r={r - 3} />
                        </clipPath>
                        <image
                          href={node.cover_image_url}
                          x={-(r - 3)}
                          y={-(r - 3)}
                          width={(r - 3) * 2}
                          height={(r - 3) * 2}
                          preserveAspectRatio="xMidYMid slice"
                          clipPath={`url(#clip-${node.id})`}
                        />
                      </>
                    ) : (
                      <text
                        textAnchor="middle"
                        y={isCenter ? 5 : 4}
                        fontSize={isCenter ? "14" : "12"}
                        fontWeight="bold"
                        fill="#ffffff"
                        className="pointer-events-none font-mono select-none"
                      >
                        {node.type.slice(0, 2).toUpperCase()}
                      </text>
                    )}

                    {/* 节点下方名称与类型双层清晰药丸 (Node Title & Type Badge) */}
                    <g transform={`translate(0, ${r + 20})`}>
                      <rect
                        x={-pillWidth / 2}
                        y={-pillHeight / 2}
                        width={pillWidth}
                        height={pillHeight}
                        rx={pillHeight / 2}
                        fill={capsuleBg}
                        stroke={isSelected || isHovered ? theme.primaryColor : capsuleStroke}
                        strokeWidth={isSelected || isHovered ? 1.5 : 1}
                        filter="url(#badge-drop-shadow)"
                      />

                      <rect
                        x={-pillWidth / 2 + 4}
                        y={-9}
                        width={typeBadgeWidth}
                        height={18}
                        rx={9}
                        fill={theme.bgFill}
                      />
                      <text
                        x={-pillWidth / 2 + 4 + typeBadgeWidth / 2}
                        y={3.5}
                        textAnchor="middle"
                        fontSize="10"
                        fontWeight="700"
                        fill={theme.textFill}
                        className="pointer-events-none select-none font-sans"
                      >
                        {typeLabel}
                      </text>

                      <text
                        x={(-pillWidth / 2 + 4 + typeBadgeWidth + (pillWidth / 2 - 6)) / 2}
                        y={4.5}
                        textAnchor="middle"
                        fontSize="13"
                        fontWeight="600"
                        fill={nodeNameFill}
                        className="pointer-events-none select-none font-sans"
                      >
                        {truncatedName}
                      </text>
                    </g>
                  </g>
                );
              })}
            </g>

            {/* 3. 渲染连线谓词徽章层 (Edge Badges Top Layer - 智能避让胶囊、永不被遮挡) */}
            <g className="edges-badges-layer">
              {filteredLinks.map((link, idx) => {
                const src = layoutNodes.get(link.source);
                const tgt = layoutNodes.get(link.target);
                if (!src || !tgt) return null;

                const isHovered = hoveredLinkId === (link.id || `${link.source}-${link.target}`);
                const colorHex = getLinkColorHex(link.color);

                // 智能避让两端节点包围盒与标题胶囊，定位在开阔有效线段中央
                const badgePos = calculateEdgeBadgePosition(src, tgt);

                const badgeLabel = link.label || link.type;
                const badgeWidth = Math.max(68, badgeLabel.length * 12 + 24);
                const badgeHeight = 24;

                return (
                  <g
                    key={`badge-${link.id || idx}`}
                    data-node-interactive="true"
                    transform={`translate(${badgePos.x}, ${badgePos.y})`}
                    className="cursor-pointer transition-all duration-150"
                    onMouseEnter={() => setHoveredLinkId(link.id || `${link.source}-${link.target}`)}
                    onMouseLeave={() => setHoveredLinkId(null)}
                    onClick={() => onEdgeClick?.(link)}
                  >
                    <rect
                      x={-badgeWidth / 2}
                      y={-badgeHeight / 2}
                      width={badgeWidth}
                      height={badgeHeight}
                      rx={6}
                      fill={edgeBadgeBg}
                      stroke={isHovered ? colorHex : edgeBadgeStroke}
                      strokeWidth={isHovered ? 1.5 : 1}
                      filter="url(#badge-drop-shadow)"
                      className="transition-all"
                    />
                    <circle
                      cx={-badgeWidth / 2 + 10}
                      cy={0}
                      r={3}
                      fill={colorHex}
                    />
                    <text
                      x={4}
                      y={3.8}
                      textAnchor="middle"
                      fontSize="11"
                      fontWeight="600"
                      fill={edgeBadgeText}
                      className="pointer-events-none font-sans select-none"
                    >
                      {badgeLabel}
                    </text>
                  </g>
                );
              })}
            </g>
          </g>
        </svg>

        {/* 底部交互操作提示浮层 */}
        <div className="absolute bottom-3 left-4 pointer-events-none text-[11px] text-muted-foreground/90 flex items-center gap-1.5 bg-background/85 backdrop-blur-md px-3 py-1.5 rounded-full border border-border/50 shadow-xs">
          <Info className="w-3.5 h-3.5 text-primary shrink-0" />
          <span>{t("graph.interactiveHint")}</span>
        </div>
      </div>

      {/* 侧边节点详细信息检查器 (Property Inspector Popover) */}
      {showInspector && selectedNode && (
        <div className="absolute top-14 right-4 w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-border bg-card/98 backdrop-blur-xl p-4 shadow-2xl z-20 space-y-3.5 animate-in fade-in slide-in-from-right-4 duration-200">
          <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-border/60">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 mb-1">
                <span
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                    getEntityTypeTheme(selectedNode.type, t, isDark).badgeBgClass
                  }`}
                >
                  {getEntityTypeTheme(selectedNode.type, t, isDark).label}
                </span>
                {selectedNode.id === centerEntityId && (
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/25">
                    {t("graph.centerNode")}
                  </span>
                )}
              </div>
              <h4 className="text-sm font-bold text-foreground truncate" title={selectedNode.name}>
                {selectedNode.name}
              </h4>
              {selectedNode.original_name && (
                <p className="text-xs text-muted-foreground truncate" title={selectedNode.original_name}>
                  {selectedNode.original_name}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setSelectedNode(null)}
              className="text-muted-foreground hover:text-foreground text-xs p-1.5 rounded-lg hover:bg-secondary transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* 封面海报大图预览 */}
          {selectedNode.cover_image_url && (
            <div className="relative w-full aspect-video rounded-xl overflow-hidden border border-border/60 bg-muted shadow-xs group">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={selectedNode.cover_image_url}
                alt={selectedNode.name}
                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
              />
            </div>
          )}

          {/* 实体基础属性网格 */}
          <div className="space-y-1.5 text-xs text-muted-foreground bg-secondary/40 p-2.5 rounded-xl border border-border/40">
            {selectedNode.country && (
              <div className="flex justify-between items-center">
                <span className="flex items-center gap-1">
                  <Globe className="w-3 h-3 text-muted-foreground" />
                  {t("graph.country")}:
                </span>
                <span className="font-mono text-foreground font-medium">{selectedNode.country}</span>
              </div>
            )}
            {selectedNode.status && (
              <div className="flex justify-between items-center">
                <span>{t("graph.status")}:</span>
                <span className="text-foreground font-medium">{selectedNode.status}</span>
              </div>
            )}
            {selectedNode.disambiguation && (
              <div className="pt-1 text-[11px] text-muted-foreground border-t border-border/40">
                <span className="font-semibold text-foreground/80">{t("graph.disambiguation")}: </span>
                {selectedNode.disambiguation}
              </div>
            )}
          </div>

          {/* 图谱中与此节点的关联关系列表 */}
          <div className="space-y-2">
            <h5 className="text-xs font-semibold text-foreground flex items-center justify-between">
              <span>{t("graph.connectedEdges")}</span>
              <span className="text-[10px] font-mono text-muted-foreground px-1.5 py-0.2 rounded bg-secondary">
                {selectedNodeRelations.length}
              </span>
            </h5>

            <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1 text-xs">
              {selectedNodeRelations.length > 0 ? (
                selectedNodeRelations.map((rel, i) => {
                  const relColor = getLinkColorHex(rel.link.color);
                  return (
                    <div
                      key={rel.link.id || i}
                      className="flex items-center justify-between gap-1.5 p-1.5 rounded-lg bg-background border border-border/50 text-[11px]"
                    >
                      <div className="flex items-center gap-1 min-w-0">
                        {rel.isOutgoing ? (
                          <ArrowRight className="w-3 h-3 text-primary shrink-0" />
                        ) : (
                          <ArrowLeft className="w-3 h-3 text-emerald-500 shrink-0" />
                        )}
                        <span
                          className="font-medium px-1.5 py-0.5 rounded text-[10px]"
                          style={{
                            backgroundColor: `${relColor}15`,
                            color: relColor,
                          }}
                        >
                          {rel.link.label}
                        </span>
                      </div>
                      <span className="font-medium text-foreground truncate max-w-[110px]" title={rel.otherNode?.name}>
                        {rel.otherNode?.name || "Target"}
                      </span>
                    </div>
                  );
                })
              ) : (
                <div className="text-[11px] text-muted-foreground text-center py-2">
                  {t("graph.noConnectedEdges")}
                </div>
              )}
            </div>
          </div>

          {/* 底部操作区：进入详情档案 */}
          <div className="pt-2.5 border-t border-border/60 flex items-center justify-end gap-2">
            <Link
              href={catalogEntityHref(selectedNode.type, selectedNode.id)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors shadow-xs"
            >
              <span>{t("graph.inspectEntity")}</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
};
