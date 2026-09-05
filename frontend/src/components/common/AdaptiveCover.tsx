"use client";

import React, { useCallback, useState } from "react";
import { EntityCover } from "./EntityCover";
import {
  clampCoverRatio,
  inferCoverRatio,
  parseManualRatio,
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
  /** 手动固定比例（works.cover_aspect，如 "1:1"），优先于推断与自然比例 */
  aspect?: string | null;
  loading?: "lazy" | "eager";
  /** 固定外框比例，图片在外框内按自然比例完整显示 */
  frameAspect?: number;
}

/**
 * 封面容器比例决策（优先级从高到低）：
 * 1. 手动设置（works.cover_aspect，如 "1:1"/"2:3"/"3:4"）
 * 2. 有真图：图片自然宽高比（object-contain 完整显示）
 * 3. 标签推断：音乐 1:1、影视 2:3、默认 3:4
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
  aspect,
  loading = "lazy",
  frameAspect,
}: AdaptiveCoverProps) {
  const manual = typeof aspect === "string" ? parseManualRatio(aspect) : null;
  const inferred = inferCoverRatio(tags);
  const initial = manual ?? fallbackRatio ?? inferred;
  const frameRatio = frameAspect ? clampCoverRatio(frameAspect) : null;
  const [ratio, setRatio] = useState<number>(clampCoverRatio(initial));
  const [loaded, setLoaded] = useState(false);

  const handleLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      if (manual === null) {
        const img = e.currentTarget;
        if (img.naturalWidth > 0 && img.naturalHeight > 0) {
          setRatio(clampCoverRatio(img.naturalWidth / img.naturalHeight));
        }
      }
      setLoaded(true);
    },
    [manual]
  );

  return (
    <div
      className={`relative w-full overflow-hidden ${className}`}
      style={{ aspectRatio: `${frameRatio ?? ratio}` }}
    >
      <EntityCover
        src={src}
        alt={alt}
        title={title}
        originalTitle={originalTitle}
        id={id}
        loading={loading}
        imgClassName={
          loaded || frameRatio !== null ? "w-full h-full object-contain" : imgClassName ?? "w-full h-full object-cover"
        }
        onLoad={handleLoad}
      />
    </div>
  );
}

