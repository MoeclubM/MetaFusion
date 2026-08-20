"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { fetchApi, DiscussionTopic, ForumPost, ForumBoard, fetchBoards, FORUM_BOARDS, getBoardSync, boardDisplayName, shareContent, buildShareUrl } from "@/lib/api";
import PostComposer from "@/components/community/PostComposer";
import { useAuth } from "@/lib/authContext";
import { useI18n } from "@/i18n/I18nProvider";
import {
  ArrowLeft,
  Eye,
  Send,
  BookOpen,
  ArrowRight,
  Heart,
  Share2,
  Reply,
  ChevronUp,
  ChevronDown,
  Check,
  Tag as TagIcon,
} from "lucide-react";

export default function TopicDetailPage() {
  const params = useParams();
  const topicId = params.id as string;

  const { user } = useAuth();
  const { t, locale } = useI18n();
  const [topic, setTopic] = useState<DiscussionTopic | null>(null);
  const [posts, setPosts] = useState<ForumPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [likedPosts, setLikedPosts] = useState<Record<string, boolean>>({});
  const [shareFeedback, setShareFeedback] = useState<Record<string, string>>({});
  const [boards, setBoards] = useState<ForumBoard[]>(FORUM_BOARDS);
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [composerExpanded, setComposerExpanded] = useState(false);
  const [replyTo, setReplyTo] = useState<{ post_number: number; username?: string; content: string } | null>(null);

  useEffect(() => { fetchBoards().then(setBoards).catch(()=>{}); }, []);

  const loadTopic = async () => {
    setLoading(true);
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
      console.error(err);
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

  if (loading) {
    return (
      <div className="min-h-screen bg-background text-gray-400 flex items-center justify-center text-xs font-mono">
        {t("community.topicStreamLoading")}
      </div>
    );
  }

  if (!topic) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <Navbar />
        <div className="max-w-4xl mx-auto px-4 py-20 text-center text-xs text-gray-500">
          {t("common.notFoundTopic")}
        </div>
      </div>
    );
  }

  const board = getBoardSync(topic.board_code, boards);
  const totalPostsCount = posts.length;
  const firstPost = posts.find((p) => p.post_number === 1) || null;
  const replies = posts.filter((p) => p.post_number > 1).sort((a, b) => a.post_number - b.post_number);
  const opPost: ForumPost | null = firstPost;

  return (
    <div className="min-h-screen flex flex-col pb-24 bg-background text-xs">
      <Navbar />

      <main className="max-w-7xl mx-auto px-4 py-6 w-full flex-1">
        <div className="flex flex-col lg:flex-row gap-6 items-start">
          {/* Left / Main Post Stream */}
          <div className="flex-1 space-y-6 w-full min-w-0">
            {/* Topic Header */}
            <div className="space-y-3 border-b border-surfaceBorder pb-4">
              <div className="flex items-center space-x-2 flex-wrap gap-1">
                <Link
                  href="/community"
                  className="text-gray-400 hover:text-white flex items-center space-x-1 font-mono text-[11px]"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>{t("nav.community")}</span>
                </Link>
                <span className="text-gray-600">/</span>
                <span
                  className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded border text-[10px] font-mono ${board.bgColor} ${board.borderColor} ${board.color}`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${board.color.replace('text-', 'bg-')}`} />
                  <span>{boardDisplayName(board, locale, t)}</span>
                </span>
                {topic.tags && topic.tags.length > 0 && (
                  <span className="flex items-center gap-1.5 flex-wrap">
                    {topic.tags.map((tg) => (
                      <Link
                        key={tg.id}
                        href={`/community?tag=${encodeURIComponent(tg.name)}`}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 hover:bg-emerald-500/20 text-[10px] font-mono transition-colors"
                      >
                        <TagIcon className="w-3 h-3" />
                        {tg.name}
                      </Link>
                    ))}
                  </span>
                )}
              </div>

              <h1 className="text-xl font-bold text-white leading-snug tracking-tight">
                {topic.title}
              </h1>

              {/* Linked Work Reference Banner */}
              {topic.work && (
                <div className="p-3 rounded-lg bg-surface border border-surfaceBorder flex items-center justify-between gap-4">
                  <div className="flex items-center space-x-3 truncate">
                    {topic.work.cover_image_url && (
                      <img
                        src={topic.work.cover_image_url}
                        alt={topic.work.title}
                        className="w-10 h-14 object-cover rounded border border-surfaceBorder flex-shrink-0"
                      />
                    )}
                    <div className="truncate">
                      <span className="text-[10px] font-mono text-emerald-400 block">
                        {t("community.linkedWork")}
                      </span>
                      <strong className="text-white text-xs block truncate">{topic.work.title}</strong>
                      <span className="text-[10px] text-gray-500 font-mono">
                        {(topic.work.category ? topic.work.category.name || (locale==="en-US"? topic.work.category.name_en : topic.work.category.name_zh) : topic.work.media_type)}
                      </span>
                    </div>
                  </div>

                  <Link
                    href={`/works/${topic.work.id}`}
                    className="px-3 py-1.5 rounded bg-background hover:bg-surfaceBorder border border-surfaceBorder text-gray-300 hover:text-white flex items-center space-x-1 flex-shrink-0 transition-colors"
                  >
                    <span>{t("community.viewArchive")}</span>
                    <ArrowRight className="w-3 h-3" />
                  </Link>
                </div>
              )}
            </div>

            {/* Post #1: Topic Original Post (Discourse Post Stream Item) */}
            <div id={`post-${opPost?.post_number ?? 1}`} className="border border-surfaceBorder rounded-lg bg-surface p-4 sm:p-5 space-y-3.5 shadow-2xs">
              {/* Post Author Header */}
              <div className="flex items-center justify-between border-b border-surfaceBorder/60 pb-2.5">
                <div className="flex items-center space-x-2.5">
                  {(opPost?.user_id || topic.user_id || opPost?.user?.id || topic.user?.id) ? (
                    <Link
                      href={`/users/${opPost?.user_id || topic.user_id || opPost?.user?.id || topic.user?.id}`}
                      className="w-8 h-8 rounded-md bg-background border border-surfaceBorder flex items-center justify-center font-bold text-gray-900 dark:text-white text-xs hover:border-primary transition-all"
                    >
                      {(opPost?.user?.username || topic.user?.username) ? (opPost?.user?.username || topic.user!.username!).slice(0, 2).toUpperCase() : "OP"}
                    </Link>
                  ) : (
                    <div className="w-8 h-8 rounded-md bg-background border border-surfaceBorder flex items-center justify-center font-bold text-gray-900 dark:text-white text-xs">
                      {(opPost?.user?.username || topic.user?.username) ? (opPost?.user?.username || topic.user!.username!).slice(0, 2).toUpperCase() : "OP"}
                    </div>
                  )}
                  <div>
                    <div className="flex items-center space-x-2">
                      {(opPost?.user_id || topic.user_id || opPost?.user?.id || topic.user?.id) ? (
                        <Link
                          href={`/users/${opPost?.user_id || topic.user_id || opPost?.user?.id || topic.user?.id}`}
                          className="font-bold text-gray-900 dark:text-white text-xs hover:text-primary transition-colors"
                        >
                          {opPost?.user?.username || topic.user?.username || t("community.anonymous")}
                        </Link>
                      ) : (
                        <span className="font-bold text-gray-900 dark:text-white text-xs">{opPost?.user?.username || topic.user?.username || t("community.anonymous")}</span>
                      )}
                      <span className="px-1.5 py-0.2 rounded-sm bg-background border border-surfaceBorder text-[9px] font-mono text-amber-500">
                        {(opPost?.user?.role || topic.user?.role) === "admin" ? t("community.admin") : t("community.op")}
                      </span>
                    </div>
                    <span className="text-[10px] text-gray-500 font-mono">
                      {new Date(opPost?.created_at || topic.created_at).toLocaleString()}
                    </span>
                  </div>
                </div>

                <span className="text-gray-500 font-mono text-xs">#{opPost?.post_number ?? 1}</span>
              </div>

              {/* Post Body */}
              <div className="text-gray-700 dark:text-gray-200 text-xs leading-relaxed whitespace-pre-wrap font-sans py-0.5">
                {opPost?.content || topic.content}
              </div>

              {/* Discourse Post Action Bar */}
              <div className="flex items-center justify-between pt-2.5 border-t border-surfaceBorder/60 text-gray-500">
                <div className="flex items-center space-x-3.5">
                  <button
                    onClick={() => toggleLike(opPost?.id || topic.id)}
                    className={`flex items-center space-x-1 hover:text-rose-400 transition-colors ${
                      likedPosts[opPost?.id || topic.id] ? "text-rose-400 font-bold" : ""
                    }`}
                  >
                    <Heart className={`w-3.5 h-3.5 ${likedPosts[opPost?.id || topic.id] ? "fill-rose-400" : ""}`} />
                    <span>{likedPosts[opPost?.id || topic.id] ? "1" : t("common.like")}</span>
                  </button>

                  <button
                    onClick={() => handleShare(opPost?.id || topic.id)}
                    className="flex items-center space-x-1 hover:text-primary transition-colors"
                  >
                    {shareFeedback[opPost?.id || topic.id] ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Share2 className="w-3.5 h-3.5" />}
                    <span>{shareFeedback[opPost?.id || topic.id] || t("common.share")}</span>
                  </button>

                  <button
                    onClick={() => openReply(opPost || { id: topic.id, post_number: 1, user: topic.user, content: topic.content } as ForumPost)}
                    className="flex items-center space-x-1 hover:text-primary transition-colors"
                  >
                    <Reply className="w-3.5 h-3.5" />
                    <span>{t("common.reply")}</span>
                  </button>
                </div>

                <span className="text-[10px] text-gray-500 font-mono">
                  {t("work.detail.viewCount", { count: topic.view_count })}
                </span>
              </div>
            </div>

            {/* Replies Stream */}
            <div className="space-y-3">
              {replies.map((post) => {
                const replyUserId = post.user_id || post.user?.id;
                return (
                <div
                  key={post.id}
                  id={`post-${post.post_number}`}
                  className="border border-surfaceBorder rounded-lg bg-surface p-4 sm:p-5 space-y-3.5 shadow-2xs"
                >
                  {post.reply_to_post_number && (
                    <div className="flex items-center gap-1 px-2 py-1 rounded-sm bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] font-mono">
                      <span>↳</span>
                      <span>{t("community.replyToPost", { n: post.reply_to_post_number }) || `Reply to #${post.reply_to_post_number}`}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between border-b border-surfaceBorder/60 pb-2.5">
                    <div className="flex items-center space-x-2.5">
                      {replyUserId ? (
                        <Link
                          href={`/users/${replyUserId}`}
                          className="w-7.5 h-7.5 rounded-md bg-background border border-surfaceBorder flex items-center justify-center font-bold text-gray-900 dark:text-white text-xs hover:border-primary transition-all"
                        >
                          {post.user?.username ? post.user.username.slice(0, 2).toUpperCase() : "U"}
                        </Link>
                      ) : (
                        <div className="w-7.5 h-7.5 rounded-md bg-background border border-surfaceBorder flex items-center justify-center font-bold text-gray-900 dark:text-white text-xs">
                          {post.user?.username ? post.user.username.slice(0, 2).toUpperCase() : "U"}
                        </div>
                      )}
                      <div>
                        <div className="flex items-center space-x-2">
                          {replyUserId ? (
                            <Link
                              href={`/users/${replyUserId}`}
                              className="font-bold text-gray-900 dark:text-white text-xs hover:text-primary transition-colors"
                            >
                              {post.user?.username || t("community.anonymous")}
                            </Link>
                          ) : (
                            <span className="font-bold text-gray-900 dark:text-white text-xs">{post.user?.username || t("community.anonymous")}</span>
                          )}
                          <span className="text-[9px] text-gray-500 font-mono">
                            {post.user?.role === "admin" ? t("community.admin") : t("community.member")}
                          </span>
                        </div>
                        <span className="text-[10px] text-gray-500 font-mono">
                          {new Date(post.created_at).toLocaleString()}
                        </span>
                      </div>
                    </div>

                    <span className="text-gray-500 font-mono text-xs">#{post.post_number}</span>
                  </div>

                  <div className="text-gray-700 dark:text-gray-200 text-xs leading-relaxed whitespace-pre-wrap py-0.5">
                    {post.content}
                  </div>

                  {/* Post Actions */}
                  <div className="flex items-center justify-between pt-2.5 border-t border-surfaceBorder/60 text-gray-500">
                    <div className="flex items-center space-x-3.5">
                      <button
                        onClick={() => toggleLike(post.id)}
                        className={`flex items-center space-x-1 hover:text-rose-400 transition-colors ${
                          likedPosts[post.id] ? "text-rose-400 font-bold" : ""
                        }`}
                      >
                        <Heart className={`w-3.5 h-3.5 ${likedPosts[post.id] ? "fill-rose-400" : ""}`} />
                        <span>{likedPosts[post.id] ? "1" : t("common.like")}</span>
                      </button>

                      <button
                        onClick={() => handleShare(post.id, post.id)}
                        className="flex items-center space-x-1 hover:text-primary transition-colors"
                      >
                        {shareFeedback[post.id] ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Share2 className="w-3.5 h-3.5" />}
                        <span>{shareFeedback[post.id] || t("common.share")}</span>
                      </button>

                      <button
                        onClick={() => openReply(post)}
                        className="flex items-center space-x-1 hover:text-primary transition-colors"
                      >
                        <Reply className="w-3.5 h-3.5" />
                        <span>{t("common.reply")}</span>
                      </button>
                    </div>
                  </div>
                </div>
                );
              })}
            </div>

            {/* Bottom CTA / Composer anchor */}
            <div id="reply-box" className="border border-surfaceBorder rounded-lg bg-surface p-4 space-y-2.5 shadow-2xs">
              <h3 className="font-bold text-gray-900 dark:text-white text-xs flex items-center space-x-1.5">
                <Reply className="w-4 h-4 text-primary" />
                <span>{t("community.replyTopic")}</span>
              </h3>

              {user ? (
                <div className="space-y-2.5">
                  <p className="text-[11px] text-gray-500 font-mono">{t("community.replyPlaceholder")}</p>
                  <button
                    onClick={openTopicReply}
                    className="w-full sm:w-auto px-3.5 h-8 bg-primary text-white font-bold rounded-md hover:opacity-90 flex items-center justify-center space-x-1.5 transition-opacity text-xs"
                  >
                    <Reply className="w-3.5 h-3.5" />
                    <span>{t("community.replyTopic")}</span>
                  </button>
                </div>
              ) : (
                <div className="p-3 text-center text-gray-500 bg-background rounded-md border border-surfaceBorder text-xs">
                  {t("community.loginToReply")}
                </div>
              )}
            </div>
          </div>

          {/* Right: Discourse Signature Timeline Navigator (Desktop) */}
          <div className="hidden lg:block w-64 sticky top-20 space-y-3.5 flex-shrink-0">
            <div className="border border-surfaceBorder rounded-lg bg-surface p-3.5 space-y-3 font-mono text-[11px] shadow-2xs">
              <div className="flex items-center justify-between text-gray-500 border-b border-surfaceBorder pb-2">
                <span className="font-bold text-gray-900 dark:text-white">{t("community.timelineNav")}</span>
                <span>{t("community.floors", { count: totalPostsCount })}</span>
              </div>

              {topic.tags && topic.tags.length > 0 && (
                <div className="space-y-1">
                  <span className="text-[10px] tracking-widest font-bold text-gray-500 uppercase">{t("community.tags")}</span>
                  <div className="flex flex-wrap gap-1">
                    {topic.tags.map((tg) => (
                      <Link
                        key={tg.id}
                        href={`/community?tag=${encodeURIComponent(tg.name)}`}
                        className="px-1.5 py-0.5 rounded-sm bg-background border border-surfaceBorder text-gray-700 dark:text-gray-300 hover:text-primary flex items-center gap-1 text-[10px]"
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
                <div className="flex justify-between text-[10px] text-gray-500">
                  <span>{new Date(topic.created_at).toLocaleDateString()}</span>
                  <span>{t("community.latest")}</span>
                </div>
                <div className="w-full h-1 bg-background rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${Math.min(100, Math.max(10, (posts.length / 20) * 100))}%` }}
                  />
                </div>
              </div>

              {/* Quick Jump Buttons */}
              <div className="pt-2 border-t border-surfaceBorder space-y-1">
                <button
                  onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                  className="w-full text-left py-1 px-2 rounded-md hover:bg-black/[0.03] dark:hover:bg-white/[0.04] text-gray-500 hover:text-gray-900 dark:hover:text-white flex items-center justify-between transition-colors text-[10px]"
                >
                  <span>{t("community.topJump")}</span>
                  <span>#1</span>
                </button>
                <button
                  onClick={() => {
                    const el = document.getElementById(`post-${posts[posts.length - 1]?.post_number}`);
                    el?.scrollIntoView({ behavior: 'smooth' });
                  }}
                  className="w-full text-left py-1 px-2 rounded-md hover:bg-black/[0.03] dark:hover:bg-white/[0.04] text-gray-500 hover:text-gray-900 dark:hover:text-white flex items-center justify-between transition-colors text-[10px]"
                >
                  <span>{t("community.bottomJump")}</span>
                  <span>#{posts[posts.length - 1]?.post_number || 1}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>

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
    </div>
  );
}
