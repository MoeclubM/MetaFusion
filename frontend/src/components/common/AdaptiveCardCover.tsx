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
  aspectClassName?: string;
  className?: string;
  imgClassName?: string;
}

/**
 * AdaptiveCardCover
 * 保持卡片外框固定规整尺寸（避免网格错位），
 * 内部图像区域自动完整适配任何自然比例（1:1 正方专辑、2:3 竖版海报、3:4 书籍封面、16:9 宽幅），
 * 不暴力裁剪原画，四周辅以原图色彩的柔和高斯模糊光晕进行氛围弥合。
 */
export function AdaptiveCardCover({
  src,
  alt,
  badge,
  statusBadge,
  fallbackIcon,
  fallbackTitle,
  fallbackSubtitle,
  aspectClassName = "aspect-square",
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
        <>
          {/* 1. 环境光晕背景层：以原图色彩做柔和模糊拉伸，填补非 1:1 图片四周空隙，消除突兀生硬的死黑/死白边 */}
          <img
            src={src!}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 w-full h-full object-cover blur-xl scale-125 opacity-35 dark:opacity-30 pointer-events-none select-none transition-transform duration-500 group-hover:scale-135"
          />

          {/* 2. 主体图像层：自适应完整展示自然宽高比（object-contain），绝对不裁头、不截肢、不压缩 */}
          <img
            src={src!}
            alt={alt}
            loading="lazy"
            onError={() => setHasError(true)}
            className={`relative z-10 max-w-full max-h-full w-auto h-auto object-contain drop-shadow-sm group-hover:scale-[1.03] transition-transform duration-300 select-none ${imgClassName}`}
          />
        </>
      ) : (
        /* 3. 兜底占位层 */
        <div className="w-full h-full relative overflow-hidden bg-linear-to-br from-primary/10 via-black/[0.02] to-primary/5 dark:from-primary/20 dark:via-surface dark:to-black/40 flex flex-col items-center justify-center p-3 text-center">
          {fallbackIcon && (
            <div className="w-10 h-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary mb-1.5 shadow-2xs group-hover:scale-110 transition-transform">
              {fallbackIcon}
            </div>
          )}
          {fallbackTitle && (
            <span className="text-[11px] font-medium text-gray-800 dark:text-gray-200 line-clamp-1 w-full px-1">
              {fallbackTitle}
            </span>
          )}
          {fallbackSubtitle && (
            <span className="text-[9px] font-mono text-gray-500 uppercase tracking-wider mt-0.5">
              {fallbackSubtitle}
            </span>
          )}
        </div>
      )}

      {/* 4. 左上角类别胶囊徽标 */}
      {badge && <div className="absolute top-2 left-2 z-20 pointer-events-none">{badge}</div>}

      {/* 5. 右上角状态徽标（草稿/待审） */}
      {statusBadge && <div className="absolute top-2 right-2 z-20 pointer-events-none">{statusBadge}</div>}
    </div>
  );
}