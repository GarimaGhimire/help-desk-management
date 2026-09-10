"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { useWebSocket } from "@/lib/websocket";
import { api, getCurrentUserId } from "@/lib/api";

interface Message {
  id: string;
  groupId: string;
  senderId: string;
  content: string;
  createdAt: string;
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
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const myId = getCurrentUserId();

  const onMessage = useCallback((data: unknown) => {
    const m = data as Message;
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
    inputRef.current?.focus();
  }, []);

  const sendMessage = () => {
    if (!input.trim()) return;
    send({ groupId: id, content: input.trim() });
    setInput("");
    inputRef.current?.focus();
  };

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)]">
      <header className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-surface-900">Group Chat</h1>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${isConnected ? "bg-emerald-500" : "bg-red-400"}`} />
          <span className="text-xs text-surface-500">{isConnected ? "Connected" : "Reconnecting..."}</span>
        </div>
      </header>

      <div
        ref={listRef}
        className="flex-1 overflow-y-auto mb-4 px-1 py-6 bg-surface-100/60 rounded-xl border border-surface-200"
      >
        {loading && (
          <div className="space-y-3 px-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className={`h-9 w-2/3 rounded-2xl animate-pulse ${i % 2 ? "" : "ml-auto"}`}>
                <div className="h-full rounded-2xl bg-surface-200/70" />
              </div>
            ))}
          </div>
        )}

        {!loading && messages.length === 0 && (
          <div className="text-center py-16">
            <p className="text-sm text-surface-400">No messages yet. Start the conversation!</p>
          </div>
        )}

        {!loading &&
          messages.length > 0 &&
          messages.map((m, i) => {
            const mine = m.senderId === myId;
            const senderName = mine ? "You" : `Staff ${m.senderId.slice(0, 4)}`;
            const showDate = i === 0 || new Date(m.createdAt).toDateString() !== new Date(messages[i - 1].createdAt).toDateString();

            return (
              <div key={m.id || i}>
                {showDate && (
                  <div className="flex justify-center my-4">
                    <span className="text-[11px] px-3 py-1 rounded-full bg-white border border-surface-200 text-surface-500">
                      {formatDay(m.createdAt)}
                    </span>
                  </div>
                )}
                <div className={`flex ${mine ? "justify-end" : "justify-start"} px-3 mb-1.5`}>
                  <div className={`max-w-[70%] ${mine ? "items-end" : "items-start"} flex flex-col`}>
                    {!mine && (
                      <span className="text-[11px] text-surface-400 mb-1 ml-2">{senderName}</span>
                    )}
                    <div
                      className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed shadow-sm ${
                        mine
                          ? "bg-primary-600 text-white rounded-br-md"
                          : "bg-white text-surface-800 border border-surface-200 rounded-bl-md"
                      }`}
                    >
                      {m.content}
                      <span className={`block text-[10px] mt-1 ${mine ? "text-primary-200" : "text-surface-400"}`}>
                        {formatTime(m.createdAt)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
      </div>

      <div className="flex gap-2 items-center">
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
          placeholder={t.chat.typeMessage}
          className="flex-1 px-4 py-2.5 rounded-xl border border-surface-200 text-sm placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition"
        />
        <button
          onClick={sendMessage}
          disabled={!input.trim() || !isConnected}
          className="p-2.5 rounded-xl bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          title="Send"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
          </svg>
        </button>
      </div>
    </div>
  );
}