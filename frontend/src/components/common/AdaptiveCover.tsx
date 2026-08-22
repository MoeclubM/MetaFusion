"use client";

import React, { useCallback, useState } from "react";
import { EntityCover } from "./EntityCover";
import {
  clampCoverRatio,
  inferCoverRatio,
  CoverTagInput,
} from "@/lib/cover";

interface AdaptiveCoverProps {
  src?: string | null;
  alt?: string;
  title?: string;
  originalTitle?: string;
  id?: string;
  tags?: CoverTagInput[];
  className?: string;
  imgClassName?: string;
  /** 真图加载完成前的占位比例，也用于程序封面兜底 */
  fallbackRatio?: number;
  loading?: "lazy" | "eager";
}

/**
 * 按封面图自然宽高比自适应容器：
 * - 有真图：onLoad 后读取 naturalWidth/naturalHeight 设置容器 aspect-ratio，图片完整显示（object-contain）；
 *   加载前用标签推断的比例占位，避免布局跳动。
 * - 无真图/加载失败：渲染 ProceduralCover，比例取标签推断值（音乐 1:1、影视 2:3、默认 3:4）。
 */
export function AdaptiveCover({
  src,
  alt,
  title,
  originalTitle,
  id,
  tags,
  className = "",
  imgClassName,
  fallbackRatio,
  loading = "lazy",
}: AdaptiveCoverProps) {
  const inferred = inferCoverRatio(tags);
  const [ratio, setRatio] = useState<number>(clampCoverRatio(fallbackRatio ?? inferred));
  const [loaded, setLoaded] = useState(false);

  const handleLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      setRatio(clampCoverRatio(img.naturalWidth / img.naturalHeight));
    }
    setLoaded(true);
  }, []);

  return (
    <div
      className={`relative w-full overflow-hidden ${className}`}
      style={{ aspectRatio: `${ratio}` }}
    >
      <EntityCover
        src={src}
        alt={alt}
        title={title}
        originalTitle={originalTitle}
        id={id}
        loading={loading}
        imgClassName={
          loaded
            ? "w-full h-full object-contain"
            : imgClassName ?? "w-full h-full object-cover"
        }
        onLoad={handleLoad}
      />
    </div>
  );
}
