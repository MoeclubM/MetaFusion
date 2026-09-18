"use client";

import React, { useState } from "react";

interface AdaptiveCardCoverProps {
  src?: string | null;
  alt: string;
  badge?: React.ReactNode;
  statusBadge?: React.ReactNode;
  fallbackIcon?: React.ReactNode;
  fallbackTitle?: string;
  fallbackSubtitle?: string;
  /** 统一容器比例对应的类名；调用方已定好外框时传 "w-full h-full" */
  aspectClassName?: string;
  className?: string;
  imgClassName?: string;
}

/**
 * 网格/卡片封面：**统一容器比例 + object-fit: cover**。
 *
 * 网格里每张卡各用图片自身比例会让同一排参差不齐，统一比例是唯一能既填满又不留白的做法；
 * 默认取 GRID_COVER_ASPECT（3:4，区间内最坏裁剪率最小的取值，理由见 lib/cover.ts）。
 * 图片填满容器，不再叠一层模糊底图去"弥合"留白——那层底图还会把同一张图请求两次。
 */
export function AdaptiveCardCover({
  src,
  alt,
  badge,
  statusBadge,
  fallbackIcon,
  fallbackTitle,
  fallbackSubtitle,
  aspectClassName = "aspect-[3/4]",
  className = "",
  imgClassName = "",
}: AdaptiveCardCoverProps) {
  const [hasError, setHasError] = useState(false);

  const hasValidImage = !!src && !hasError;

  return (
    <div
      className={`relative w-full ${aspectClassName} bg-black/[0.03] dark:bg-black/40 flex items-center justify-center overflow-hidden isolate ${className}`}
    >
      {hasValidImage ? (
        <img
          src={src!}
          alt={alt}
          loading="lazy"
          onError={() => setHasError(true)}
          className={`absolute inset-0 w-full h-full object-cover select-none transition-transform duration-300 group-hover:scale-[1.03] ${imgClassName}`}
        />
      ) : (
        /* 兜底占位层：无图或取图失败时不画破图图标 */
        <div className="w-full h-full relative overflow-hidden bg-linear-to-br from-primary/10 via-black/[0.02] to-primary/5 dark:from-primary/20 dark:via-surface dark:to-black/40 flex flex-col items-center justify-center p-3 text-center">
          {fallbackIcon && (
            <div className="w-10 h-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary mb-1.5 shadow-2xs group-hover:scale-110 transition-transform duration-base ease-soft">
              {fallbackIcon}
            </div>
          )}
          {fallbackTitle && (
            <span className="text-[11px] font-medium text-text-strong line-clamp-1 w-full px-1">
              {fallbackTitle}
            </span>
          )}
          {fallbackSubtitle && (
            <span className="text-[9px] font-mono text-text-faint uppercase tracking-wider mt-0.5">
              {fallbackSubtitle}
            </span>
          )}
        </div>
      )}

      {/* 左上角类别胶囊徽标 */}
      {badge && <div className="absolute top-2 left-2 z-20 pointer-events-none">{badge}</div>}

      {/* 右上角状态徽标（草稿/待审） */}
      {statusBadge && <div className="absolute top-2 right-2 z-20 pointer-events-none">{statusBadge}</div>}
    </div>
  );
}
