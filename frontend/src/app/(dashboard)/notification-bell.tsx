"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

interface NotificationItem {
  id: string;
  actor_id: string;
  actor_name: string;
  actor_avatar?: string;
  group_id: string;
  group_name: string;
  message_id: string;
  message_content: string;
  type: "unread" | "mention" | "reply";
  is_read: boolean;
  created_at: string;
}

export default function NotificationBell() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"unreads" | "mentions">("unreads");
  const [unreads, setUnreads] = useState<NotificationItem[]>([]);
  const [mentions, setMentions] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = async () => {
    try {
      setLoading(true);
      const [uRes, mRes] = await Promise.all([
        api.get<NotificationItem[]>("/notifications/unreads").catch(() => []),
        api.get<NotificationItem[]>("/notifications/mentions").catch(() => []),
      ]);
      setUnreads(uRes || []);
      setMentions(mRes || []);
    } catch (err) {
      console.error("Failed to fetch notifications", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 15000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const totalUnreadCount = unreads.length + mentions.filter((m) => !m.is_read).length;

  const handleNotificationClick = async (item: NotificationItem) => {
    try {
      await api.post("/notifications/read", { notificationIds: [item.id] });
      setUnreads((prev) => prev.filter((n) => n.id !== item.id));
      setMentions((prev) =>
        prev.map((n) => (n.id === item.id ? { ...n, is_read: true } : n))
      );
    } catch (err) {
      console.error("Failed to mark notification as read", err);
    }
    setIsOpen(false);
    router.push(`/groups/${item.group_id}/chat`);
  };

  const markAllRead = async () => {
    try {
      await api.post("/notifications/read", {});
      setUnreads([]);
      setMentions((prev) => prev.map((n) => ({ ...n, is_read: true })));
    } catch (err) {
      console.error("Failed to mark all as read", err);
    }
  };

  return (
    <div className="relative" ref={menuRef}>
      {/* Bell / Inbox Icon Button */}
      <button
        onClick={() => {
          setIsOpen(!isOpen);
          if (!isOpen) fetchNotifications();
        }}
        className="relative p-2 text-surface-600 hover:text-surface-900 rounded-lg hover:bg-surface-100 transition-colors"
        title="Notifications"
      >
        <svg
          className="w-5 h-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.75}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>
        {totalUnreadCount > 0 && (
          <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            {totalUnreadCount > 9 ? "9+" : totalUnreadCount}
          </span>
        )}
      </button>

      {/* Notifications Popover */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white border border-surface-200 rounded-xl shadow-lg z-50 overflow-hidden flex flex-col max-h-[480px]">
          {/* Header & Tabs */}
          <div className="p-3 border-b border-surface-100 flex items-center justify-between bg-surface-50/50">
            <div className="flex gap-2">
              <button
                onClick={() => setActiveTab("unreads")}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                  activeTab === "unreads"
                    ? "bg-white text-surface-900 shadow-sm border border-surface-200"
                    : "text-surface-500 hover:text-surface-700"
                }`}
              >
                Unreads ({unreads.length})
              </button>
              <button
                onClick={() => setActiveTab("mentions")}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                  activeTab === "mentions"
                    ? "bg-white text-surface-900 shadow-sm border border-surface-200"
                    : "text-surface-500 hover:text-surface-700"
                }`}
              >
                Mentions ({mentions.filter((m) => !m.is_read).length})
              </button>
            </div>

            <button
              onClick={markAllRead}
              className="text-[11px] font-medium text-brand-600 hover:underline"
            >
              Mark all read
            </button>
          </div>

          {/* List Content */}
          <div className="flex-1 overflow-y-auto divide-y divide-surface-100">
            {loading ? (
              <div className="p-4 text-center text-xs text-surface-400">Loading notifications...</div>
            ) : activeTab === "unreads" ? (
              unreads.length === 0 ? (
                <div className="p-6 text-center text-xs text-surface-400">No unread messages.</div>
              ) : (
                unreads.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => handleNotificationClick(item)}
                    className="p-3 hover:bg-surface-50 cursor-pointer transition-colors flex items-start gap-3"
                  >
                    <div className="w-8 h-8 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center font-bold text-xs shrink-0">
                      {item.actor_name?.charAt(0).toUpperCase() || "U"}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1 mb-0.5">
                        <span className="text-xs font-semibold text-surface-900 truncate">
                          {item.group_name}
                        </span>
                        <span className="text-[10px] text-surface-400 shrink-0">
                          {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-xs text-surface-600 truncate">
                        <span className="font-medium text-surface-800">{item.actor_name}: </span>
                        {item.message_content}
                      </p>
                    </div>
                  </div>
                ))
              )
            ) : mentions.length === 0 ? (
              <div className="p-6 text-center text-xs text-surface-400">No mentions or replies.</div>
            ) : (
              mentions.map((item) => (
                <div
                  key={item.id}
                  onClick={() => handleNotificationClick(item)}
                  className={`p-3 hover:bg-surface-50 cursor-pointer transition-colors flex items-start gap-3 ${
                    !item.is_read ? "bg-brand-50/40" : ""
                  }`}
                >
                  <div className="w-8 h-8 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center font-bold text-xs shrink-0">
                    {item.type === "mention" ? "@" : "↩"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                      <span className="text-xs font-semibold text-surface-900 truncate">
                        {item.actor_name} {item.type === "mention" ? "mentioned you" : "replied to you"} in {item.group_name}
                      </span>
                      <span className="text-[10px] text-surface-400 shrink-0">
                        {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-xs text-surface-600 truncate">{item.message_content}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
