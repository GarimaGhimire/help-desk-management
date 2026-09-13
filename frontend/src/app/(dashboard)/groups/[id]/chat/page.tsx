"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { useWebSocket } from "@/lib/websocket";
import { api, getCurrentUserId, assetUrl } from "@/lib/api";
import { Avatar } from "@/components/avatar";

interface Message {
  id: string;
  groupId: string;
  senderId: string;
  content: string;
  createdAt: string;
  senderName?: string;
  senderAvatar?: string;
  senderRole?: string;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDay(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Today";
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
}

export default function ChatPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [cooldown, setCooldown] = useState(0);
  const [cooldownTotal, setCooldownTotal] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cooldownUntil = useRef(0);
  const myId = getCurrentUserId();

  const onMessage = useCallback((data: unknown) => {
    const m = data as Message;
    // Server-enforced anti-spam feedback.
    if (m && "error" in m && (m as { error?: string }).error === "slow_down") {
      const retry = Number((m as { retry_after?: number }).retry_after) || 1;
      const remaining = Math.max(retry, 1);
      cooldownUntil.current = Date.now() + remaining * 1000;
      setCooldownTotal(remaining);
      setCooldown(remaining);
      return;
    }
    if (!m?.content) return;
    setMessages((prev) => {
      if (prev.some((p) => p.id === m.id)) return prev;
      return [...prev, m];
    });
  }, []);

  const { isConnected, send } = useWebSocket(`/messages/ws?groupId=${id}`, { onMessage });

  useEffect(() => {
    api.get<Message[]>(`/messages/${id}`)
      .then(setMessages)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!cooldown) {
      cooldownUntil.current = 0;
      return;
    }
    const timer = setInterval(() => {
      const left = Math.ceil((cooldownUntil.current - Date.now()) / 1000);
      if (left <= 0) {
        setCooldown(0);
        setCooldownTotal(0);
        cooldownUntil.current = 0;
      } else {
        setCooldown(left);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const sendMessage = () => {
    if (!input.trim() || cooldown > 0) return;
    send({ groupId: id, content: input.trim() });
    setInput("");
    inputRef.current?.focus();
  };

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)] max-w-4xl mx-auto w-full">
      <header className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-surface-900">Group Chat</h1>
        <div className="flex items-center gap-2 bg-white rounded-full border border-surface-200 pl-2.5 pr-3 py-1">
          <span className={`w-2 h-2 rounded-full ${isConnected ? "bg-emerald-500" : "bg-red-400"} animate-pulse`} />
          <span className="text-xs text-surface-500">
            {isConnected ? t.chat.connected : t.chat.reconnecting}
          </span>
        </div>
      </header>

      <div
        ref={listRef}
        className="flex-1 overflow-y-auto mb-4 px-1 py-6 bg-white rounded-2xl border border-surface-200 shadow-card"
      >
        {loading && (
          <div className="space-y-4 px-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className={`flex items-end gap-2.5 ${i % 2 ? "" : "flex-row-reverse"}`}>
                <div className="w-8 h-8 rounded-full bg-surface-100 animate-pulse" />
                <div className={`h-9 ${i % 2 ? "w-2/3" : "w-1/2"} rounded-2xl animate-pulse bg-surface-100`} />
              </div>
            ))}
          </div>
        )}

        {!loading && messages.length === 0 && (
          <div className="text-center py-20">
            <div className="w-14 h-14 rounded-2xl bg-surface-100 mx-auto mb-4 flex items-center justify-center text-surface-400">
              <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
              </svg>
            </div>
            <p className="text-sm text-surface-400">{t.chat.noMessages}</p>
          </div>
        )}

        {!loading &&
          messages.length > 0 &&
          messages.map((m, i) => {
            const mine = m.senderId === myId;
            const name = mine ? "You" : m.senderName || `Staff ${m.senderId.slice(0, 4)}`;
            const src = mine ? null : assetUrl(m.senderAvatar || null);
            const showDate =
              i === 0 ||
              new Date(m.createdAt).toDateString() !==
                new Date(messages[i - 1].createdAt).toDateString();
            const showHeader =
              !mine && (i === 0 || messages[i - 1].senderId !== m.senderId);

            return (
              <div key={m.id || i}>
                {showDate && (
                  <div className="flex justify-center my-5">
                    <span className="text-[11px] px-3 py-1 rounded-full bg-surface-100 border border-surface-100 text-surface-500">
                      {formatDay(m.createdAt)}
                    </span>
                  </div>
                )}

                {mine ? (
                  <div className="flex justify-end px-3 mb-1.5">
                    <div className="max-w-[70%] flex flex-col items-end">
                      <div className="px-4 py-2.5 rounded-2xl rounded-br-md bg-primary-600 text-white text-sm leading-relaxed shadow-sm">
                        {m.content}
                        <span className="block text-[10px] mt-1 text-primary-200">
                          {formatTime(m.createdAt)}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex justify-start px-3 mb-1.5 gap-2.5">
                    <Avatar src={src} name={name} size="sm" className="mt-0.5" />
                    <div className="max-w-[70%] flex flex-col items-start min-w-0">
                      {showHeader && (
                        <span className="text-xs font-semibold text-surface-600 mb-1 ml-1">
                          {name}
                          {m.senderRole && m.senderRole !== "org_member" ? (
                            <span className="text-[10px] font-medium text-surface-400 normal-case ml-1.5">
                              • {m.senderRole.replace("_", " ")}
                            </span>
                          ) : null}
                        </span>
                      )}
                      <div className="px-4 py-2.5 rounded-2xl rounded-bl-md bg-white text-surface-800 border border-surface-200 text-sm leading-relaxed">
                        {m.content}
                        <span className="block text-[10px] mt-1 text-surface-400">
                          {formatTime(m.createdAt)}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
      </div>

      <div className="space-y-2">
        {cooldown > 0 && (
          <div className="rounded-xl bg-surface-100 border border-surface-200 px-3.5 py-2.5 flex items-center gap-3 animate-fade-in">
            <div className="relative w-7 h-7 shrink-0">
              <svg className="w-7 h-7 text-surface-200" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <circle
                  className="text-primary-500"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeDasharray="62.83"
                  strokeDashoffset={62.83 * (1 - cooldown / Math.max(cooldownTotal, 1))}
                  transform="rotate(-90 12 12)"
                />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-surface-700">
                {t.chat.tooFast} · {t.chat.retryIn} {cooldown}
                {t.chat.seconds}
              </p>
              <div className="mt-1.5 h-1 rounded-full bg-surface-200 overflow-hidden">
                <div
                  key={cooldownTotal}
                  className="h-full rounded-full bg-primary-500 animate-progress"
                  style={{ animationDuration: `${Math.max(cooldownTotal, 1)}s` }}
                />
              </div>
            </div>
          </div>
        )}

        <div className="flex gap-2 items-center bg-white rounded-2xl border border-surface-200 p-2 shadow-card">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
            disabled={cooldown > 0}
            placeholder={cooldown > 0 ? `${t.chat.retryIn} ${cooldown}${t.chat.seconds}…` : t.chat.typeMessage}
            className="flex-1 px-3 py-2 rounded-xl text-sm placeholder:text-surface-400 bg-transparent focus:outline-none disabled:opacity-60"
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || !isConnected || cooldown > 0}
            className="p-2.5 rounded-xl bg-primary-600 text-white hover:bg-primary-700 active:scale-[0.96] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            title={t.chat.send}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}