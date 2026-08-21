"use client";

import { useEffect, useState } from "react";
import { Heart } from "lucide-react";
import { useAuth } from "@/lib/authContext";
import { useI18n } from "@/i18n/I18nProvider";
import { toggleFavorite, fetchFavoriteStatus, FavoriteTargetType } from "@/lib/api";

/** 详情页收藏按钮：登录后可收藏/取消，未登录跳转登录页 */
export default function FavoriteButton({
  targetType,
  targetId,
  size = "md",
}: {
  targetType: FavoriteTargetType;
  targetId: string;
  size?: "sm" | "md";
}) {
  const { user } = useAuth();
  const { t } = useI18n();
  const [favorited, setFavorited] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user || !targetId) return;
    let alive = true;
    fetchFavoriteStatus(targetType, [targetId]).then((set) => {
      if (alive) setFavorited(set.has(targetId));
    }).catch(() => {});
    return () => {
      alive = false;
    };
  }, [user?.id, targetType, targetId]);

  const handleToggle = async () => {
    if (!user) {
      window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname)}`;
      return;
    }
    if (busy) return;
    setBusy(true);
    const next = !favorited;
    setFavorited(next);
    try {
      const confirmed = await toggleFavorite(targetType, targetId);
      setFavorited(confirmed);
    } catch {
      setFavorited(!next);
    } finally {
      setBusy(false);
    }
  };

  // 与 EntityActionToolbar 按钮保持同一档高度与字号
  const h = size === "sm" ? "h-7 px-3 text-xs" : "h-8 px-3 text-sm";
  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={busy}
      title={favorited ? t("favorite.remove") : t("favorite.add")}
      className={`shrink-0 inline-flex items-center gap-1.5 rounded-md border font-medium transition-colors disabled:opacity-60 ${h} ${
        favorited
          ? "bg-rose-500/10 border-rose-500/30 text-rose-500 hover:bg-rose-500/15"
          : "bg-black/[0.03] dark:bg-white/[0.05] border-black/10 dark:border-white/10 text-gray-600 dark:text-gray-300 hover:text-rose-500 hover:border-rose-500/40"
      }`}
    >
      <Heart className={size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4"} strokeWidth={2} fill={favorited ? "currentColor" : "none"} />
      <span>{favorited ? t("favorite.favorited") : t("favorite.add")}</span>
    </button>
  );
}
