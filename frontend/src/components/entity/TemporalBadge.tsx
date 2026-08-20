"use client";

import React from "react";
import { Clock } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

interface Props {
  beginDate?: string;
  endDate?: string;
  ended?: boolean;
  isCurrent?: boolean;
  dateSpan?: string;
  variant?: "pill" | "subtle" | "badge";
  activeLabel?: string;
  endedLabel?: string;
  showIcon?: boolean;
  className?: string;
}

export function TemporalBadge({
  beginDate,
  endDate,
  ended,
  isCurrent,
  dateSpan,
  variant = "pill",
  activeLabel,
  endedLabel,
  showIcon = false,
  className = "",
}: Props) {
  const { t } = useI18n();

  if (!beginDate && !endDate && !ended && !dateSpan) {
    return null;
  }

  const defaultEndedText = endedLabel || t("entity.temporal.ended");
  const defaultActiveText = activeLabel || t("entity.temporal.present");

  // Format date interval text
  let spanText = dateSpan;
  if (!spanText) {
    if (beginDate && endDate) {
      spanText = `${beginDate} ~ ${endDate}`;
    } else if (beginDate && !endDate) {
      spanText = `${beginDate} ~ ${ended ? defaultEndedText : defaultActiveText}`;
    } else if (!beginDate && endDate) {
      spanText = `~ ${endDate}`;
    } else if (ended) {
      spanText = defaultEndedText;
    }
  }

  const isHistorical = ended || isCurrent === false;

  if (variant === "subtle") {
    return (
      <span className={`inline-flex items-center gap-1 font-mono text-[11px] text-gray-400 ${className}`}>
        {showIcon && <Clock className="w-3 h-3 text-gray-500" />}
        <span>{spanText}</span>
        {isHistorical && <span className="text-gray-500 text-[10px]">{t("entity.temporal.historicalTag")}</span>}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-sm font-mono text-[10px] tracking-wide border transition-colors ${
        isHistorical
          ? "bg-black/[0.03] dark:bg-white/[0.04] border-black/10 dark:border-white/10 text-gray-500 dark:text-gray-400"
          : "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-300"
      } ${className}`}
    >
      {showIcon && <Clock className="w-3 h-3 text-current opacity-70" />}
      <span>{spanText}</span>
    </span>
  );
}
