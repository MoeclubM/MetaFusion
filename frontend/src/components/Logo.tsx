"use client";

import React from "react";

type BrandMarkProps = {
  size?: number;
  className?: string;
  withGlow?: boolean;
  idSuffix?: string;
};

export function BrandMark({ size = 28, className, withGlow = false, idSuffix = "a" }: BrandMarkProps) {
  return (
    <span
      className={`inline-grid place-items-center shrink-0 text-slate-900 dark:text-white ${className ?? ""}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ display: "block" }}
      >
        <defs>
          <filter id={`mf-glow-${idSuffix}`} x="-50%" y="-50%" width="200%" height="200%" colorInterpolationFilters="sRGB">
            <feGaussianBlur in="SourceGraphic" stdDeviation="2.2" result="blur" />
            <feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 1 0 0 0  0 0 0 0.9 0" />
          </filter>
          <linearGradient id={`mf-frame-${idSuffix}`} x1="2" y1="2" x2="30" y2="30" gradientUnits="userSpaceOnUse">
            <stop stopColor="currentColor" stopOpacity="0.16" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0.04" />
          </linearGradient>
        </defs>

        <path
          d="M9 2H23L30 9V23L23 30H9L2 23V9L9 2Z"
          fill="none"
          stroke={`url(#mf-frame-${idSuffix})`}
          strokeWidth="1.05"
        />
        <path
          d="M10.2 3.6H21.8L28.4 10.2V21.8L21.8 28.4H10.2L3.6 21.8V10.2L10.2 3.6Z"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.06"
          strokeWidth="0.65"
        />

        <path d="M7.2 7.6V4.6H10.2" stroke="currentColor" strokeOpacity="0.18" strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M21.8 4.6H24.8V7.6" stroke="currentColor" strokeOpacity="0.18" strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M24.8 24.4V27.4H21.8" stroke="currentColor" strokeOpacity="0.18" strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M10.2 27.4H7.2V24.4" stroke="currentColor" strokeOpacity="0.18" strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round" />

        <ellipse cx="16" cy="16" rx="10.4" ry="6.15" fill="none" stroke="currentColor" strokeOpacity="0.10" strokeWidth="0.65" strokeDasharray="1.15 1.7" strokeLinecap="round" />
        <ellipse cx="16" cy="16" rx="10.4" ry="6.15" fill="none" stroke="currentColor" strokeOpacity="0.04" strokeWidth="1.6" />

        <path
          d="M10.85 21.55L13.28 9.85L16 16.35L18.72 9.85L21.15 21.55"
          stroke="currentColor"
          strokeWidth="1.85"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M12.95 17.55L14.05 12.55"
          stroke="currentColor"
          strokeOpacity="0.38"
          strokeWidth="0.75"
          strokeLinecap="round"
        />
        <path
          d="M19.05 17.55L17.95 12.55"
          stroke="currentColor"
          strokeOpacity="0.38"
          strokeWidth="0.75"
          strokeLinecap="round"
        />

        <g opacity={withGlow ? 1 : 0.98}>
          {withGlow && (
            <line
              x1="11.2"
              y1="15.42"
              x2="20.8"
              y2="15.42"
              stroke="var(--primary-color, #3b82f6)"
              strokeWidth="3.2"
              strokeLinecap="round"
              opacity="0.18"
              style={{ filter: `url(#mf-glow-${idSuffix})` }}
            />
          )}
          <line
            x1="11.2"
            y1="15.42"
            x2="20.8"
            y2="15.42"
            stroke="var(--primary-color, #3b82f6)"
            strokeWidth="1.05"
            strokeLinecap="round"
          />
          <circle cx="11.2" cy="15.42" r="0.95" fill="var(--primary-color, #3b82f6)" opacity="0.95" />
          <circle cx="20.8" cy="15.42" r="0.95" fill="var(--primary-color, #3b82f6)" opacity="0.95" />
        </g>

        <g>
          {withGlow && (
            <rect
              x="14.55"
              y="13.97"
              width="2.9"
              height="2.9"
              transform="rotate(45 16 15.42)"
              fill="var(--primary-color, #3b82f6)"
              opacity="0.55"
              style={{ filter: `url(#mf-glow-${idSuffix})` }}
            />
          )}
          <rect
            x="14.78"
            y="14.2"
            width="2.44"
            height="2.44"
            transform="rotate(45 16 15.42)"
            fill="var(--primary-color, #3b82f6)"
            stroke="white"
            strokeOpacity="0.88"
            strokeWidth="0.45"
          />
          <rect
            x="15.42"
            y="14.84"
            width="1.16"
            height="1.16"
            transform="rotate(45 16 15.42)"
            fill="white"
            opacity="0.96"
          />
        </g>

        <g opacity="0.32">
          <rect x="10.1" y="23.2" width="1.15" height="1.15" rx="0.2" fill="currentColor" fillOpacity="0.45" />
          <rect x="15.02" y="23.2" width="1.96" height="1.15" rx="0.2" fill="currentColor" fillOpacity="0.20" />
          <rect x="20.75" y="23.2" width="1.15" height="1.15" rx="0.2" fill="var(--primary-color, #3b82f6)" />
        </g>
      </svg>
    </span>
  );
}
