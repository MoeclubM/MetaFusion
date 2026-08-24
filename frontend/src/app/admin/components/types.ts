"use client";

import {
  LayoutDashboard,
  Users,
  Library,
  HardDrive,
  MessageSquare,
  Activity,
  ScrollText,
  Layers,
  Waypoints,
  Disc3,
  Music2,
  Inbox,
  Settings2,
  Puzzle,
} from "lucide-react";

export function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export type Tab =
  | "overview"
  | "reviews"
  | "works"
  | "expressions"
  | "releases"
  | "assets"
  | "artists"
  | "entity_types"
  | "external_databases"
  | "shelves"
  | "users"
  | "topics"
  | "boards"
  | "audit"
  | "plugins"
  | "health"
  | "settings";

export type SidebarGroup = {
  labelKey: string;
  items: { id: Tab; labelKey: string; icon: any; badgeKey?: string }[];
};

// Backward compat: provide sidebarGroups that AdminSidebar and AdminHeader resolve via t
export const sidebarGroups: SidebarGroup[] = [
  {
    labelKey: "admin.sidebar.groupReview",
    items: [
      { id: "overview", labelKey: "admin.sidebar.itemOverview", icon: LayoutDashboard },
      { id: "reviews", labelKey: "admin.sidebar.itemReviews", icon: Inbox, badgeKey: "admin.sidebar.badgePending" },
      { id: "works", labelKey: "admin.sidebar.itemWorks", icon: Library },
      { id: "releases", labelKey: "admin.sidebar.itemReleases", icon: Disc3 },
      { id: "expressions", labelKey: "admin.sidebar.itemExpressions", icon: Music2 },
      { id: "assets", labelKey: "admin.sidebar.itemAssets", icon: HardDrive },
    ],
  },
  {
    labelKey: "admin.sidebar.groupLibrary",
    items: [
      { id: "artists", labelKey: "admin.sidebar.itemAgents", icon: Users },
      { id: "entity_types", labelKey: "admin.sidebar.itemEntityTypes", icon: Settings2 },
      { id: "external_databases", labelKey: "admin.sidebar.itemExternalDatabases", icon: Waypoints },
      { id: "shelves", labelKey: "admin.sidebar.itemShelves", icon: Layers },
    ],
  },
  {
    labelKey: "admin.sidebar.groupCommunity",
    items: [
      { id: "topics", labelKey: "admin.sidebar.itemTopics", icon: MessageSquare },
      { id: "boards", labelKey: "admin.sidebar.itemBoards", icon: MessageSquare },
      { id: "users", labelKey: "admin.sidebar.itemUsers", icon: Users },
      { id: "audit", labelKey: "admin.sidebar.itemAudit", icon: ScrollText },
    ],
  },
  {
    labelKey: "admin.sidebar.groupSystem",
    items: [
      { id: "plugins", labelKey: "admin.sidebar.itemPlugins", icon: Puzzle, badgeKey: "admin.sidebar.badgePlugins" },
      { id: "health", labelKey: "admin.sidebar.itemHealth", icon: Activity },
      { id: "settings", labelKey: "admin.sidebar.itemSettings", icon: Settings2 },
    ],
  },
];

