"use client";

import React, { useMemo } from "react";
import { isDistinctOriginalTitle } from "@/lib/titles";

interface ProceduralCoverProps {
  title?: string;
  originalTitle?: string;
  id?: string;
  className?: string;
}

function djb2Hash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return Math.abs(hash >>> 0);
}

function hsl(h: number, s: number, l: number): string {
  return `hsl(${h} ${s}% ${l}%)`;
}

function paletteFromHash(hash: number) {
  const hue = hash % 360;
  const hue2 = (hue + 16 + ((hash >>> 8) % 28)) % 360;
  const sat = 34 + (hash % 16);
  return {
    bg1: hsl(hue, sat, 7),
    bg2: hsl(hue2, sat + 6, 13),
    accent: hsl(hue, 68 + ((hash >>> 4) % 18), 52 + ((hash >>> 12) % 8)),
  };
}

export function ProceduralCover({ title = "Untitled", originalTitle, id = "", className = "" }: ProceduralCoverProps) {
  const hash = useMemo(() => djb2Hash(`${title}_${id}`), [title, id]);
  const p = useMemo(() => paletteFromHash(hash), [hash]);

  const refCode = useMemo(() => {
    return `REF: MF-${hash.toString(16).toUpperCase().padStart(6, "0").slice(0, 6)}`;
  }, [hash]);

  const patternIndex = hash % 4;

  return (
    <div className={`w-full h-full relative overflow-hidden select-none ${className}`} style={{ background: `linear-gradient(135deg, ${p.bg1} 0%, ${p.bg2} 100%)` }}>
      {/* Dynamic Ambient Glow */}
      <div
        className="absolute w-[140%] h-[140%] -top-[20%] -left-[20%] rounded-full pointer-events-none opacity-25 blur-2xl"
        style={{ background: `radial-gradient(circle, ${p.accent} 0%, transparent 70%)` }}
      />

      {/* Retro-futuristic Grid */}
      <svg className="absolute inset-0 w-full h-full opacity-10 pointer-events-none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id={`grid-${hash}`} width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#ffffff" strokeWidth="0.75" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#grid-${hash})`} />
      </svg>

      {/* Border Frame */}
      <div className="absolute inset-2 sm:inset-2.5 rounded-sm border border-white/10 pointer-events-none" />
      <div className="absolute inset-3 sm:inset-3.5 rounded-sm border border-white/[0.04] pointer-events-none" />

      {/* Content Container */}
      <div className="relative z-10 w-full h-full p-4 sm:p-5 flex flex-col justify-between text-left">
        {/* Top Header */}
        <div className="flex items-center justify-between font-mono text-[9px] sm:text-[10px] tracking-wider">
          <span className="flex items-center gap-1.5 font-bold" style={{ color: p.accent }}>
            <span className="w-1.5 h-1.5 rounded-xs inline-block" style={{ backgroundColor: p.accent }} />
            METAFUSION
          </span>
          <span className="text-white/40">{refCode}</span>
        </div>

        {/* Central Geometric Totem */}
        <div className="my-auto py-2 flex items-center justify-center">
          <svg className="w-20 h-20 sm:w-24 sm:h-24 opacity-80" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="50" cy="50" r="44" stroke="rgba(255,255,255,0.08)" strokeWidth="1" strokeDasharray="3 3" />
            <circle cx="50" cy="50" r="34" stroke={p.accent} strokeOpacity="0.4" strokeWidth="1.5" />
            <circle cx="50" cy="50" r="24" fill="rgba(0,0,0,0.3)" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />

            {patternIndex === 0 && (
              <>
                <line x1="28" y1="50" x2="72" y2="50" stroke={p.accent} strokeWidth="1.5" strokeLinecap="round" />
                <line x1="50" y1="28" x2="50" y2="72" stroke={p.accent} strokeWidth="1.5" strokeLinecap="round" />
                <circle cx="50" cy="50" r="6" fill={p.accent} />
              </>
            )}
            {patternIndex === 1 && (
              <>
                <polygon points="50,30 67,65 33,65" stroke={p.accent} strokeWidth="1.5" fill="none" />
                <circle cx="50" cy="53" r="4" fill={p.accent} />
              </>
            )}
            {patternIndex === 2 && (
              <>
                <circle cx="42" cy="46" r="6" stroke={p.accent} strokeWidth="1.5" />
                <circle cx="58" cy="54" r="8" stroke={p.accent} strokeWidth="1.5" />
                <path d="M 36 50 Q 50 35 64 50" stroke={p.accent} strokeWidth="1" />
              </>
            )}
            {patternIndex === 3 && (
              <>
                <rect x="38" y="38" width="24" height="24" stroke={p.accent} strokeWidth="1.5" fill="none" transform="rotate(45 50 50)" />
                <circle cx="50" cy="50" r="4" fill={p.accent} />
              </>
            )}
          </svg>
        </div>

        {/* Bottom Title & Credits */}
        <div className="space-y-1.5">
          <div className="h-0.5 w-8 rounded-full" style={{ backgroundColor: p.accent }} />
          <div>
            <h4 className="font-serif font-bold text-white leading-tight line-clamp-2 text-sm sm:text-base tracking-tight drop-shadow-sm">
              {title}
            </h4>
            {isDistinctOriginalTitle(originalTitle, title) && (
              <p className="font-mono text-[10px] text-white/50 truncate mt-0.5">
                {originalTitle}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
