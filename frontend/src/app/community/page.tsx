"use client";

import React, { useEffect, useState, useRef, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { UserAvatar } from "@/components/UserAvatar";
import { fetchApi, DiscussionTopic, Tag, ForumBoard, fetchBoards, FORUM_BOARDS, boardDisplayName } from "@/lib/api";
import PostComposer from "@/components/community/PostComposer";
import { useI18n } from "@/i18n/I18nProvider";
import { useAuth } from "@/lib/authContext";
import {
 MessageSquare,
 Plus,
 Eye,
 User,
 X,
 Layers,
 Search,
 BookOpen,
 Flame,
 Sparkles,
 Menu,
 Hash,
 Archive,
  ChevronRight,
  ChevronDown,
  Tag as TagIcon,
  Megaphone,
  Bug,
  MessageCircle,
  Cpu,
  Coffee,
  Bookmark,
  Film,
  Music2,
} from "lucide-react";

function formatTimeAgo(dateStr: string, locale?: string, t?: (k: string, v?: Record<string,string|number>)=>string) {
 const diff = Date.now() - new Date(dateStr).getTime();
 const mins = Math.floor(diff / (1000 * 60));
 const tr = t || ((k:string)=>k);
 if (mins < 1) return tr("time.justNow");
 if (mins < 60) return tr("time.minAgo", { n: mins });
 const hours = Math.floor(mins / 60);
 if (hours < 24) return tr("time.hourAgo", { n: hours });
 const days = Math.floor(hours / 24);
 if (days < 30) return tr("time.dayAgo", { n: days });
 try { return new Date(dateStr).toLocaleDateString(locale || "zh-CN"); } catch { return new Date(dateStr).toLocaleDateString(); }
}

const BOARD_ICON_MAP: Record<string, React.ElementType> = {
 Layers, BookOpen, Cpu, Archive, Coffee, Hash, Tag: TagIcon, Sparkles, Flame, Bookmark, MessageSquare, Globe: Archive,
 Megaphone, Bug, MessageCircle, Film, Music2,
};
const BOARD_ICON: Record<string, React.ElementType> = {
  all: Layers,
  announcement: Megaphone,
  casual: Coffee,
  qa: Hash,
  reviews: BookOpen,
  bug_report: Bug,
  comment: MessageCircle,
};
function resolveBoardIcon(board: ForumBoard): React.ElementType {
 if (board.icon && BOARD_ICON_MAP[board.icon]) return BOARD_ICON_MAP[board.icon];
 return BOARD_ICON[board.code] || Hash;
}

function CommunityContent() {
 const { user } = useAuth();
 const { t, locale } = useI18n();
 const searchParams = useSearchParams();
 const initialTag = searchParams.get("tag");
 const initialTagId = searchParams.get("tag_id");
 const [selectedBoard, setSelectedBoard] = useState<string>("all");
 const [activeTab, setActiveTab] = useState<"latest" | "top">("latest");
 const [topics, setTopics] = useState<DiscussionTopic[]>([]);
 const [loading, setLoading] = useState(true);
 const [searchFilter, setSearchFilter] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [boardDropdownOpen, setBoardDropdownOpen] = useState(false);
  const [boardQuery, setBoardQuery] = useState("");
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false);
  const [tagQuery, setTagQuery] = useState("");
  const boardDropdownRef = useRef<HTMLDivElement>(null);
  const boardSearchInputRef = useRef<HTMLInputElement>(null);
  const tagDropdownRef = useRef<HTMLDivElement>(null);
  const tagSearchInputRef = useRef<HTMLInputElement>(null);

 // tag filter for list
 const [availableTags, setAvailableTags] = useState<Tag[]>([]);
 const [filterTagId, setFilterTagId] = useState<number | null>(initialTagId ? Number(initialTagId) : null);
 const [filterTagName, setFilterTagName] = useState<string | null>(initialTag);

 // Composer drawer — only open/expanded kept, inner state lives in PostComposer
 const [isComposerOpen, setIsComposerOpen] = useState(false);
 const [composerExpanded, setComposerExpanded] = useState(false);

 const [boards, setBoards] = useState<ForumBoard[]>(FORUM_BOARDS);
 const [filterLanguage, setFilterLanguage] = useState<string>("all");

 useEffect(() => {
 fetchBoards().then(setBoards).catch(() => {});
 }, []);

 const fetchTags = async (q?: string) => {
 try {
 const qs = q ? `?q=${encodeURIComponent(q)}` : "";
 const data = await fetchApi<Tag[]>(`/community/topic-tags${qs}`);
 setAvailableTags(data || []);
 } catch {
 // keep previous
 }
 };

 useEffect(() => {
 fetchTags();
 }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (tagDropdownRef.current && !tagDropdownRef.current.contains(e.target as Node)) {
        setTagDropdownOpen(false);
      }
      if (boardDropdownRef.current && !boardDropdownRef.current.contains(e.target as Node)) {
        setBoardDropdownOpen(false);
      }
    };
    if (tagDropdownOpen || boardDropdownOpen) {
      document.addEventListener("mousedown", handler);
      if (tagDropdownOpen) {
        setTimeout(() => tagSearchInputRef.current?.focus(), 50);
      }
      if (boardDropdownOpen) {
        setTimeout(() => boardSearchInputRef.current?.focus(), 50);
      }
    }
    return () => document.removeEventListener("mousedown", handler);
  }, [tagDropdownOpen, boardDropdownOpen]);

  const filteredBoards = boards.filter((b) => {
    if (!boardQuery.trim()) return true;
    const q = boardQuery.trim().toLowerCase();
    return (
      b.name.toLowerCase().includes(q) ||
      (b.name_en && b.name_en.toLowerCase().includes(q)) ||
      (b.desc && b.desc.toLowerCase().includes(q)) ||
      b.code.toLowerCase().includes(q)
    );
  });

  const filteredTags = availableTags.filter((t) => {
    if (!tagQuery.trim()) return true;
    return t.name.toLowerCase().includes(tagQuery.trim().toLowerCase());
  });

 const currentSelectedTagObj = filterTagId
   ? availableTags.find((t) => t.id === filterTagId)
   : filterTagName
   ? availableTags.find((t) => t.name === filterTagName) || { id: -1, name: filterTagName, group_type: "topic" }
   : null;

 const loadTopics = async () => {
 setLoading(true);
 try {
 const params = new URLSearchParams();
 if (selectedBoard && selectedBoard !== "all") {
 params.append("board_code", selectedBoard);
 }
 if (filterLanguage && filterLanguage !== "all") {
 params.append("language", filterLanguage);
 }
 if (searchFilter.trim()) {
 params.append("q", searchFilter.trim());
 }
 if (filterTagId) {
 params.append("tag_id", String(filterTagId));
 } else if (filterTagName) {
 params.append("tag", filterTagName);
 }
 const res = await fetchApi<{ items: DiscussionTopic[]; total: number }>(
 `/community/topics?${params.toString()}`
 );
 let list = res.items || [];
 if (activeTab === "top") {
 list = [...list].sort((a, b) => b.reply_count + b.view_count - (a.reply_count + a.view_count));
 }
 setTopics(list);
 } catch {
 setTopics([]);
 } finally {
 setLoading(false);
 }
 };

 useEffect(() => {
 loadTopics();
 }, [selectedBoard, activeTab, filterTagId, filterTagName, filterLanguage]);

 const getBoard = (code: string) => {
 return boards.find((b) => b.code === code) || boards[0] || FORUM_BOARDS[0];
 };

 const currentBoard = getBoard(selectedBoard);

 return (
 <div className="min-h-screen bg-background relative flex flex-col overflow-x-hidden selection:bg-primary selection:text-white text-sm">
 <div className="absolute inset-0 bg-radial-vignette opacity-70 pointer-events-none" aria-hidden />
 <div className="absolute -top-40 -left-40 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[140px] pointer-events-none" aria-hidden />
 <div className="absolute -bottom-40 -right-40 w-[600px] h-[600px] bg-sky-500/10 rounded-full blur-[140px] pointer-events-none" aria-hidden />
 <Navbar />

 {/* Forum layout: sidebar + topic stream */}
 <div className="relative z-10 flex-1 w-full max-w-[1440px] mx-auto flex items-stretch">
 {/* ===================== Left board sidebar ===================== */}
 {/* Desktop */}
 <aside className="hidden lg:flex w-[280px] shrink-0 flex-col border-r border-surfaceBorder bg-background sticky top-12 h-[calc(100vh-3rem)] overflow-hidden">
 <div className="flex-1 overflow-y-auto">
 <div className="p-4 space-y-5">
 {/* CTA */}
 {user ? (
 <button
 onClick={() => setIsComposerOpen(true)}
 className="w-full py-2 rounded-lg bg-white hover:bg-gray-100 text-black text-sm font-bold flex items-center justify-center gap-2 transition-colors shadow-sm"
 >
 <Plus className="w-4 h-4 stroke-[2.5]" />
 <span>{t("community.publishNew")}</span>
 </button>
 ) : (
 <div className="rounded-lg border border-dashed border-surfaceBorder bg-surface/60 p-4 text-center">
 <p className="text-sm text-gray-500 leading-relaxed">{t("community.loginToCreate")}</p>
 </div>
 )}

 {/* Board list — single source: language / Latest-Top / search live in top bar */}
 <div className="space-y-1">
 <h3 className="px-2.5 text-xs font-mono font-bold tracking-widest text-gray-500 uppercase flex items-center justify-between">
 <span>{t("community.boards")}</span>
 <span className="font-normal normal-case tracking-normal text-xs text-gray-600">{t("community.boardCount", {count: boards.length - 1})}</span>
 </h3>
 <div className="space-y-0.5">
 {boards.map((board) => {
 const Icon = resolveBoardIcon(board);
 const isActive = selectedBoard === board.code;
 const isCommentOnly = board.show_in_feed === false && board.code !== "all";
 let badge: string | null = null;
 if (selectedBoard === "all") {
 if (board.code === "all") badge = String(topics.length);
 else if (!isCommentOnly) {
 const c = topics.filter((t) => t.board_code === board.code).length;
 if (c > 0) badge = String(c);
 }
 } else if (isActive) {
 badge = String(topics.length);
 }
 return (
 <button
 key={board.code}
 onClick={() => {
 setSelectedBoard(board.code);
 }}
 className={`w-full group flex items-center gap-2.5 px-3.5 py-2.5 rounded-md border text-left transition-colors ${
 isActive
 ? "bg-surface border-surfaceBorder text-white shadow-sm"
 : "border-transparent text-gray-400 hover:text-white hover:bg-surface/70 hover:border-surfaceBorder/60"
 }`}
 >
 <span className={`w-8 h-8 rounded-md flex items-center justify-center border shrink-0 ${board.bgColor} ${board.borderColor}`}>
 <Icon className={`w-4 h-4 ${board.color}`} />
 </span>
	 <span className="flex-1 min-w-0">
	 <span className={`block text-sm font-semibold leading-none truncate ${isActive ? "text-white" : "text-gray-300 group-hover:text-white"}`}>
	 {boardDisplayName(board, locale)}
	 </span>
	 <span className="block text-xs text-gray-500 truncate leading-tight mt-0.5">{board.desc}</span>
	 </span>
	 {badge && (
	 <span className={`shrink-0 px-2.5 py-1 rounded text-xs font-mono leading-none border ${isActive ? "bg-background border-surfaceBorder text-gray-300" : "bg-surface border-surfaceBorder text-gray-500"}`}>
	 {badge}
	 </span>
	 )}
	 {isActive && <ChevronRight className="w-4 h-4 text-gray-500 shrink-0" />}
	 </button>
	 );
	 })}
	 </div>
	 </div>

	 </div>
	 </div>
	 <div className="p-4 border-t border-surfaceBorder text-xs font-mono text-gray-600 flex items-center justify-between">
	 <span>MetaFusion Forum</span>
	 <span className="flex items-center gap-2">
	 <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
	 {t("community.online")}
	 </span>
	 </div>
	 </aside>

 {/* Mobile drawer */}
 {sidebarOpen && (
 <div className="lg:hidden fixed inset-0 z-40 flex">
 <div className="flex-1 bg-black/60 backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
 <div className="w-[300px] max-w-[85vw] bg-background border-r border-surfaceBorder flex flex-col overflow-hidden">
 <div className="h-12 flex items-center justify-between px-4 border-b border-surfaceBorder shrink-0">
 <span className="text-sm font-bold text-white flex items-center gap-2">
 <Layers className="w-4 h-4 text-gray-500" />
 {t("community.boardNav")}
 </span>
 <button onClick={() => setSidebarOpen(false)} className="p-1.5 text-gray-400 hover:text-white rounded-md hover:bg-surface">
 <X className="w-4 h-4" />
 </button>
 </div>
 <div className="flex-1 overflow-y-auto p-4 space-y-4">
 {user ? (
 <button
 onClick={() => {
 setSidebarOpen(false);
 setIsComposerOpen(true);
 }}
 className="w-full py-1.5 rounded-md bg-primary text-white text-sm font-bold flex items-center justify-center gap-2"
 >
 <Plus className="w-4 h-4" />
 <span>{t("community.publishNew")}</span>
 </button>
 ) : null}
	 <div className="space-y-1">
	 {boards.map((board) => {
	 const Icon = resolveBoardIcon(board);
	 const isActive = selectedBoard === board.code;
	 return (
	 <button
	 key={board.code}
	 onClick={() => {
	 setSelectedBoard(board.code);
	 setSidebarOpen(false);
	 }}
	 className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-md border text-left ${isActive ? "bg-surface border-surfaceBorder text-white" : "border-transparent text-gray-400"}`}
	 >
	 <span className={`w-8 h-8 rounded-md flex items-center justify-center border ${board.bgColor} ${board.borderColor}`}>
	 <Icon className={`w-4 h-4 ${board.color}`} />
	 </span>
	 <span className="flex-1 min-w-0">
	 <span className="block text-sm font-semibold truncate">{boardDisplayName(board, locale)}</span>
	 <span className="block text-xs text-gray-500 truncate">{board.desc}</span>
	 </span>
	 </button>
	 );
	 })}
	 </div>
	 </div>
	 </div>
	 </div>
	 )}

	{/* ===================== Main Topic List ===================== */}
	<main className="flex-1 min-w-0 flex flex-col pb-28 bg-background">
	  {/* Discourse-style Hero Search & Filter Header */}
	  <div className="sticky top-12 z-20 bg-background/95 backdrop-blur border-b border-surfaceBorder">
	    <div className="px-4 sm:px-6 py-4 space-y-3.5 max-w-[1100px] mx-auto w-full">
	      {/* Row 1: Discourse-style Prominent Centered Search Bar */}
	      <div className="flex items-center gap-2.5">
	        <button
	          onClick={() => setSidebarOpen(true)}
	          className="lg:hidden p-2 rounded-md border border-surfaceBorder bg-surface text-gray-400 hover:text-white"
	        >
	          <Menu className="w-4 h-4" />
	        </button>

	        <div className="relative flex-1">
	          <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
	          <input
	            type="text"
	            placeholder={t("community.boardSearchPlaceholder")}
	            value={searchFilter}
	            onChange={(e) => setSearchFilter(e.target.value)}
	            onKeyDown={(e) => e.key === "Enter" && loadTopics()}
	            className="w-full pl-10 pr-24 h-11 rounded-lg bg-surface border border-surfaceBorder text-white text-sm placeholder-gray-500 focus:outline-none focus:border-gray-500 transition-colors shadow-inner"
	          />
	          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
	            {searchFilter && (
	              <button
	                onClick={() => {
	                  setSearchFilter("");
	                }}
	                className="p-1 text-gray-500 hover:text-gray-300 transition-colors rounded"
	                title={t("community.clear")}
	              >
	                <X className="w-3.5 h-3.5" />
	              </button>
	            )}
	            <button
	              onClick={loadTopics}
	              className="px-3 py-1 rounded bg-white/[0.08] hover:bg-white/[0.15] border border-white/10 text-xs font-mono text-gray-200 transition-colors"
	            >
	              {t("common.search")}
	            </button>
	          </div>
	        </div>

	        {user && (
	          <button
	            onClick={() => setIsComposerOpen(true)}
	            className="px-4 h-11 rounded-lg bg-primary text-white text-sm font-bold inline-flex items-center gap-2 shadow-xs hover:opacity-90 transition-opacity shrink-0"
	          >
	            <Plus className="w-4 h-4 stroke-[2.5]" />
	            <span className="hidden sm:inline">{t("community.newTopic")}</span>
	          </button>
	        )}
	      </div>

	      {/* Row 2: Discourse Sub-Filter Controls (类别 > | 标签 > | 最新 | 热门 | 语言) */}
	      <div className="flex flex-wrap items-center justify-between gap-2.5 pt-0.5">
	        <div className="flex items-center gap-2 flex-wrap">
	          {/* Discourse Category Dropdown (类别 >) */}
	          <div className="relative" ref={boardDropdownRef}>
	            <button
	              type="button"
	              onClick={() => {
	                setBoardDropdownOpen(!boardDropdownOpen);
	                setBoardQuery("");
	              }}
	              className={`h-9 px-3 rounded-md border text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
	                selectedBoard !== "all"
	                  ? `${currentBoard.bgColor} ${currentBoard.borderColor} ${currentBoard.color} font-semibold shadow-xs`
	                  : "bg-surface hover:bg-surfaceBorder border-surfaceBorder text-gray-300"
	              }`}
	            >
	              <span className="text-gray-400 font-normal">{t("community.searchCategoryFilter")}</span>
	              <span className="text-gray-500 font-mono">&gt;</span>
	              <span className="max-w-[130px] truncate">
	                {selectedBoard === "all" ? t("community.allBoardsOption") : boardDisplayName(currentBoard, locale)}
	              </span>
	              <ChevronDown className={`w-3 h-3 text-gray-400 transition-transform ${boardDropdownOpen ? "rotate-180" : ""}`} />
	            </button>

	            {boardDropdownOpen && (
	              <div className="absolute left-0 top-full mt-1.5 w-72 rounded-lg bg-surface border border-surfaceBorder shadow-xl z-50 p-2 space-y-2 animate-in fade-in duration-100">
	                <div className="relative">
	                  <Search className="w-3.5 h-3.5 text-gray-500 absolute left-2.5 top-2.5" />
	                  <input
	                    ref={boardSearchInputRef}
	                    type="text"
	                    value={boardQuery}
	                    onChange={(e) => setBoardQuery(e.target.value)}
	                    placeholder={t("community.boardDropdownPlaceholder")}
	                    className="w-full pl-8 pr-2.5 py-1.5 rounded-md bg-background border border-surfaceBorder text-xs text-white placeholder-gray-500 focus:outline-none focus:border-gray-500 font-mono"
	                  />
	                </div>

	                <div className="max-h-60 overflow-y-auto space-y-0.5 scrollbar-thin">
	                  <button
	                    type="button"
	                    onClick={() => {
	                      setSelectedBoard("all");
	                      setBoardDropdownOpen(false);
	                    }}
	                    className={`w-full text-left px-2.5 py-2 rounded-md text-xs flex items-center justify-between transition-colors ${
	                      selectedBoard === "all"
	                        ? "bg-primary text-white font-semibold"
	                        : "text-gray-300 hover:text-white hover:bg-white/[0.05]"
	                    }`}
	                  >
	                    <span className="flex items-center gap-2 truncate">
	                      <Hash className="w-3.5 h-3.5 shrink-0 opacity-70" />
	                      <span>{t("community.allBoardsOption")}</span>
	                    </span>
	                    {selectedBoard === "all" && <span className="text-[10px]">✓</span>}
	                  </button>

	                  {filteredBoards
	                    .filter((b) => b.code !== "all")
	                    .map((board) => {
	                      const Icon = resolveBoardIcon(board);
	                      const isSelected = selectedBoard === board.code;
	                      return (
	                        <button
	                          key={board.code}
	                          type="button"
	                          onClick={() => {
	                            setSelectedBoard(board.code);
	                            setBoardDropdownOpen(false);
	                          }}
	                          className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs flex items-center justify-between transition-colors ${
	                            isSelected
	                              ? `${board.bgColor} ${board.color} font-semibold border ${board.borderColor}`
	                              : "text-gray-300 hover:text-white hover:bg-white/[0.05]"
	                          }`}
	                        >
	                          <span className="flex items-center gap-2 min-w-0">
	                            <span className={`w-5 h-5 rounded flex items-center justify-center shrink-0 ${board.bgColor} ${board.borderColor} border`}>
	                              <Icon className={`w-3 h-3 ${board.color}`} />
	                            </span>
	                            <span className="truncate">{boardDisplayName(board, locale)}</span>
	                          </span>
	                          {isSelected && <span className="text-[10px]">✓</span>}
	                        </button>
	                      );
	                    })}
	                </div>
	              </div>
	            )}
	          </div>

	          {/* Discourse Tag Dropdown (标签 >) */}
	          <div className="relative" ref={tagDropdownRef}>
	            <button
	              type="button"
	              onClick={() => {
	                setTagDropdownOpen(!tagDropdownOpen);
	                setTagQuery("");
	              }}
	              className={`h-9 px-3 rounded-md border text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
	                currentSelectedTagObj
	                  ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300 font-semibold shadow-xs"
	                  : "bg-surface hover:bg-surfaceBorder border-surfaceBorder text-gray-300"
	              }`}
	            >
	              <span className="text-gray-400 font-normal">{t("community.searchTagFilter")}</span>
	              <span className="text-gray-500 font-mono">&gt;</span>
	              <span className="max-w-[120px] truncate">
	                {currentSelectedTagObj ? `#${currentSelectedTagObj.name}` : t("community.allTagsOption")}
	              </span>
	              <ChevronDown className={`w-3 h-3 text-gray-400 transition-transform ${tagDropdownOpen ? "rotate-180" : ""}`} />
	            </button>

	            {tagDropdownOpen && (
	              <div className="absolute left-0 top-full mt-1.5 w-64 rounded-lg bg-surface border border-surfaceBorder shadow-xl z-50 p-2 space-y-2 animate-in fade-in duration-100">
	                <div className="relative">
	                  <Search className="w-3.5 h-3.5 text-gray-500 absolute left-2.5 top-2.5" />
	                  <input
	                    ref={tagSearchInputRef}
	                    type="text"
	                    value={tagQuery}
	                    onChange={(e) => {
	                      setTagQuery(e.target.value);
	                      fetchTags(e.target.value);
	                    }}
	                    placeholder={t("community.tagDropdownPlaceholder")}
	                    className="w-full pl-8 pr-2.5 py-1.5 rounded-md bg-background border border-surfaceBorder text-xs text-white placeholder-gray-500 focus:outline-none focus:border-emerald-400 font-mono"
	                  />
	                </div>

	                <div className="max-h-56 overflow-y-auto space-y-0.5 scrollbar-thin">
	                  <button
	                    type="button"
	                    onClick={() => {
	                      setFilterTagId(null);
	                      setFilterTagName(null);
	                      setTagDropdownOpen(false);
	                    }}
	                    className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs font-mono flex items-center justify-between transition-colors ${
	                      !filterTagId && !filterTagName
	                        ? "bg-primary text-white font-semibold"
	                        : "text-gray-400 hover:text-white hover:bg-white/[0.05]"
	                    }`}
	                  >
	                    <span>{t("community.allTagsOption")}</span>
	                    {!filterTagId && !filterTagName && <span className="text-[10px]">✓</span>}
	                  </button>

	                  {filteredTags.length === 0 ? (
	                    <div className="py-4 text-center text-xs font-mono text-gray-500">
	                      {t("community.noTagMatch")}
	                    </div>
	                  ) : (
	                    filteredTags.map((tag) => {
	                      const isSelected = filterTagId === tag.id || filterTagName === tag.name;
	                      return (
	                        <button
	                          key={tag.id}
	                          type="button"
	                          onClick={() => {
	                            setFilterTagId(tag.id);
	                            setFilterTagName(null);
	                            setTagDropdownOpen(false);
	                          }}
	                          className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs font-mono flex items-center justify-between transition-colors ${
	                            isSelected
	                              ? "bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/30"
	                              : "text-gray-300 hover:text-white hover:bg-white/[0.05]"
	                          }`}
	                        >
	                          <span className="flex items-center gap-1.5 truncate">
	                            <TagIcon className="w-3 h-3 text-gray-500 shrink-0" />
	                            <span className="truncate">#{tag.name}</span>
	                          </span>
	                          {isSelected && <span className="text-[10px] text-emerald-400">✓</span>}
	                        </button>
	                      );
	                    })
	                  )}
	                </div>
	              </div>
	            )}
	          </div>
	        </div>

	        {/* Tabs & Language filter */}
	        <div className="flex items-center gap-2 overflow-x-auto">
	          <div className="flex items-center gap-0.5 bg-surface border border-surfaceBorder rounded-md p-0.5 shrink-0">
	            <button
	              onClick={() => setActiveTab("latest")}
	              className={`px-3 h-8 rounded text-xs font-semibold flex items-center gap-1.5 transition-colors ${
	                activeTab === "latest" ? "bg-white text-black shadow-xs" : "text-gray-400 hover:text-white"
	              }`}
	            >
	              <Sparkles className="w-3.5 h-3.5" />
	              <span>{t("community.latest")}</span>
	            </button>
	            <button
	              onClick={() => setActiveTab("top")}
	              className={`px-3 h-8 rounded text-xs font-semibold flex items-center gap-1.5 transition-colors ${
	                activeTab === "top" ? "bg-white text-black shadow-xs" : "text-gray-400 hover:text-white"
	              }`}
	            >
	              <Flame className="w-3.5 h-3.5" />
	              <span>{t("community.top")}</span>
	            </button>
	          </div>

	          <div className="flex items-center gap-0.5 bg-surface border border-surfaceBorder rounded-md p-0.5 shrink-0">
	            <button
	              onClick={() => setFilterLanguage("all")}
	              className={`px-2.5 h-8 rounded text-xs font-medium transition-colors ${
	                filterLanguage === "all" ? "bg-white text-black shadow-xs font-semibold" : "text-gray-400 hover:text-white"
	              }`}
	            >
	              {t("community.languageAll")}
	            </button>
	            <button
	              onClick={() => setFilterLanguage("zh-CN")}
	              className={`px-2.5 h-8 rounded text-xs font-medium transition-colors ${
	                filterLanguage === "zh-CN" ? "bg-white text-black shadow-xs font-semibold" : "text-gray-400 hover:text-white"
	              }`}
	            >
	              {t("community.languageZh")}
	            </button>
	            <button
	              onClick={() => setFilterLanguage("en-US")}
	              className={`px-2.5 h-8 rounded text-xs font-medium transition-colors ${
	                filterLanguage === "en-US" ? "bg-white text-black shadow-xs font-semibold" : "text-gray-400 hover:text-white"
	              }`}
	            >
	              {t("community.languageEn")}
	            </button>
	          </div>
	        </div>
	      </div>

	      {/* Active Tag Filter Chip */}
	      {currentSelectedTagObj && (
	        <div className="flex items-center gap-2 pt-0.5 text-xs font-mono animate-in fade-in duration-100">
	          <span className="text-gray-500">{t("community.selectedTag", { name: "" })}</span>
	          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-semibold">
	            <TagIcon className="w-3 h-3" />
	            <span>#{currentSelectedTagObj.name}</span>
	            <button
	              type="button"
	              onClick={() => {
	                setFilterTagId(null);
	                setFilterTagName(null);
	              }}
	              className="hover:text-white p-0.5"
	              title={t("community.clearTag")}
	            >
	              <X className="w-3 h-3" />
	            </button>
	          </span>
	        </div>
	      )}
	    </div>
	  </div>

 <div className="px-4 py-6 space-y-5 flex-1">
 <div className="border border-surfaceBorder rounded-xl overflow-hidden bg-surface shadow-sm">
 <div className="hidden sm:flex items-center gap-3 px-4 py-2.5 bg-background/60 border-b border-surfaceBorder text-sm font-mono text-gray-500">
 <span className="flex-1">{t("community.topic")}</span>
 <span className="w-20 text-center">{t("community.participants")}</span>
 <span className="w-14 text-center">{t("community.replies")}</span>
 <span className="w-14 text-center hidden md:inline">{t("community.views")}</span>
 <span className="w-24 text-right">{t("community.activity")}</span>
 </div>

 {/* mobile header */}
 <div className="sm:hidden px-4 py-2 bg-background/60 border-b border-surfaceBorder text-sm font-mono text-gray-500 flex items-center justify-between">
 <span>{t("community.topic")} · {boardDisplayName(currentBoard, locale)}</span>
 <span>{t("community.topicItems", {count: topics.length})}</span>
 </div>

 {loading ? (
 <div className="py-16 text-center text-gray-500 font-mono text-sm">{t("common.loadingTopics")}</div>
 ) : topics.length === 0 ? (
 <div className="py-20 text-center text-gray-500 space-y-2">
 <p className="text-sm">{t("community.noTopics")}</p>
 <p className="text-sm text-gray-600">{t("community.noTopicsHint")}</p>
 {user && (
 <button onClick={() => setIsComposerOpen(true)} className="mt-3 px-3 py-1.5 rounded-md bg-white text-black text-sm font-bold inline-flex items-center gap-2">
 <Plus className="w-4 h-4" />
 {t("community.createFirstTopic")}
 </button>
 )}
 </div>
 ) : (
 <div className="divide-y divide-surfaceBorder/70">
 {topics.map((topic) => {
 const board = getBoard(topic.board_code);
 const Icon = resolveBoardIcon(board);
 const authorId = topic.user_id || topic.user?.id;
 return (
 <div key={topic.id} className="group flex items-stretch hover:bg-surfaceBorder/20 transition-colors">
 {/* main col */}
 <div className="flex-1 min-w-0 py-3 px-4 space-y-1.5">
 <Link href={`/community/${topic.id}`} className="block text-sm font-semibold text-white group-hover:text-emerald-400 transition-colors leading-snug line-clamp-2 sm:line-clamp-1">
 {topic.is_pinned && <span className="mr-1 inline-flex items-center px-2.5 py-1 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-mono">📌 {t("community.pinned")}</span>}{topic.title}
 </Link>
 <div className="flex items-center gap-2 flex-wrap">
 <span className={`inline-flex items-center gap-2 px-2.5 py-1 rounded border text-xs font-mono ${board.bgColor} ${board.borderColor} ${board.color}`}>
 <Icon className="w-4 h-4" />
 {boardDisplayName(board, locale)}
 </span>
 {topic.work && (
 <Link
 href={`/works/${topic.work.id}`}
 className="inline-flex items-center gap-2 px-2.5 py-1 rounded bg-background border border-surfaceBorder text-gray-300 hover:text-white text-xs font-mono hover:border-emerald-500/40 transition-colors max-w-[180px] truncate"
 onClick={(e) => e.stopPropagation()}
 >
 <BookOpen className="w-2.5 h-2.5 text-emerald-400 shrink-0" />
 <span className="truncate">{topic.work.title}</span>
 </Link>
 )}
 {topic.tags && topic.tags.length > 0 && topic.tags.map((tag) => (
 <button
 key={tag.id}
 onClick={() => setFilterTagId(tag.id)}
 className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 hover:bg-emerald-500/20 text-xs font-mono transition-colors"
 title={t("community.filterByTag", {name: tag.name})}
 >
 <TagIcon className="w-2.5 h-2.5" />
 {tag.name}
 </button>
 ))}
 <span className="hidden sm:inline-flex items-center gap-2 text-xs text-gray-500 font-mono">
 <User className="w-4 h-4" />
 {authorId ? (
 <Link
 href={`/users/${authorId}`}
 className="hover:text-white hover:underline transition-colors"
 onClick={(e) => e.stopPropagation()}
 >
 {topic.user?.username || t("community.anonymous")}
 </Link>
 ) : (
 <span>{topic.user?.username || t("community.anonymous")}</span>
 )}
 <span className="text-gray-600">·</span>
 {formatTimeAgo(topic.created_at, locale, t)}
 </span>
 </div>
 {/* mobile meta */}
 <div className="sm:hidden flex items-center gap-3 text-sm font-mono text-gray-500">
 <span className="flex items-center gap-2">
 <MessageSquare className="w-4 h-4" />
 {topic.reply_count}
 </span>
 <span className="flex items-center gap-2">
 <Eye className="w-4 h-4" />
 {topic.view_count}
 </span>
 <span className="ml-auto">{formatTimeAgo(topic.updated_at || topic.created_at, locale, t)}</span>
 </div>
 </div>

 {/* avatars */}
 <div className="hidden sm:flex w-20 items-center justify-center">
 <div className="flex items-center -space-x-1.5">
 {authorId ? (
 <Link
 href={`/users/${authorId}`}
 title={`${t("community.authorPrefix")}${topic.user?.username || t("community.anonymous")}`}
 className="hover:opacity-90 transition-all z-10 block shrink-0"
 onClick={(e) => e.stopPropagation()}
 >
 <UserAvatar user={topic.user} size="sm" shape="circle" className="border-2 border-background ring-1 ring-surfaceBorder hover:ring-primary" />
 </Link>
 ) : (
 <div title={`${t("community.authorPrefix")}${topic.user?.username || t("community.anonymous")}`} className="block shrink-0">
 <UserAvatar user={topic.user} size="sm" shape="circle" className="border-2 border-background ring-1 ring-surfaceBorder" />
 </div>
 )}
 {topic.reply_count > 0 && (
 <div title={t("community.activeReplier")} className="w-7 h-7 rounded-full bg-emerald-500/20 border-2 border-background flex items-center justify-center text-[10px] font-bold text-emerald-400 ring-1 ring-emerald-500/40 shrink-0">
 +{topic.reply_count}
 </div>
 )}
 </div>
 </div>

 <div className="hidden sm:flex w-14 items-center justify-center">
 <span className={`px-2.5 py-1 rounded text-sm font-bold font-mono ${topic.reply_count > 0 ? "bg-surfaceBorder/60 text-white" : "text-gray-500"}`}>{topic.reply_count}</span>
 </div>
 <div className="hidden md:flex w-14 items-center justify-center text-gray-400 font-mono text-sm">{topic.view_count}</div>
 <div className="hidden sm:flex w-24 items-center justify-end pr-4 text-gray-400 font-mono text-sm whitespace-nowrap">{formatTimeAgo(topic.updated_at || topic.created_at, locale, t)}</div>
 </div>
 );
 })}
 </div>
 )}
 </div>
 </div>
 </main>
 </div>

 {/* Composer Drawer — unified PostComposer */}
 {isComposerOpen && (
 <PostComposer
 mode="createTopic"
 boards={boards}
 availableTags={availableTags}
 expanded={composerExpanded}
 onExpandedChange={setComposerExpanded}
 locale={locale}
 t={t}
 onSuccess={() => {
 fetchTags();
 loadTopics();
 setIsComposerOpen(false);
 }}
 onClose={() => setIsComposerOpen(false)}
 />
 )}
 </div>
 );
}

export default function CommunityPage() {
 return (
 <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center text-sm text-gray-500">Loading…</div>}>
 <CommunityContent />
 </Suspense>
 );
}
