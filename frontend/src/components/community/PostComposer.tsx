"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  fetchApi,
  ForumBoard,
  Tag,
  Work,
  boardDisplayName,
  createTopic,
  createPost,
} from "@/lib/api";
import {
  Bold,
  Italic,
  Quote,
  Code,
  List,
  X,
  Minimize2,
  Maximize2,
  MessageSquare,
  Send,
  Search,
  BookOpen,
  Check,
  ChevronDown,
  Tag as TagIcon,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────

type Mode = "createTopic" | "reply";

interface QuotedPost {
  post_number: number;
  username?: string;
  content: string;
}

interface PostComposerProps {
  mode: Mode;
  topicId?: string;
  quotedPost?: QuotedPost | null;
  defaultBoardCode?: string;
  boards: ForumBoard[];
  availableTags: Tag[];
  onSuccess: () => void;
  onClose: () => void;
  expanded: boolean;
  onExpandedChange: (v: boolean) => void;
  locale: string;
  t: (k: string, params?: Record<string, string | number>) => string;
}

// ── Markdown toolbar ───────────────────────────────────────────────────

function MarkdownToolbar({
  textareaRef,
  onInsert,
  t,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  onInsert: (transform: (prev: string) => string) => void;
  t: (k: string, params?: Record<string, string | number>) => string;
}) {
  const wrapSelection = useCallback(
    (before: string, after: string, placeholder: string) => {
      const el = textareaRef.current;
      if (!el) {
        onInsert((prev) => prev + before + placeholder + after);
        return;
      }
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const selected = el.value.slice(start, end);
      const inner = selected || placeholder;
      const replacement = before + inner + after;
      const prevVal = el.value;
      const next = prevVal.slice(0, start) + replacement + prevVal.slice(end);
      onInsert(() => next);
      requestAnimationFrame(() => {
        el.focus();
        if (selected) {
          el.setSelectionRange(start + before.length, start + before.length + selected.length);
        } else {
          el.setSelectionRange(start + before.length, start + before.length + placeholder.length);
        }
      });
    },
    [textareaRef, onInsert]
  );

  const insertBlock = useCallback(
    (snippet: string) => {
      const el = textareaRef.current;
      if (!el) {
        onInsert((prev) => prev + snippet);
        return;
      }
      const start = el.selectionStart;
      const prevVal = el.value;
      const selected = prevVal.slice(start, el.selectionEnd);
      const block = selected ? selected + snippet : snippet;
      const next = prevVal.slice(0, start) + block + prevVal.slice(el.selectionEnd);
      onInsert(() => next);
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(next.length, next.length);
      });
    },
    [textareaRef, onInsert]
  );

  return (
    <div className="flex items-center gap-1 py-1 border-y border-surfaceBorder text-gray-400 shrink-0">
      <button
        type="button"
        onClick={() => wrapSelection("**", "**", t("community.boldPlaceholder"))}
        className="p-1 hover:text-white rounded hover:bg-background"
        title={t("community.bold")}
      >
        <Bold className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={() => wrapSelection("*", "*", t("community.italicPlaceholder"))}
        className="p-1 hover:text-white rounded hover:bg-background"
        title={t("community.italic")}
      >
        <Italic className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={() => wrapSelection("\n> ", "", t("community.quotePlaceholder"))}
        className="p-1 hover:text-white rounded hover:bg-background"
        title={t("community.quote")}
      >
        <Quote className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={() => wrapSelection("\n```\n", "\n```\n", t("community.codePlaceholder"))}
        className="p-1 hover:text-white rounded hover:bg-background"
        title={t("community.code")}
      >
        <Code className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={() => insertBlock("\n- " + t("community.listPlaceholder") + "\n")}
        className="p-1 hover:text-white rounded hover:bg-background"
        title={t("community.list")}
      >
        <List className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────

const BOARD_ICON_FALLBACK = BookOpen;

function resolveBoardIcon(board: ForumBoard): React.ElementType {
  // Boards use short color names; icons live on board.icon but we treat all uniformly.
  // Keep simple; show BookOpen circle style consistent with original drawer.
  void board;
  return BOARD_ICON_FALLBACK;
}

function draftKey(mode: Mode, topicId?: string): string {
  return `mf_composer_draft_${mode}_${topicId || "new"}`;
}

// ── Component ──────────────────────────────────────────────────────────

export default function PostComposer({
  mode,
  topicId,
  quotedPost,
  defaultBoardCode,
  boards,
  availableTags,
  onSuccess,
  onClose,
  expanded,
  onExpandedChange,
  locale,
  t,
}: PostComposerProps) {
  // ── Shared content state ──
  const [newContent, setNewContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const contentRef = useRef<HTMLTextAreaElement>(null);

  // ── createTopic-only state ──
  const [newTitle, setNewTitle] = useState("");
  const [newBoardCode, setNewBoardCode] = useState(defaultBoardCode || "announcement");
  const [topicLanguage, setTopicLanguage] = useState<string>(locale || "zh-CN");
  const [workSearchQuery, setWorkSearchQuery] = useState("");
  const [searchedWorks, setSearchedWorks] = useState<Work[]>([]);
  const [selectedWork, setSelectedWork] = useState<Work | null>(null);
  const boardQueryRef = useRef<HTMLInputElement>(null);

  const [boardQuery, setBoardQuery] = useState("");
  const [boardDropdownOpen, setBoardDropdownOpen] = useState(false);
  const boardDropdownRef = useRef<HTMLDivElement>(null);

  const [tagInput, setTagInput] = useState("");
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false);
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([]);
  const [customTagNames, setCustomTagNames] = useState<string[]>([]);
  const tagInputRef = useRef<HTMLInputElement>(null);

  // quoted post local dismiss
  const [activeQuotedPost, setActiveQuotedPost] = useState<QuotedPost | null | undefined>(quotedPost ?? null);
  useEffect(() => {
    setActiveQuotedPost(quotedPost ?? null);
  }, [quotedPost]);

  // Keep board default synced if prop changes while composer open
  useEffect(() => {
    if (mode === "createTopic" && defaultBoardCode) setNewBoardCode(defaultBoardCode);
  }, [defaultBoardCode, mode]);

  // ── Draft persist ──
  const key = draftKey(mode, topicId);

  // Restore on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const d = JSON.parse(raw) as Record<string, unknown>;
      if (mode === "createTopic") {
        if (typeof d.newTitle === "string") setNewTitle(d.newTitle);
        if (typeof d.newBoardCode === "string") setNewBoardCode(d.newBoardCode);
        if (typeof d.newContent === "string") setNewContent(d.newContent);
        if (Array.isArray(d.selectedTagIds)) setSelectedTagIds(d.selectedTagIds as number[]);
        if (Array.isArray(d.customTagNames)) setCustomTagNames(d.customTagNames as string[]);
        // work / tags snapshot kept minimal; ignoring selectedWork restore (Work object not rehydrated)
      } else {
        if (typeof d.newContent === "string") setNewContent(d.newContent);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save on change (debounced lightly via immediate writes; cheap)
  useEffect(() => {
    try {
      if (mode === "createTopic") {
        localStorage.setItem(
          key,
          JSON.stringify({ newTitle, newBoardCode, newContent, selectedTagIds, customTagNames })
        );
      } else {
        localStorage.setItem(key, JSON.stringify({ newContent }));
      }
    } catch {}
  }, [key, mode, newTitle, newBoardCode, newContent, selectedTagIds, customTagNames]);

  const clearDraft = useCallback(() => {
    try {
      localStorage.removeItem(key);
    } catch {}
  }, [key]);

  // ── Work debounced search ──
  useEffect(() => {
    if (!workSearchQuery.trim()) {
      setSearchedWorks([]);
      return;
    }
    const timer = setTimeout(() => {
      fetchApi<{ items: Work[] }>(`/catalog/works?q=${encodeURIComponent(workSearchQuery.trim())}`)
        .then((res) => setSearchedWorks(res.items || []))
        .catch(() => setSearchedWorks([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [workSearchQuery]);

  // ── Outside click for board dropdown ──
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (boardDropdownRef.current && !boardDropdownRef.current.contains(e.target as Node)) {
        setBoardDropdownOpen(false);
      }
    };
    if (boardDropdownOpen) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [boardDropdownOpen]);

  // ── Derived ──
  const boardOptions = boards.filter((b) => b.code !== "all");
  const filteredBoards = boardOptions.filter((b) => {
    if (!boardQuery.trim()) return true;
    const q = boardQuery.toLowerCase();
    return b.name.toLowerCase().includes(q) || b.desc.toLowerCase().includes(q) || b.code.toLowerCase().includes(q);
  });
  const selectedBoardObj =
    boards.find((b) => b.code === newBoardCode) || boardOptions[0] || boards[0] || null;

  const filteredAvailableTags = availableTags
    .filter((tag) => {
      if (!tagInput.trim()) return true;
      return tag.name.toLowerCase().includes(tagInput.trim().toLowerCase());
    })
    .filter((tag) => !selectedTagIds.includes(tag.id) && !customTagNames.includes(tag.name));

  const selectedTagsForDisplay: { id?: number; name: string }[] = [
    ...selectedTagIds.map((id) => {
      const found = availableTags.find((x) => x.id === id);
      return found ? { id: found.id, name: found.name } : { id, name: String(id) };
    }),
    ...customTagNames.map((n) => ({ name: n })),
  ];

  const addTag = (tag: Tag) => {
    setSelectedTagIds((prev) => [...prev, tag.id]);
    setTagInput("");
    setTagDropdownOpen(false);
  };

  const addCustomTag = (nameRaw: string) => {
    const name = nameRaw.trim();
    if (!name) return;
    if (customTagNames.includes(name)) return;
    if (availableTags.some((entry) => entry.name === name && selectedTagIds.includes(entry.id))) return;
    const existing = availableTags.find((entry) => entry.name === name);
    if (existing) {
      addTag(existing);
      return;
    }
    setCustomTagNames((prev) => [...prev, name]);
    setTagInput("");
    setTagDropdownOpen(false);
  };

  const removeTagId = (id: number) => setSelectedTagIds((prev) => prev.filter((v) => v !== id));
  const removeCustomTag = (name: string) => setCustomTagNames((prev) => prev.filter((v) => v !== name));

  const setContentFromToolbar = useCallback((transform: (prev: string) => string) => {
    setNewContent((prev) => transform(prev));
  }, []);

  // ── Submits ──
  const handleCreateTopic = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newContent.trim()) return;
    setSubmitting(true);
    try {
      await createTopic({
        board_code: newBoardCode,
        title: newTitle.trim(),
        content: newContent.trim(),
        language: topicLanguage,
        work_id: selectedWork ? selectedWork.id : undefined,
        tag_ids: selectedTagIds.length ? selectedTagIds : undefined,
        tag_names: customTagNames.length ? customTagNames : undefined,
      });
      clearDraft();
      setNewTitle("");
      setNewContent("");
      setSelectedWork(null);
      setWorkSearchQuery("");
      setSelectedTagIds([]);
      setCustomTagNames([]);
      setTagInput("");
      setBoardQuery("");
      onSuccess();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(msg || t("auth.requestFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newContent.trim()) return;
    if (!topicId) {
      alert("Missing topicId for reply");
      return;
    }
    setSubmitting(true);
    try {
      await createPost(topicId, {
        content: newContent.trim(),
        reply_to_post_number: activeQuotedPost?.post_number ?? null,
      });
      clearDraft();
      setNewContent("");
      setActiveQuotedPost(null);
      onSuccess();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(msg || t("auth.requestFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const headerTitle =
    mode === "createTopic" ? t("community.createTitle") : t("community.replyTopic");

  // ── Render ──
  return (
    <div
      className={`fixed bottom-0 left-0 right-0 z-50 bg-surface border-t-2 border-surfaceBorder shadow-2xl transition-all flex flex-col pb-[env(safe-area-inset-bottom)] ${expanded ? "h-[85vh]" : "h-[min(560px,85vh)]"}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-background border-b border-surfaceBorder shrink-0">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-emerald-400" />
          <span className="font-bold text-white text-xs">{headerTitle}</span>
          <span className="hidden sm:inline text-[10px] font-mono text-gray-500">{t("community.markdownReady")}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onExpandedChange(!expanded)}
            className="p-1 text-gray-400 hover:text-white"
            title={expanded ? t("community.composerCollapse") : t("community.composerExpand")}
          >
            {expanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-white"
            title={t("community.closeComposer")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Body */}
      {mode === "createTopic" ? (
        <form onSubmit={handleCreateTopic} className="flex-1 flex flex-col p-4 gap-3.5 overflow-hidden">
          {/* Title + Board + Work */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 shrink-0">
            <div className="md:col-span-5">
              <input
                type="text"
                required
                placeholder={t("community.topicTitlePlaceholder")}
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                className="w-full px-3.5 h-10 bg-background border border-surfaceBorder rounded-lg text-white text-sm focus:outline-none focus:border-gray-600 font-medium"
              />
            </div>

            {/* Searchable board selector */}
            <div className="md:col-span-3 relative" ref={boardDropdownRef}>
              <button
                type="button"
                onClick={() => setBoardDropdownOpen((v) => !v)}
                className="w-full px-3.5 h-10 bg-background border border-surfaceBorder rounded-lg text-white text-sm flex items-center justify-between gap-2 hover:border-gray-600 transition-colors cursor-pointer"
              >
                <span className="flex items-center gap-2 truncate">
                  {selectedBoardObj ? (
                    <>
                      <span className={`w-2.5 h-2.5 rounded-full ${selectedBoardObj.bgColor} ${selectedBoardObj.borderColor} border`} />
                      <span className="truncate font-medium">{boardDisplayName(selectedBoardObj, locale)}</span>
                    </>
                  ) : (
                    <span className="truncate">{t("community.board")}</span>
                  )}
                </span>
                <ChevronDown className={`w-4 h-4 text-gray-500 shrink-0 transition-transform ${boardDropdownOpen ? "rotate-180" : ""}`} />
              </button>
              {boardDropdownOpen && (
                <div className="absolute top-full mt-2 left-0 right-0 bg-surface/95 backdrop-blur-2xl border border-white/10 rounded-card shadow-elevated z-50 isolate animate-slide-up overflow-hidden flex flex-col">
                  <div className="p-2 border-b border-surfaceBorder">
                    <div className="relative">
                      <Search className="w-3 h-3 text-gray-500 absolute left-2 top-2.5" />
                      <input
                        ref={boardQueryRef}
                        autoFocus
                        type="text"
                        placeholder={t("community.boardSearchPlaceholder")}
                        value={boardQuery}
                        onChange={(e) => setBoardQuery(e.target.value)}
                        className="w-full pl-7 pr-2 py-1.5 bg-background border border-surfaceBorder rounded text-white text-xs placeholder-gray-500 focus:outline-none focus:border-gray-600"
                      />
                    </div>
                  </div>
                  <div className="max-h-48 overflow-y-auto divide-y divide-surfaceBorder">
                    {filteredBoards.length === 0 ? (
                      <div className="p-3 text-center text-[11px] text-gray-500">{t("community.noBoardMatch")}</div>
                    ) : (
                      filteredBoards.map((b) => {
                        const active = newBoardCode === b.code;
                        const Icon = resolveBoardIcon(b);
                        return (
                          <button
                            key={b.code}
                            type="button"
                            onClick={() => {
                              setNewBoardCode(b.code);
                              setBoardDropdownOpen(false);
                              setBoardQuery("");
                            }}
                            className={`w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-surfaceBorder/50 transition-colors ${active ? "bg-surfaceBorder/30" : ""}`}
                          >
                            <span className={`w-7 h-7 rounded-md flex items-center justify-center border shrink-0 ${b.bgColor} ${b.borderColor}`}>
                              <Icon className={`w-3.5 h-3.5 ${b.color}`} />
                            </span>
                            <span className="flex-1 min-w-0">
                              <span className={`block text-xs font-semibold truncate ${active ? "text-white" : "text-gray-200"}`}>
                                {boardDisplayName(b, locale)}
                              </span>
                              <span className="block text-[10px] text-gray-500 truncate">{b.desc}</span>
                            </span>
                            {active && <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Work link */}
            <div className="md:col-span-4 relative">
              {selectedWork ? (
                <div className="flex items-center justify-between px-3.5 h-10 rounded-lg bg-background border border-emerald-500/40 text-emerald-300">
                  <span className="flex items-center gap-2 truncate text-sm font-semibold">
                    <BookOpen className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="truncate">{selectedWork.title}</span>
                  </span>
                  <button type="button" onClick={() => setSelectedWork(null)} className="text-gray-400 hover:text-white ml-1.5 cursor-pointer">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div>
                  <input
                    type="text"
                    placeholder={t("community.workSearchPlaceholder")}
                    value={workSearchQuery}
                    onChange={(e) => setWorkSearchQuery(e.target.value)}
                    className="w-full px-3.5 h-10 bg-background border border-surfaceBorder rounded-lg text-white text-sm focus:outline-none focus:border-gray-600"
                  />
                  {searchedWorks.length > 0 && (
                    <div className="absolute top-full mt-2 left-0 right-0 bg-surface/95 backdrop-blur-2xl border border-white/10 rounded-xl shadow-elevated max-h-48 overflow-y-auto z-50 isolate animate-slide-up divide-y divide-white/[0.06]">
                      {searchedWorks.map((w) => (
                        <div
                          key={w.id}
                          onClick={() => {
                            setSelectedWork(w);
                            setWorkSearchQuery("");
                            setSearchedWorks([]);
                            setNewBoardCode("comment");
                          }}
                          className="p-2.5 hover:bg-surfaceBorder/50 cursor-pointer flex items-center justify-between text-gray-300 hover:text-white text-sm"
                        >
                          <span className="font-medium truncate">{w.title}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Tags & Language */}
          <div className="shrink-0 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1 bg-background border border-surfaceBorder rounded-full px-2.5 py-1 text-xs font-mono shrink-0">
                <span className="text-gray-500">{t("locale.languageChoice")}:</span>
                <button
                  type="button"
                  onClick={() => setTopicLanguage("zh-CN")}
                  className={`px-2 py-0.5 rounded-full transition-colors ${topicLanguage === "zh-CN" ? "bg-white text-black font-semibold" : "text-gray-400 hover:text-white"}`}
                >
                  {t("community.languageZh")}
                </button>
                <button
                  type="button"
                  onClick={() => setTopicLanguage("en-US")}
                  className={`px-2 py-0.5 rounded-full transition-colors ${topicLanguage === "en-US" ? "bg-white text-black font-semibold" : "text-gray-400 hover:text-white"}`}
                >
                  {t("community.languageEn")}
                </button>
              </div>
              <span className="text-xs font-mono text-gray-500 flex items-center gap-1 shrink-0 ml-1">
                <TagIcon className="w-3.5 h-3.5" />
                {t("community.tags")}
              </span>
              {selectedTagsForDisplay.map((entry) => (
                <span
                  key={`${entry.id ?? entry.name}-${entry.name}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-medium"
                >
                  #{entry.name}
                  <button
                    type="button"
                    onClick={() => {
                      if (entry.id) removeTagId(entry.id);
                      else removeCustomTag(entry.name);
                    }}
                    className="ml-0.5 p-0.5 hover:bg-emerald-500/20 rounded-full"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </span>
              ))}
              <div className="relative flex-1 min-w-[180px] max-w-[260px]">
                <input
                  ref={tagInputRef}
                  type="text"
                  placeholder={t("community.tagPlaceholder")}
                  value={tagInput}
                  onChange={(e) => {
                    setTagInput(e.target.value);
                    setTagDropdownOpen(true);
                  }}
                  onFocus={() => setTagDropdownOpen(true)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (tagInput.trim()) {
                        const exact = filteredAvailableTags.find((x) => x.name === tagInput.trim());
                        if (exact) addTag(exact);
                        else addCustomTag(tagInput);
                      }
                    } else if (e.key === "Escape") {
                      setTagDropdownOpen(false);
                    }
                  }}
                  className="w-full pl-3.5 pr-2.5 h-9 bg-background border border-surfaceBorder rounded-full text-white text-xs placeholder-gray-500 focus:outline-none focus:border-emerald-500/50"
                />
                {tagDropdownOpen && tagInput.trim() && (
                  <div className="absolute top-full mt-2 left-0 right-0 bg-surface/95 backdrop-blur-2xl border border-white/10 rounded-card shadow-elevated z-50 isolate animate-slide-up max-h-40 overflow-y-auto divide-y divide-white/[0.06]">
                    {filteredAvailableTags.slice(0, 8).map((ftag) => (
                      <button
                        key={ftag.id}
                        type="button"
                        onClick={() => addTag(ftag)}
                        className="w-full px-3 py-2 text-left hover:bg-surfaceBorder/50 flex items-center justify-between text-xs text-gray-300 hover:text-white"
                      >
                        <span className="flex items-center gap-1.5">
                          <TagIcon className="w-3 h-3 text-gray-500" />
                          {ftag.name}
                        </span>
                        <span className="text-[10px] text-gray-500 font-mono">{ftag.group_type}</span>
                      </button>
                    ))}
                    {tagInput.trim() && !availableTags.some((entry) => entry.name === tagInput.trim()) && (
                      <button
                        type="button"
                        onClick={() => addCustomTag(tagInput)}
                        className="w-full px-3 py-2 text-left hover:bg-emerald-500/10 flex items-center gap-1.5 text-xs text-emerald-300"
                      >
                        <Check className="w-3 h-3" />
                        {t("community.createTag", { name: tagInput.trim() })}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
            <p className="text-[11px] text-gray-600 font-mono">{t("community.tagMultiHint")}</p>
          </div>

          <MarkdownToolbar textareaRef={contentRef} onInsert={setContentFromToolbar} t={t} />

          <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-3 min-h-0">
            <textarea
              ref={contentRef}
              required
              placeholder={t("community.contentPlaceholder")}
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              className="w-full h-full p-3.5 bg-background border border-surfaceBorder rounded-lg text-white text-sm focus:outline-none focus:border-gray-600 resize-none font-mono leading-relaxed overflow-y-auto"
            />
            <div className="hidden md:block h-full p-3.5 bg-background/50 border border-surfaceBorder rounded-lg overflow-y-auto text-gray-300 text-sm leading-relaxed whitespace-pre-wrap">
              {newContent ? newContent : <span className="text-gray-600 font-mono">{t("community.livePreview")}</span>}
            </div>
          </div>

          <div className="flex items-center justify-between pt-2.5 border-t border-surfaceBorder shrink-0">
            <span className="text-xs text-gray-500 font-mono hidden sm:inline">{t("community.markdownReady")}</span>
            <div className="flex items-center gap-2.5 ml-auto">
              <button
                type="button"
                onClick={() => {
                  clearDraft();
                  onClose();
                }}
                className="px-4 h-10 rounded-lg bg-surface hover:bg-surfaceBorder text-gray-400 hover:text-white text-sm transition-colors cursor-pointer"
              >
                {t("community.discard")}
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-5 h-10 rounded-lg bg-white hover:bg-gray-200 text-black font-semibold flex items-center gap-2 transition-colors disabled:opacity-50 text-sm shadow-xs cursor-pointer"
              >
                <Send className="w-4 h-4" />
                <span>{submitting ? t("community.creating") : t("community.createTopic")}</span>
              </button>
            </div>
          </div>
        </form>
      ) : (
        <form onSubmit={handleReply} className="flex-1 flex flex-col p-4 gap-3.5 overflow-hidden">
          {/* Quoted banner */}
          {activeQuotedPost && (
            <div className="flex items-center justify-between px-3.5 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs sm:text-sm shrink-0">
              <span className="flex items-center gap-2">
                <Quote className="w-4 h-4" />
                <span>
                  {t("community.replyingTo", { n: activeQuotedPost.post_number })}
                  {activeQuotedPost.username ? ` · @${activeQuotedPost.username}` : ""}
                </span>
              </span>
              <button
                type="button"
                onClick={() => setActiveQuotedPost(null)}
                className="px-2.5 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-xs font-mono cursor-pointer"
              >
                {t("community.cancelReply")}
              </button>
            </div>
          )}

          <MarkdownToolbar textareaRef={contentRef} onInsert={setContentFromToolbar} t={t} />

          <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-3 min-h-0">
            <textarea
              ref={contentRef}
              required
              placeholder={t("community.replyPlaceholder")}
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              className="w-full h-full p-3.5 bg-background border border-surfaceBorder rounded-lg text-white text-sm focus:outline-none focus:border-gray-600 resize-none font-mono leading-relaxed overflow-y-auto"
            />
            <div className="hidden md:block h-full p-3.5 bg-background/50 border border-surfaceBorder rounded-lg overflow-y-auto text-gray-300 text-sm leading-relaxed whitespace-pre-wrap">
              {newContent ? newContent : <span className="text-gray-600 font-mono">{t("community.livePreview")}</span>}
            </div>
          </div>

          <div className="flex items-center justify-between pt-2.5 border-t border-surfaceBorder shrink-0">
            <span className="text-xs text-gray-500 font-mono hidden sm:inline">{t("community.markdownReady")}</span>
            <div className="flex items-center gap-2.5 ml-auto">
              <button
                type="button"
                onClick={() => {
                  clearDraft();
                  onClose();
                }}
                className="px-4 h-10 rounded-lg bg-surface hover:bg-surfaceBorder text-gray-400 hover:text-white text-sm transition-colors cursor-pointer"
              >
                {t("community.discard")}
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-5 h-10 rounded-lg bg-white hover:bg-gray-200 text-black font-semibold flex items-center gap-2 transition-colors disabled:opacity-50 text-sm shadow-xs cursor-pointer"
              >
                <Send className="w-4 h-4" />
                <span>{submitting ? t("community.creating") : t("community.reply")}</span>
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}

export type { Mode, QuotedPost, PostComposerProps };
