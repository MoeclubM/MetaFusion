"use client";

import React, { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/authContext";
import { fetchSetupStatus } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";

const PROTECTED_PREFIXES = [
  "/admin",
  "/settings",
  "/invites",
  "/contribute",
  "/works/new",
  "/releases/new",
  "/artists/new",
  "/franchises/new",
];

function isProtectedPath(pathname: string | null): boolean {
  if (!pathname || pathname === "/") return false;
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

let cachedSetupStatus: { is_initialized: boolean } | null = null;

export const AuthGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth();
  const { t } = useI18n();
  const pathname = usePathname();
  const router = useRouter();

  const [setupChecked, setSetupChecked] = useState(cachedSetupStatus !== null);
  const isProtected = isProtectedPath(pathname);

  useEffect(() => {
    // 首次检测系统是否完成 OOBE 初始化
    if (cachedSetupStatus && cachedSetupStatus.is_initialized) {
      if (pathname === "/setup") {
        router.replace("/");
      }
      return;
    }

    fetchSetupStatus()
      .then((status) => {
        cachedSetupStatus = status;
        if (!status.is_initialized) {
          // 系统未初始化且当前不在 /setup，则强制跳转 /setup
          if (pathname !== "/setup") {
            router.replace("/setup");
          }
        } else {
          // 系统已完成初始化且当前访问 /setup，则重定向回首页
          if (pathname === "/setup") {
            router.replace("/");
          }
        }
      })
      .catch(() => {
        // 网络或后端异常时默认放行
      })
      .finally(() => {
        setSetupChecked(true);
      });
  }, [pathname, router]);

  useEffect(() => {
    if (!loading && !user && isProtected && pathname !== "/setup") {
      const redirectUrl = pathname ? `/login?redirect=${encodeURIComponent(pathname)}` : "/login";
      router.replace(redirectUrl);
    }
  }, [loading, user, isProtected, pathname, router]);

  // 仅在受保护路由且正在重定向未登录用户时显示阻断全屏加载，普通公开页面（如首页）直接平滑渲染
  if (isProtected && (loading || !setupChecked)) {
    return (
      <div className="min-h-screen bg-background grid place-items-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
          <span className="font-mono text-xs text-gray-500 tracking-wider">{t("auth.initializing")}</span>
        </div>
      </div>
    );
  }

  // Block protected routes while redirecting
  if (!user && isProtected && pathname !== "/setup") {
    return null;
  }

  return <>{children}</>;
};

