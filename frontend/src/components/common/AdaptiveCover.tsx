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
  /** 调用方显式指定的固定比例（如 "1:1"），优先于推断与自然比例；服务端没有这个字段 */
  aspect?: string | null;
  loading?: "lazy" | "eager";
  /** 网格/卡片场景：统一容器比例（同排对齐优先），图片按 cover 填满该比例 */
  uniformAspect?: number;
  /** 单张展示的外框上限，避免极端比例的大图撑坏版式 */
  maxHeight?: number | string;
  minHeight?: number | string;
  /** 小缩略图：占位走精简版（见 ProceduralCover compact）。 */
  compact?: boolean;
}

/**
 * 详情页/单张展示用的封面容器：**比例范围内自适应**。
 *
 * 容器比例决策（优先级从高到低）：
 * 1. `uniformAspect`：网格场景的统一比例（同排对齐）
 * 2. 调用方显式指定（如 "2:3"；服务端不下发这个值）
 * 3. 有真图：图片自然宽高比，钳进 [MIN_COVER_ASPECT, MAX_COVER_ASPECT]
 * 4. 标签推断的建议比例（音乐 1:1、影视 2:3、书籍 3:4）
 *
 * 图片一律 `object-fit: cover` 填满容器：比例落在区间内时容器就取图片自身的比例
 * （等价于完整显示、不裁剪），只有比例超出区间才在边界上裁掉溢出部分。
 * 旧实现用 1:1 硬框 + contain，非方形封面被缩小后在两侧留下大片空白。
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
  aspect,
  loading = "lazy",
  uniformAspect,
  maxHeight,
  minHeight,
  compact = false,
}: AdaptiveCoverProps) {
  const manual = typeof aspect === "string" ? parseManualRatio(aspect) : null;
  const inferred = inferCoverRatio(tags);
  // 建议比例只作为首选比例：真图加载完成前用它占位，加载后由图片自身比例接管。
  const initial = manual ?? inferred;
  const uniform = uniformAspect ? clampCoverRatio(uniformAspect) : null;
  const [ratio, setRatio] = useState<number>(clampCoverRatio(initial));

  const handleLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      if (manual === null && uniform === null) {
        const img = e.currentTarget;
        if (img.naturalWidth > 0 && img.naturalHeight > 0) {
          setRatio(clampCoverRatio(img.naturalWidth / img.naturalHeight));
        }
      }
    },
    [manual, uniform]
  );

  return (
    <div
      className={`relative w-full overflow-hidden ${className}`}
      style={{ aspectRatio: `${uniform ?? ratio}`, maxHeight, minHeight }}
    >
      <EntityCover
        src={src}
        alt={alt}
        title={title}
        originalTitle={originalTitle}
        id={id}
        loading={loading}
        imgClassName={imgClassName ?? "w-full h-full object-cover"}
        onLoad={handleLoad}
        compact={compact}
      />
    </div>
  );
}
