"use client";

import React, { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { UserAvatar } from "@/components/UserAvatar";
import { UserRoleBadge } from "@/lib/roles";
import { fetchApi, DiscussionTopic, ForumPost, ForumBoard, fetchBoards, FORUM_BOARDS, getBoardSync, boardDisplayName, shareContent, buildShareUrl, catalogEntityHref, setTopicPinned, ApiError } from "@/lib/api";
import { can, COMMUNITY_POST_MODERATE, COMMUNITY_TOPIC_PIN } from "@/lib/permissions";
import PostComposer from "@/components/community/PostComposer";
import { TabPanel } from "@/components/ui/TabPanel";
import { PageShell } from "@/components/ui/PageShell";
import { classifyLoadFailure, DetailNotFound, DetailUnavailable, type LoadFailureKind } from "@/components/common/DetailLoadStates";
const MarkdownRenderer = dynamic(() => import("@/components/MarkdownRenderer"), {
  loading: () => <div className="h-4 my-1.5 rounded bg-black/[0.04] dark:bg-white/[0.04] animate-pulse" />,
});
import { useAuth } from "@/lib/authContext";
import { useI18n } from "@/i18n/I18nProvider";
import { ConfirmDialog } from "@/components/oauth/ConfirmDialog";
import {
  ArrowLeft,
  ArrowRight,
  Heart,
  Share2,
  Reply,
  Check,
  Tag as TagIcon,
  Trash2,
  Pin,
  PinOff,
} from "lucide-react";

export default function TopicDetailPage() {
 const params = useParams();
 const router = useRouter();
 const topicId = params.id as string;

 const { user } = useAuth();
 const { t, tr, locale } = useI18n();
 const [topic, setTopic] = useState<DiscussionTopic | null>(null);
 const [posts, setPosts] = useState<ForumPost[]>([]);
 const [loading, setLoading] = useState(true);
 const [likedPosts, setLikedPosts] = useState<Record<string, boolean>>({});
 const [shareFeedback, setShareFeedback] = useState<Record<string, string>>({});
 const [boards, setBoards] = useState<ForumBoard[]>(FORUM_BOARDS);
 const [isComposerOpen, setIsComposerOpen] = useState(false);
 const [composerExpanded, setComposerExpanded] = useState(false);
 const [replyTo, setReplyTo] = useState<{ post_number: number; username?: string; content: string } | null>(null);
 const [deletingTarget, setDeletingTarget] = useState<string | null>(null);
 // 待确认的删除目标：确认框自绘（见文件尾），这里只记"要删哪一个"。
 const [pendingDelete, setPendingDelete] = useState<{ kind: "topic" } | { kind: "reply"; post: ForumPost } | null>(null);
 const [moderationError, setModerationError] = useState<{ target: string; text: string } | null>(null);
 const [pinning, setPinning] = useState(false);
 const [pinNotice, setPinNotice] = useState("");
 // 治理入口只对持有对应权限码的人存在；鉴权仍在服务端，这里不渲染禁用态。
 // 置顶与删帖是两条不同的码（community.topic.pin / community.post.moderate），分开判定：
 // 只有置顶权的人不该看见删除入口，反之亦然。
 const canModeratePosts = can(user, COMMUNITY_POST_MODERATE);
 const canPinTopic = can(user, COMMUNITY_TOPIC_PIN);

 useEffect(() => { fetchBoards().then(setBoards).catch(()=>{}); }, []);

 // 取数失败与"这个主题不存在"是两种状态：之前 catch 只 console.error → topic 保持 null →
 // 429/5xx/断网都渲染成「未找到该讨论主题。」，既说错原因又没有重试出口。
 const [loadError, setLoadError] = useState<LoadFailureKind | "">("");

 const loadTopic = async () => {
 setLoading(true);
 setLoadError("");
 try {
 const data = await fetchApi<DiscussionTopic>(`/community/topics/${topicId}`);
 const raw = data as any;
 let normalized: ForumPost[] = [];
 if (raw.posts && raw.posts.length > 0) {
 normalized = raw.posts;
 } else if (raw.comments && raw.comments.length > 0) {
 normalized = [
 { id: raw.id, topic_id: raw.id, post_number: 1, user_id: raw.user_id, content: raw.content, created_at: raw.created_at, user: raw.user } as any,
 ...raw.comments.map((c: any, i: number) => ({
 id: c.id,
 topic_id: raw.id,
 post_number: i + 2,
 user_id: c.user_id,
 content: c.content,
 reply_to_post_number: null,
 created_at: c.created_at,
 user: c.user,
 })),
 ];
 } else {
 normalized = [{ id: raw.id, topic_id: raw.id, post_number: 1, user_id: raw.user_id, content: raw.content, created_at: raw.created_at, user: raw.user } as any];
 }
 setTopic(data);
 setPosts(normalized);
 } catch (err) {
 setLoadError(classifyLoadFailure(err));
 } finally {
 setLoading(false);
 }
 };

 useEffect(() => {
 if (topicId) {
 loadTopic();
 }
 }, [topicId]);

 const toggleLike = (id: string) => {
 setLikedPosts((prev) => ({ ...prev, [id]: !prev[id] }));
 };

 const handleShare = async (id: string, highlightPostId?: string) => {
 const url = buildShareUrl(topicId, highlightPostId);
 const title = topic?.title || t("community.createTitle");
 const result = await shareContent({ title, text: title, url });
 if (result === 'shared') {
 setShareFeedback((p) => ({ ...p, [id]: t("community.shareNative") }));
 } else if (result === 'copied') {
 setShareFeedback((p) => ({ ...p, [id]: t("community.shareCopied") }));
 } else {
 setShareFeedback((p) => ({ ...p, [id]: t("community.shareFailed") }));
 }
 setTimeout(() => setShareFeedback((p) => { const n = { ...p }; delete n[id]; return n; }), 2500);
 };

 const openReply = (post: ForumPost) => {
 setReplyTo({ post_number: post.post_number, username: post.user?.username, content: post.content });
 setIsComposerOpen(true);
 };

 const openTopicReply = () => {
 setReplyTo(null);
 setIsComposerOpen(true);
 };

 // 失败如实提示：403 说明缺治理码（网关/服务端拒绝），其余按通用失败文案，不静默。
 const moderationErrorText = (err: unknown) =>
 err instanceof ApiError && err.status === 403
 ? t("community.moderateForbidden")
 : t("community.moderateFailed");

 // 置顶不二次确认：它是可逆的展示位调整，不是破坏性动作；失败照实提示，并按状态码分档
 // （403 缺码 / 404 主题不存在或该板块不支持 / 其余通用），不把失败说成成功。
 const togglePin = async () => {
 if (!topic) return;
 setPinning(true);
 setPinNotice("");
 const next = !topic.is_pinned;
 try {
 const updated = await setTopicPinned(topicId, next);
 setTopic((prev) => (prev ? { ...prev, is_pinned: updated.is_pinned ?? next } : prev));
 setPinNotice(next ? t("community.pinSuccess") : t("community.unpinSuccess"));
 } catch (err) {
 const status = err instanceof ApiError ? err.status : 0;
 setPinNotice(
 status === 403
 ? t("community.pinForbidden")
 : status === 404
 ? t("community.pinNotFound")
 : t("community.pinFailed"),
 );
 } finally {
 setPinning(false);
 }
 };

 const deleteTopic = async () => {
 setPendingDelete(null);
 setDeletingTarget("topic");
 setModerationError(null);
 try {
 await fetchApi(`/community/topics/${topicId}`, { method: "DELETE" });
 router.push("/community");
 } catch (err) {
 setModerationError({ target: "topic", text: moderationErrorText(err) });
 setDeletingTarget(null);
 }
 };

 const deleteReply = async (post: ForumPost) => {
 setPendingDelete(null);
 setDeletingTarget(post.id);
 setModerationError(null);
 try {
 await fetchApi(`/community/topics/${topicId}/posts/${post.id}`, { method: "DELETE" });
 await loadTopic();
 } catch (err) {
 setModerationError({ target: post.id, text: moderationErrorText(err) });
 } finally {
 setDeletingTarget(null);
 }
 };

 if (loading) {
 return (
 <div className="min-h-screen bg-background text-text-muted flex items-center justify-center text-sm font-mono">
 {t("community.topicStreamLoading")}
 </div>
 );
 }

 if (!topic) {
 return (
 <div className="min-h-screen bg-background flex flex-col">
 <Navbar />
 {loadError === "not_found" || loadError === "invalid" ? (
 <DetailNotFound title={t("common.notFoundTopic")} />
 ) : (
 <DetailUnavailable kind={loadError === "rate_limited" ? "rate_limited" : "unavailable"} onRetry={() => void loadTopic()} />
 )}
 </div>
 );
 }

 const board = getBoardSync(topic.board_code, boards);
 const totalPostsCount = posts.length;
 const firstPost = posts.find((p) => p.post_number === 1) || null;
 const replies = posts.filter((p) => p.post_number > 1).sort((a, b) => a.post_number - b.post_number);
 const opPost: ForumPost | null = firstPost;

 return (
 <div className="min-h-screen bg-background relative flex flex-col overflow-clip selection:bg-primary selection:text-white pb-24 text-sm">
 <div className="absolute inset-0 bg-radial-vignette opacity-70 pointer-events-none" aria-hidden />
 <div className="absolute -top-40 -left-40 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[140px] pointer-events-none" aria-hidden />
 <div className="absolute -bottom-40 -right-40 w-[600px] h-[600px] bg-sky-500/10 rounded-full blur-[140px] pointer-events-none" aria-hidden />
 <Navbar />

 <PageShell width="page">
 <div className="flex flex-col lg:flex-row gap-6 items-start">
 {/* Left / Main Post Stream */}
 <div className="flex-1 space-y-6 w-full min-w-0">
 {/* Topic Header */}
 <div className="space-y-3 border-b border-line-subtle pb-4">
 <div className="flex items-center space-x-2 flex-wrap gap-2">
 <Link
 href="/community"
 className="text-text-muted hover:text-emphasis flex items-center space-x-1 font-mono text-sm"
 >
 <ArrowLeft className="w-4 h-4" />
 <span>{t("nav.community")}</span>
 </Link>
 <span className="text-gray-600">/</span>
 <span
 className={`inline-flex items-center space-x-1 px-2.5 py-1 rounded border text-xs font-mono ${board.bgColor} ${board.borderColor} ${board.color}`}
 >
 <span className={`w-1.5 h-1.5 rounded-full ${board.color.replace('text-', 'bg-')}`} />
 <span>{boardDisplayName(board, locale, t)}</span>
 </span>
 {topic.tags && topic.tags.length > 0 && (
 <span className="flex items-center gap-2 flex-wrap">
 {topic.tags.map((tg) => (
 <Link
 key={tg.id}
 href={`/community?tag=${encodeURIComponent(tg.name)}`}
 className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-success-soft hover:bg-emerald-500/20 text-xs font-mono transition-colors duration-fast ease-soft"
 >
 <TagIcon className="w-4 h-4" />
 {tg.name}
 </Link>
 ))}
 </span>
 )}
 </div>

 <h1 className="text-xl font-bold text-emphasis leading-snug tracking-tight">
 {topic.title}
 </h1>

 {/* 锚定实体横幅：标题与 kind 由后端经模块边界补齐，未锚定则不渲染 */}
 {topic.entity_id && topic.entity_title && (
 <div className="p-4 rounded-lg bg-surface border border-line flex items-center justify-between gap-4">
 <div className="flex items-center space-x-3 truncate">
 <div className="truncate">
 <span className="text-xs font-mono text-success block">
 {t("community.linkedWork")}
 </span>
 <strong className="text-emphasis text-sm block truncate">{topic.entity_title}</strong>
 </div>
 </div>

 <Link
 href={catalogEntityHref(topic.entity_kind || "work", topic.entity_id)}
 className="px-3 py-1.5 rounded bg-background hover:bg-surfaceBorder border border-line text-text-body hover:text-emphasis flex items-center space-x-1 flex-shrink-0 transition-colors duration-fast ease-soft"
 >
 <span>{t("community.viewArchive")}</span>
 <ArrowRight className="w-4 h-4" />
 </Link>
 </div>
 )}
 </div>

 {/* Post #1: Topic Original Post (Discourse Post Stream Item) */}
 <div id={`post-${opPost?.post_number ?? 1}`} className="border border-line rounded-lg bg-surface p-4 sm:p-5 space-y-3.5 shadow-2xs">
 {/* Post Author Header */}
 <div className="flex items-center justify-between border-b border-line-subtle pb-2.5">
 <div className="flex items-center space-x-2.5">
 {(opPost?.user_id || topic.user_id || opPost?.user?.id || topic.user?.id) ? (
 <Link
 href={`/users/${opPost?.user_id || topic.user_id || opPost?.user?.id || topic.user?.id}`}
 className="shrink-0 hover:opacity-90 transition-all duration-base ease-soft"
 >
 <UserAvatar user={opPost?.user || topic.user} size="sm" shape="rounded" />
 </Link>
 ) : (
 <div className="shrink-0">
 <UserAvatar user={opPost?.user || topic.user} size="sm" shape="rounded" />
 </div>
 )}
 <div>
 <div className="flex items-center space-x-2">
 {(opPost?.user_id || topic.user_id || opPost?.user?.id || topic.user?.id) ? (
 <Link
 href={`/users/${opPost?.user_id || topic.user_id || opPost?.user?.id || topic.user?.id}`}
 className="font-bold text-text-strong text-sm hover:text-primary transition-colors duration-fast ease-soft"
 >
 {opPost?.user?.username || topic.user?.username || t("community.anonymous")}
 </Link>
 ) : (
 <span className="font-bold text-text-strong text-sm">{opPost?.user?.username || topic.user?.username || t("community.anonymous")}</span>
 )}
 <UserRoleBadge role={opPost?.user?.role || topic.user?.role} t={t} />
 </div>
 <span className="text-xs text-text-faint font-mono">
 {new Date(opPost?.created_at || topic.created_at).toLocaleString()}
 </span>
 </div>
 </div>

 <div className="flex items-center space-x-2.5">
 {canPinTopic && (
 <button
 onClick={togglePin}
 disabled={pinning}
 className={`flex items-center space-x-1 transition-colors duration-fast ease-soft disabled:opacity-50 disabled:cursor-not-allowed ${topic.is_pinned ? "text-warn hover:text-warn-soft" : "text-text-faint hover:text-warn"}`}
 >
 {topic.is_pinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
 <span>
 {pinning
 ? t("community.pinning")
 : topic.is_pinned
 ? t("community.unpinTopic")
 : t("community.pinTopic")}
 </span>
 </button>
 )}
 {canModeratePosts && (
 <button
 onClick={() => setPendingDelete({ kind: "topic" })}
 disabled={deletingTarget === "topic"}
 className="flex items-center space-x-1 text-text-faint hover:text-danger transition-colors duration-fast ease-soft disabled:opacity-50 disabled:cursor-not-allowed"
 >
 <Trash2 className="w-4 h-4" />
 <span>{deletingTarget === "topic" ? t("community.deleting") : t("community.deleteTopic")}</span>
 </button>
 )}
 <span className="text-text-faint font-mono text-sm">#{opPost?.post_number ?? 1}</span>
 </div>
 </div>
 {moderationError?.target === "topic" && (
 <p className="text-xs text-danger font-mono">{moderationError.text}</p>
 )}
 {pinNotice && <p className="text-xs font-mono text-warn">{pinNotice}</p>}

   {/* Post Body */}
   <div className="py-1">
     <MarkdownRenderer content={opPost?.content || topic.content} />
   </div>

 {/* Discourse Post Action Bar */}
 <div className="flex items-center justify-between pt-2.5 border-t border-line-subtle text-text-faint">
 <div className="flex items-center space-x-3.5">
 <button
 onClick={() => toggleLike(opPost?.id || topic.id)}
 className={`flex items-center space-x-1 hover:text-danger transition-colors duration-fast ease-soft ${
 likedPosts[opPost?.id || topic.id] ? "text-danger font-bold" : ""
 }`}
 >
 <Heart className={`w-4 h-4 ${likedPosts[opPost?.id || topic.id] ? "fill-rose-400" : ""}`} />
 <span>{likedPosts[opPost?.id || topic.id] ? "1" : t("common.like")}</span>
 </button>

 <button
 onClick={() => handleShare(opPost?.id || topic.id)}
 className="flex items-center space-x-1 hover:text-primary transition-colors duration-fast ease-soft"
 >
 {shareFeedback[opPost?.id || topic.id] ? <Check className="w-4 h-4 text-success" /> : <Share2 className="w-4 h-4" />}
 <span>{shareFeedback[opPost?.id || topic.id] || t("common.share")}</span>
 </button>

 <button
 onClick={() => openReply(opPost || { id: topic.id, post_number: 1, user: topic.user, content: topic.content } as ForumPost)}
 className="flex items-center space-x-1 hover:text-primary transition-colors duration-fast ease-soft"
 >
 <Reply className="w-4 h-4" />
 <span>{t("common.reply")}</span>
 </button>
 </div>

 <span className="text-xs text-text-faint font-mono">
 {t("work.detail.viewCount", { count: topic.view_count })}
 </span>
 </div>
 </div>

 {/* Replies Stream */}
 {/* key 随楼层数变化：发帖/删帖后回复流重放一次进入动画，输入与点赞不触发 */}
 <TabPanel activeKey={"replies-" + posts.length} spacing="none" className="space-y-3">
 {replies.map((post) => {
 const replyUserId = post.user_id || post.user?.id;
 return (
 <div
 key={post.id}
 id={`post-${post.post_number}`}
 className="border border-line rounded-lg bg-surface p-4 sm:p-5 space-y-3.5 shadow-2xs"
 >
 {post.reply_to_post_number && (
 <div className="flex items-center gap-2 px-2.5 py-1 rounded-sm bg-amber-500/10 border border-amber-500/20 text-warn text-xs font-mono">
 <span>↳</span>
 <span>{tr("community.replyToPost", `Reply to #${post.reply_to_post_number}`, { n: post.reply_to_post_number })}</span>
 </div>
 )}
 <div className="flex items-center justify-between border-b border-line-subtle pb-2.5">
 <div className="flex items-center space-x-2.5">
 {replyUserId ? (
 <Link
 href={`/users/${replyUserId}`}
 className="shrink-0 hover:opacity-90 transition-all duration-base ease-soft"
 >
 <UserAvatar user={post.user} size="sm" shape="rounded" />
 </Link>
 ) : (
 <div className="shrink-0">
 <UserAvatar user={post.user} size="sm" shape="rounded" />
 </div>
 )}
 <div>
 <div className="flex items-center space-x-2">
 {replyUserId ? (
 <Link
 href={`/users/${replyUserId}`}
 className="font-bold text-text-strong text-sm hover:text-primary transition-colors duration-fast ease-soft"
 >
 {post.user?.username || t("community.anonymous")}
 </Link>
 ) : (
 <span className="font-bold text-text-strong text-sm">{post.user?.username || t("community.anonymous")}</span>
 )}
 <UserRoleBadge role={post.user?.role} t={t} />
 </div>
 <span className="text-xs text-text-faint font-mono">
 {new Date(post.created_at).toLocaleString()}
 </span>
 </div>
 </div>

 <div className="flex items-center space-x-2.5">
 {/* 自己的楼层沿用原有通道，治理按钮只用于处置他人回复 */}
 {canModeratePosts && replyUserId && replyUserId !== user?.id && (
 <button
 onClick={() => setPendingDelete({ kind: "reply", post })}
 disabled={deletingTarget === post.id}
 className="flex items-center space-x-1 text-text-faint hover:text-danger transition-colors duration-fast ease-soft disabled:opacity-50 disabled:cursor-not-allowed"
 >
 <Trash2 className="w-4 h-4" />
 <span>{deletingTarget === post.id ? t("community.deleting") : t("community.deleteReply")}</span>
 </button>
 )}
 <span className="text-text-faint font-mono text-sm">#{post.post_number}</span>
 </div>
 </div>
 {moderationError?.target === post.id && (
 <p className="text-xs text-danger font-mono">{moderationError.text}</p>
 )}

   <div className="py-1">
     <MarkdownRenderer content={post.content} />
   </div>

 {/* Post Actions */}
 <div className="flex items-center justify-between pt-2.5 border-t border-line-subtle text-text-faint">
 <div className="flex items-center space-x-3.5">
 <button
 onClick={() => toggleLike(post.id)}
 className={`flex items-center space-x-1 hover:text-danger transition-colors duration-fast ease-soft ${
 likedPosts[post.id] ? "text-danger font-bold" : ""
 }`}
 >
 <Heart className={`w-4 h-4 ${likedPosts[post.id] ? "fill-rose-400" : ""}`} />
 <span>{likedPosts[post.id] ? "1" : t("common.like")}</span>
 </button>

 <button
 onClick={() => handleShare(post.id, post.id)}
 className="flex items-center space-x-1 hover:text-primary transition-colors duration-fast ease-soft"
 >
 {shareFeedback[post.id] ? <Check className="w-4 h-4 text-success" /> : <Share2 className="w-4 h-4" />}
 <span>{shareFeedback[post.id] || t("common.share")}</span>
 </button>

 <button
 onClick={() => openReply(post)}
 className="flex items-center space-x-1 hover:text-primary transition-colors duration-fast ease-soft"
 >
 <Reply className="w-4 h-4" />
 <span>{t("common.reply")}</span>
 </button>
 </div>
 </div>
 </div>
 );
 })}
 </TabPanel>

 {/* Bottom CTA / Composer anchor */}
 <div id="reply-box" className="border border-line rounded-lg bg-surface p-4 space-y-2.5 shadow-2xs">
 <h3 className="font-bold text-text-strong text-sm flex items-center space-x-1.5">
 <Reply className="w-4 h-4 text-primary" />
 <span>{t("community.replyTopic")}</span>
 </h3>

 {user ? (
 <div className="space-y-2.5">
 <p className="text-sm text-text-faint font-mono">{t("community.replyPlaceholder")}</p>
 <button
 onClick={openTopicReply}
 className="w-full sm:w-auto px-3.5 h-10 max-sm:min-h-[44px] bg-primary text-white font-bold rounded-md hover:opacity-90 flex items-center justify-center space-x-1.5 transition-opacity text-sm"
 >
 <Reply className="w-4 h-4" />
 <span>{t("community.replyTopic")}</span>
 </button>
 </div>
 ) : (
 <div className="p-4 text-center text-text-faint bg-background rounded-md border border-line text-sm">
 {t("community.loginToReply")}
 </div>
 )}
 </div>
 </div>

 {/* Right: Discourse Signature Timeline Navigator (Desktop) */}
 <div className="hidden lg:block w-64 sticky top-[calc(var(--mf-header-h)+1.25rem)] space-y-3.5 flex-shrink-0">
 <div className="border border-line rounded-lg bg-surface p-4.5 space-y-3 font-mono text-sm shadow-2xs">
 <div className="flex items-center justify-between text-text-faint border-b border-line pb-2">
 <span className="font-bold text-text-strong">{t("community.timelineNav")}</span>
 <span>{t("community.floors", { count: totalPostsCount })}</span>
 </div>

 {topic.tags && topic.tags.length > 0 && (
 <div className="space-y-1">
 <span className="text-xs tracking-widest font-bold text-text-faint uppercase">{t("community.tags")}</span>
 <div className="flex flex-wrap gap-2">
 {topic.tags.map((tg) => (
 <Link
 key={tg.id}
 href={`/community?tag=${encodeURIComponent(tg.name)}`}
 className="px-2.5 py-1 rounded-sm bg-background border border-line text-text-body hover:text-primary flex items-center gap-2 text-xs"
 >
 <TagIcon className="w-2.5 h-2.5 text-primary" />
 <span>#{tg.name}</span>
 </Link>
 ))}
 </div>
 </div>
 )}

 {/* Progress bar */}
 <div className="space-y-1 py-1">
 <div className="flex justify-between text-xs text-text-faint">
 <span>{new Date(topic.created_at).toLocaleDateString()}</span>
 <span>{t("community.latest")}</span>
 </div>
 <div className="w-full h-1 bg-background rounded-full overflow-hidden">
 <div
 className="h-full bg-primary transition-all duration-base ease-soft"
 style={{ width: `${Math.min(100, Math.max(10, (posts.length / 20) * 100))}%` }}
 />
 </div>
 </div>

 {/* Quick Jump Buttons */}
 <div className="pt-2 border-t border-line space-y-1">
 <button
 onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
 className="w-full text-left py-1 px-2.5 rounded-md hover:bg-black/[0.03] hover:bg-surfaceSubtle text-text-faint hover:text-gray-900 dark:hover:text-white flex items-center justify-between transition-colors duration-fast ease-soft text-xs"
 >
 <span>{t("community.topJump")}</span>
 <span>#1</span>
 </button>
 <button
 onClick={() => {
 const el = document.getElementById(`post-${posts[posts.length - 1]?.post_number}`);
 el?.scrollIntoView({ behavior: 'smooth' });
 }}
 className="w-full text-left py-1 px-2.5 rounded-md hover:bg-black/[0.03] hover:bg-surfaceSubtle text-text-faint hover:text-gray-900 dark:hover:text-white flex items-center justify-between transition-colors duration-fast ease-soft text-xs"
 >
 <span>{t("community.bottomJump")}</span>
 <span>#{posts[posts.length - 1]?.post_number || 1}</span>
 </button>
 </div>
 </div>
 </div>
 </div>
 </PageShell>

 {/* Reply Drawer — unified PostComposer */}
 {isComposerOpen && (
 <PostComposer
 mode="reply"
 topicId={topicId}
 quotedPost={replyTo}
 boards={boards}
 availableTags={[]}
 expanded={composerExpanded}
 onExpandedChange={setComposerExpanded}
 locale={locale}
 t={t}
 onSuccess={() => {
 loadTopic();
 setIsComposerOpen(false);
 setReplyTo(null);
 }}
 onClose={() => {
 setIsComposerOpen(false);
 setReplyTo(null);
 }}
 />
 )}
 {/* 删除是破坏性动作：确认框自绘（原生 confirm 不可本地化、不可样式化，也只测得到个布尔），
 并把被删对象写进说明——主题带标题、回复带作者。 */}
 {pendingDelete && (
 <ConfirmDialog
 open
 title={pendingDelete.kind === "topic" ? t("community.deleteTopic") : t("community.deleteReply")}
 message={
 pendingDelete.kind === "topic"
 ? t("community.deleteTopicConfirm", { title: topic?.title ?? "" })
 : t("community.deleteReplyConfirm", { author: pendingDelete.post.user?.username || t("community.anonymous") })
 }
 confirmLabel={t("common.delete")}
 busy={deletingTarget !== null}
 onClose={() => setPendingDelete(null)}
 onConfirm={() => {
 if (pendingDelete.kind === "topic") void deleteTopic();
 else void deleteReply(pendingDelete.post);
 }}
 />
 )}
 </div>
 );
}
