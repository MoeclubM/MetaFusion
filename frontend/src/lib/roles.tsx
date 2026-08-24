"use client";

import { Shield, Sparkles, User, Ban } from "lucide-react";
import React from "react";

export type UserRole = "admin" | "archivist" | "member" | "banned" | string;

export interface RoleInfo {
  role: string;
  label: string;
  badgeClass: string;
  textClass: string;
  bgClass: string;
  borderClass: string;
  icon: React.ComponentType<{ className?: string }>;
}

export function getUserRoleInfo(role?: string | null, t?: (key: string) => string): RoleInfo {
  const r = (role || "member").toLowerCase();
  const translate = t || ((k: string) => k);

  switch (r) {
    case "admin":
      return {
        role: "admin",
        label: translate("roles.admin"),
        badgeClass: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
        textClass: "text-amber-600 dark:text-amber-400",
        bgClass: "bg-amber-500/10",
        borderClass: "border-amber-500/30",
        icon: Shield,
      };
    case "archivist":
      return {
        role: "archivist",
        label: translate("roles.archivist"),
        badgeClass: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
        textClass: "text-emerald-600 dark:text-emerald-400",
        bgClass: "bg-emerald-500/10",
        borderClass: "border-emerald-500/30",
        icon: Sparkles,
      };
    case "banned":
      return {
        role: "banned",
        label: translate("roles.banned"),
        badgeClass: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30",
        textClass: "text-rose-600 dark:text-rose-400",
        bgClass: "bg-rose-500/10",
        borderClass: "border-rose-500/30",
        icon: Ban,
      };
    case "member":
    default:
      return {
        role: r,
        label: translate("roles.member"),
        badgeClass: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/30",
        textClass: "text-sky-600 dark:text-sky-400",
        bgClass: "bg-sky-500/10",
        borderClass: "border-sky-500/30",
        icon: User,
      };
  }
}

export function UserRoleBadge({
  role,
  t,
  showIcon = false,
  className = "",
}: {
  role?: string | null;
  t?: (key: string) => string;
  showIcon?: boolean;
  className?: string;
}) {
  const info = getUserRoleInfo(role, t);
  const Icon = info.icon;

  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border font-mono text-[10px] font-medium leading-none ${info.badgeClass} ${className}`}
    >
      {showIcon && <Icon className="w-2.5 h-2.5 shrink-0" />}
      <span>{info.label}</span>
    </span>
  );
}
