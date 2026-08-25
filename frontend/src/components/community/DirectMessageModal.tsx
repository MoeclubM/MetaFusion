"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  fetchDirectMessages,
  sendDirectMessage,
  DirectMessage,
} from "@/lib/api";
import { UserAvatar } from "@/components/UserAvatar";
import { UserRoleBadge } from "@/lib/roles";
import { useAuth } from "@/lib/authContext";
import { useI18n } from "@/i18n/I18nProvider";
import {
  MessageCircle,
  Send,
  X,
  Clock,
  Loader2,
  Check,
  CheckCheck,
} from "lucide-react";

interface DirectMessageModalProps {
  peerUser: {
    id: string;
    username: string;
    role: string;
    avatar_url?: string;
    bio?: string;
    created_at: string;
  };
  isOpen: boolean;
  onClose: () => void;
}

export default function DirectMessageModal({
  peerUser,
  isOpen,
  onClose,
}: DirectMessageModalProps) {
  const { user } = useAuth();
  const { t, locale } = useI18n();
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [inputContent, setInputContent] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = (smooth = true) => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({
        behavior: smooth ? "smooth" : "auto",
        block: "end",
      });
    }
  };

  const loadMessages = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetchDirectMessages(peerUser.id, 1, 100);
      setMessages(res.messages || []);
      if (!silent) {
        setTimeout(() => scrollToBottom(false), 50);
      }
    } catch (e: any) {
      if (!silent) setErr(e.message || "Failed to load messages");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && peerUser?.id) {
      loadMessages(false);
      const timer = setInterval(() => {
        loadMessages(true);
      }, 3500);
      return () => clearInterval(timer);
    }
  }, [isOpen, peerUser?.id]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = inputContent.trim();
    if (!trimmed || sending) return;

    setSending(true);
    setErr("");
    try {
      const newMsg = await sendDirectMessage(peerUser.id, trimmed);
      setMessages((prev) => [...prev, newMsg]);
      setInputContent("");
      setTimeout(() => scrollToBottom(true), 50);
    } catch (e: any) {
      setErr(e.message || t("auth.requestFailed"));
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
      <div
        className="w-full max-w-lg bg-surface border border-white/10 rounded-2xl shadow-2xl flex flex-col h-[600px] max-h-[90vh] overflow-hidden animate-scale-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 bg-surface/90 border-b border-white/10 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <UserAvatar user={peerUser} size="md" shape="circle" ring />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-white text-sm truncate">
                  {peerUser.username}
                </span>
                <UserRoleBadge role={peerUser.role} t={t} />
              </div>
              <span className="text-[10px] text-gray-400 font-mono flex items-center gap-1">
                <Clock className="w-2.5 h-2.5" />
                {t("users.profile.registeredAt")}:{" "}
                {new Date(peerUser.created_at).toLocaleDateString(
                  locale === "zh-CN" ? "zh-CN" : "en-US"
                )}
              </span>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
            title={t("users.profile.closeChat")}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Message Stream */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-background/50">
          {loading ? (
            <div className="h-full flex items-center justify-center text-gray-500 font-mono text-xs gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              <span>{t("common.loading")}</span>
            </div>
          ) : messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-gray-500 space-y-2">
              <div className="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-gray-400">
                <MessageCircle className="w-6 h-6" />
              </div>
              <p className="text-xs">{t("users.profile.noMessages")}</p>
            </div>
          ) : (
            messages.map((msg) => {
              const isMe = msg.sender_id === user?.id;
              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-xs whitespace-pre-wrap leading-relaxed shadow-sm ${
                      isMe
                        ? "bg-primary text-white rounded-tr-xs"
                        : "bg-surface border border-white/10 text-gray-200 rounded-tl-xs"
                    }`}
                  >
                    {msg.content}
                  </div>
                  <div className="flex items-center gap-1 mt-1 px-1 text-[10px] font-mono text-gray-500">
                    <span>
                      {new Date(msg.created_at).toLocaleTimeString(
                        locale === "zh-CN" ? "zh-CN" : "en-US",
                        { hour: "2-digit", minute: "2-digit" }
                      )}
                    </span>
                    {isMe && (
                      <span className="flex items-center" title={msg.is_read ? t("users.profile.read") : t("users.profile.unread")}>
                        {msg.is_read ? (
                          <CheckCheck className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <Check className="w-3 h-3 text-gray-500" />
                        )}
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Error message */}
        {err && (
          <div className="px-4 py-1.5 bg-rose-500/20 border-t border-rose-500/30 text-rose-300 text-xs font-mono">
            {err}
          </div>
        )}

        {/* Input area */}
        <form
          onSubmit={handleSend}
          className="p-3.5 bg-surface border-t border-white/10 flex items-end gap-2.5 shrink-0"
        >
          <textarea
            ref={inputRef}
            rows={2}
            value={inputContent}
            onChange={(e) => setInputContent(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("users.profile.typeMessage")}
            className="flex-1 px-3.5 py-2.5 bg-background border border-white/10 rounded-xl text-white text-sm placeholder-gray-500 focus:outline-none focus:border-primary resize-none font-sans leading-relaxed"
          />
          <button
            type="submit"
            disabled={!inputContent.trim() || sending}
            className="h-11 px-4.5 rounded-xl bg-primary hover:opacity-90 disabled:opacity-40 text-white text-sm font-bold flex items-center justify-center gap-1.5 transition-all shrink-0 shadow-soft cursor-pointer"
          >
            {sending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            <span className="hidden sm:inline">
              {sending ? t("users.profile.sending") : t("users.profile.send")}
            </span>
          </button>
        </form>
      </div>
    </div>
  );
}
