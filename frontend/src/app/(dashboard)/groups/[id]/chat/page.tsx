"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { useWebSocket } from "@/lib/websocket";
import { api, getCurrentUserId, assetUrl, getAuthUser } from "@/lib/api";
import { Avatar } from "@/components/avatar";

interface Message {
  id: string;
  groupId: string;
  senderId: string;
  content: string;
  createdAt: string;
  editedAt?: string;
  isDeleted?: boolean;
  senderName?: string;
  senderAvatar?: string;
  senderRole?: string;
  replyTo?: {
    id: string;
    senderName: string;
    content: string;
  };
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

interface GroupMember {
  id: string;
  group_id: string;
  user_id: string;
  role_in_group: string;
  joined_at: string;
  user_name: string;
  email?: string;
  phone?: string;
}

interface UserOption {
  id: string;
  name: string;
  email?: string;
  role: string;
}

interface UserGroup {
  id: string;
  name: string;
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
  const [userRole, setUserRole] = useState<string | null>(null);

  // Message actions states (Reply, Edit, Forward, Delete)
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");

  // Custom Delete Modal State
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [targetDeleteId, setTargetDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Forward Modal State
  const [forwardModalOpen, setForwardModalOpen] = useState(false);
  const [forwardMessageId, setForwardMessageId] = useState<string | null>(null);
  const [availableGroups, setAvailableGroups] = useState<UserGroup[]>([]);
  const [selectedTargetGroupIds, setSelectedTargetGroupIds] = useState<string[]>([]);
  const [forwarding, setForwarding] = useState(false);
  const [forwardError, setForwardError] = useState("");

  // Group members management state
  const [membersModalOpen, setMembersModalOpen] = useState(false);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [allUsers, setAllUsers] = useState<UserOption[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [addingMember, setAddingMember] = useState(false);
  const [memberError, setMemberError] = useState("");

  const [groupName, setGroupName] = useState<string>("");

  useEffect(() => {
    setUserRole(getAuthUser()?.role || null);
    api.get<{ id: string; name: string }>(`/groups/${id}`)
      .then((g) => setGroupName(g.name))
      .catch(() => {});
  }, [id]);

  const fetchMembers = useCallback(async () => {
    setLoadingMembers(true);
    setMemberError("");
    try {
      const data = await api.get<GroupMember[]>(`/groups/${id}/members`);
      setMembers(data);
    } catch {
      setMemberError("Failed to load group members.");
    } finally {
      setLoadingMembers(false);
    }
  }, [id]);

  const fetchAllUsers = useCallback(async () => {
    try {
      const users = await api.get<UserOption[]>("/users");
      setAllUsers(users);
    } catch {
      // ignore
    }
  }, []);

  const openMembersModal = () => {
    setMembersModalOpen(true);
    fetchMembers();
    fetchAllUsers();
  };

  const handleAddMember = async () => {
    if (!selectedUserId) return;
    setAddingMember(true);
    setMemberError("");
    try {
      await api.post(`/groups/${id}/members`, {
        user_id: selectedUserId,
        role_in_group: "member",
      });
      setSelectedUserId("");
      await fetchMembers();
    } catch (err) {
      setMemberError(err instanceof Error ? err.message : "Failed to add member");
    } finally {
      setAddingMember(false);
    }
  };

  const handleRemoveMember = async (userId: string) => {
    setMemberError("");
    try {
      await api.delete(`/groups/${id}/members/${userId}`);
      await fetchMembers();
    } catch (err) {
      setMemberError(err instanceof Error ? err.message : "Failed to remove member");
    }
  };

  // Real-time WebSocket Handler for new messages, edits, & soft deletions
  const onMessage = useCallback((data: unknown) => {
    const payload = data as any;
    if (!payload) return;

    if (payload.error === "slow_down") {
      const retry = Number(payload.retry_after) || 1;
      const remaining = Math.max(retry, 1);
      cooldownUntil.current = Date.now() + remaining * 1000;
      setCooldownTotal(remaining);
      setCooldown(remaining);
      return;
    }

    if (payload.type === "edit") {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === payload.id
            ? { ...m, content: payload.content, editedAt: payload.editedAt }
            : m
        )
      );
      return;
    }

    if (payload.type === "delete") {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === payload.id
            ? { ...m, content: payload.content || "🚫 Original message was deleted", isDeleted: true }
            : m
        )
      );
      return;
    }

    if (payload.content || payload.type === "chat") {
      setMessages((prev) => {
        if (prev.some((p) => p.id === payload.id)) return prev;
        return [...prev, payload];
      });
    }
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

  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<
    { url: string; name: string; size: number; is_image: boolean }[]
  >([]);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [isDraggingModal, setIsDraggingModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (!files.length) return;

    if (pendingAttachments.length + files.length > 5) {
      setUploadError("Maximum 5 files can be attached at once.");
      return;
    }

    const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB
    for (const f of files) {
      if (f.size > MAX_FILE_SIZE) {
        setUploadError(`"${f.name}" exceeds the maximum limit of 15MB.`);
        return;
      }
    }

    setUploadingFile(true);
    setUploadError("");

    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append("file", file);

        const res = await api.post<{
          url: string;
          name: string;
          size: number;
          is_image: boolean;
        }>("/messages/upload", formData);

        setPendingAttachments((prev) => [...prev, res]);
      }
      setUploadModalOpen(false);
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : "Failed to upload file."
      );
    } finally {
      setUploadingFile(false);
    }
  };

  const removePendingAttachment = (index: number) => {
    setPendingAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    if (e.clipboardData.files && e.clipboardData.files.length > 0) {
      e.preventDefault();
      handleFileUpload(e.clipboardData.files);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingModal(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingModal(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingModal(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files);
    }
  };

  const sendMessage = () => {
    if ((!input.trim() && pendingAttachments.length === 0) || cooldown > 0)
      return;

    let content = input.trim();
    if (pendingAttachments.length > 0) {
      const attachmentText = pendingAttachments
        .map((att) =>
          att.is_image
            ? `![${att.name}](${att.url})`
            : `[${att.name}](${att.url})`
        )
        .join("\n");
      content = content ? `${content}\n\n${attachmentText}` : attachmentText;
    }

    const payload: { groupId: string; content: string; replyToId?: string } = {
      groupId: id,
      content,
    };
    if (replyingTo) {
      payload.replyToId = replyingTo.id;
    }

    send(payload);
    setInput("");
    setPendingAttachments([]);
    setReplyingTo(null);
    inputRef.current?.focus();
  };

  // Edit Message Handler
  const startEditing = (m: Message) => {
    setEditingMessageId(m.id);
    setEditingContent(m.content);
  };

  const saveEdit = async (msgId: string) => {
    if (!editingContent.trim()) return;
    try {
      await api.patch(`/messages/${msgId}`, { content: editingContent.trim() });
      setEditingMessageId(null);
      setEditingContent("");
    } catch {
      alert("Failed to edit message");
    }
  };

  // Custom Delete Modal Trigger & Action
  const promptDeleteMessage = (msgId: string) => {
    setTargetDeleteId(msgId);
    setDeleteModalOpen(true);
  };

  const confirmDeleteMessage = async () => {
    if (!targetDeleteId) return;
    setDeleting(true);
    try {
      await api.delete(`/messages/${targetDeleteId}`);
      setDeleteModalOpen(false);
      setTargetDeleteId(null);
    } catch {
      alert("Failed to delete message");
    } finally {
      setDeleting(false);
    }
  };

  // Forward Message Handlers
  const openForwardModal = async (msgId: string) => {
    setForwardMessageId(msgId);
    setForwardModalOpen(true);
    setSelectedTargetGroupIds([]);
    setForwardError("");
    try {
      const groups = await api.get<UserGroup[]>("/groups");
      setAvailableGroups(groups.filter((g) => g.id !== id));
    } catch {
      setForwardError("Failed to load chat groups.");
    }
  };

  const handleForwardSubmit = async () => {
    if (!forwardMessageId || selectedTargetGroupIds.length === 0) return;
    setForwarding(true);
    setForwardError("");
    try {
      await api.post("/messages/forward", {
        messageId: forwardMessageId,
        targetGroupIds: selectedTargetGroupIds,
      });
      setForwardModalOpen(false);
      setForwardMessageId(null);
    } catch (err) {
      setForwardError(err instanceof Error ? err.message : "Failed to forward message");
    } finally {
      setForwarding(false);
    }
  };

  const scrollToMessage = (msgId: string) => {
    const el = document.getElementById(`msg-${msgId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("bg-emerald-50/80", "transition-colors");
      setTimeout(() => el.classList.remove("bg-emerald-50/80"), 1500);
    }
  };

  return (
    <div
      className="flex flex-col h-[calc(100vh-7rem)] max-w-4xl mx-auto w-full relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDraggingModal && (
        <div className="absolute inset-0 z-40 bg-primary-950/80 backdrop-blur-sm rounded-2xl flex flex-col items-center justify-center border-2 border-dashed border-primary-400 text-white p-6 transition-all">
          <svg className="w-12 h-12 mb-2 animate-bounce" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
          <p className="text-base font-semibold">Drop files or images here to upload</p>
          <p className="text-xs text-surface-300 mt-1">Maximum 15MB per file • Up to 5 files</p>
        </div>
      )}

      <header className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-bold text-surface-900 flex items-center gap-2">
          <span>{groupName || "Group Chat"}</span>
        </h1>
        <div className="flex items-center gap-3">
          {userRole === "org_admin" && (
            <button
              onClick={openMembersModal}
              className="px-3 py-1.5 rounded-lg bg-surface-100 border border-surface-200 text-xs font-medium text-surface-700 hover:bg-surface-200 transition-colors flex items-center gap-1.5"
            >
              <svg className="w-4 h-4 text-surface-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
              </svg>
              Manage Members
            </button>
          )}
          <div className="flex items-center gap-2 bg-white rounded-full border border-surface-200 pl-2.5 pr-3 py-1">
            <span className={`w-2 h-2 rounded-full ${isConnected ? "bg-emerald-500" : "bg-red-400"} animate-pulse`} />
            <span className="text-xs text-surface-500">
              {isConnected ? t.chat.connected : t.chat.reconnecting}
            </span>
          </div>
        </div>
      </header>

      <div
        ref={listRef}
        className="flex-1 overflow-y-auto mb-4 px-1 py-6 bg-white rounded-2xl border border-surface-200 shadow-card space-y-3"
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
            const canManageMsg = mine || userRole === "org_admin" || userRole === "staff_admin" || userRole === "superadmin";
            const name = mine ? "You" : m.senderName || `Staff ${m.senderId.slice(0, 4)}`;
            const src = mine ? null : assetUrl(m.senderAvatar || null);
            const isDeletedMsg = m.isDeleted || m.content.startsWith("🚫") || m.content.includes("Original message was deleted");

            const showDate =
              i === 0 ||
              new Date(m.createdAt).toDateString() !==
                new Date(messages[i - 1].createdAt).toDateString();
            const showHeader =
              !mine && (i === 0 || messages[i - 1].senderId !== m.senderId);

            const renderMessageContent = (text: string) => {
              if (isDeletedMsg) {
                return (
                  <div className="flex items-center gap-1.5 italic text-surface-400 select-none py-0.5">
                    <span className="text-sm shrink-0">🚫</span>
                    <span>Original message was deleted</span>
                  </div>
                );
              }

              const lines = text.split("\n");
              return lines.map((line, idx) => {
                const imgMatch = line.match(/^!\[(.*?)\]\((.*?)\)$/);
                if (imgMatch) {
                  const alt = imgMatch[1];
                  const url = assetUrl(imgMatch[2]) || "#";
                  return (
                    <div key={idx} className="my-1.5">
                      <a href={url} target="_blank" rel="noopener noreferrer">
                        <img
                          src={url}
                          alt={alt}
                          className="max-w-xs max-h-60 rounded-lg object-cover border border-surface-200 hover:opacity-95 transition"
                        />
                      </a>
                    </div>
                  );
                }
                const fileMatch = line.match(/^\[(.*?)\]\((.*?)\)$/);
                if (fileMatch) {
                  const fileName = fileMatch[1];
                  const url = assetUrl(fileMatch[2]) || "#";
                  return (
                    <div key={idx} className="my-1">
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition ${
                          mine
                            ? "bg-primary-700/50 border-primary-500 text-white hover:bg-primary-700"
                            : "bg-surface-50 border-surface-200 text-surface-700 hover:bg-surface-100"
                        }`}
                      >
                        <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m.75 12h3.75m-3.75 3h6m-6-6h6m-1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                        </svg>
                        <span className="truncate max-w-[200px]">{fileName}</span>
                      </a>
                    </div>
                  );
                }
                return line ? <p key={idx}>{line}</p> : <br key={idx} />;
              });
            };

            return (
              <div key={m.id || i} id={`msg-${m.id}`} className="group relative transition-all rounded-xl p-0.5">
                {showDate && (
                  <div className="flex justify-center my-5">
                    <span className="text-[11px] px-3 py-1 rounded-full bg-surface-100 border border-surface-100 text-surface-500">
                      {formatDay(m.createdAt)}
                    </span>
                  </div>
                )}

                <div className={`flex items-start gap-2 ${mine ? "justify-end" : "justify-start"}`}>
                  {!mine && <Avatar src={src} name={name} size="sm" className="mt-1 shrink-0" />}

                  <div className={`max-w-[75%] flex flex-col ${mine ? "items-end" : "items-start"} min-w-0 relative`}>
                    {!mine && showHeader && (
                      <span className="text-xs font-semibold text-surface-600 mb-1 ml-1">
                        {name}
                        {m.senderRole && m.senderRole !== "org_member" ? (
                          <span className="text-[10px] font-medium text-surface-400 normal-case ml-1.5">
                            • {m.senderRole.replace("_", " ")}
                          </span>
                        ) : null}
                      </span>
                    )}

                    {/* WhatsApp Hover Action Menu (Hidden for soft-deleted messages) */}
                    {!isDeletedMsg && (
                      <div
                        className={`absolute top-0 -translate-y-2 flex items-center gap-1 bg-white border border-surface-200 shadow-md rounded-lg px-1.5 py-1 z-10 opacity-0 group-hover:opacity-100 transition-opacity ${
                          mine ? "right-full mr-2" : "left-full ml-2"
                        }`}
                      >
                        <button
                          onClick={() => setReplyingTo(m)}
                          className="p-1 text-surface-500 hover:text-emerald-600 hover:bg-surface-100 rounded transition-colors"
                          title="Reply"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 016 6v3" />
                          </svg>
                        </button>
                        <button
                          onClick={() => openForwardModal(m.id)}
                          className="p-1 text-surface-500 hover:text-blue-600 hover:bg-surface-100 rounded transition-colors"
                          title="Forward"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 15l6-6m0 0l-6-6m6 6H9a6 6 0 00-6 6v3" />
                          </svg>
                        </button>
                        {mine && (
                          <button
                            onClick={() => startEditing(m)}
                            className="p-1 text-surface-500 hover:text-primary-600 hover:bg-surface-100 rounded transition-colors"
                            title="Edit"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
                            </svg>
                          </button>
                        )}
                        {canManageMsg && (
                          <button
                            onClick={() => promptDeleteMessage(m.id)}
                            className="p-1 text-surface-500 hover:text-red-600 hover:bg-surface-100 rounded transition-colors"
                            title="Delete"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                            </svg>
                          </button>
                        )}
                      </div>
                    )}

                    {/* Chat Bubble Container */}
                    <div
                      className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed shadow-xs relative ${
                        isDeletedMsg
                          ? "bg-surface-100 text-surface-500 border border-surface-200/60 rounded-xl"
                          : mine
                          ? "rounded-br-md bg-primary-600 text-white"
                          : "rounded-bl-md bg-white text-surface-800 border border-surface-200"
                      }`}
                    >
                      {/* WhatsApp Quoted Reply Preview Inside Bubble */}
                      {m.replyTo && !isDeletedMsg && (
                        <div
                          onClick={() => m.replyTo?.id && scrollToMessage(m.replyTo.id)}
                          className={`mb-2 p-2 rounded-lg border-l-4 text-xs cursor-pointer transition-all ${
                            mine
                              ? "bg-black/20 border-emerald-300 text-white/90 hover:bg-black/30"
                              : "bg-surface-50 border-emerald-500 text-surface-700 hover:bg-surface-100"
                          }`}
                        >
                          <p className={`font-semibold ${mine ? "text-emerald-200" : "text-emerald-700"}`}>
                            {m.replyTo.senderName}
                          </p>
                          <p className="line-clamp-1 opacity-90">{m.replyTo.content}</p>
                        </div>
                      )}

                      {/* Message Content or Enhanced Inline Edit Box */}
                      {editingMessageId === m.id ? (
                        <div className="space-y-2.5 min-w-[280px] p-2 bg-white rounded-xl border-2 border-primary-400 shadow-sm text-surface-900 animate-fade-in">
                          <div className="flex items-center justify-between px-1">
                            <span className="text-[11px] font-semibold text-primary-700 flex items-center gap-1">
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
                              </svg>
                              Editing Message
                            </span>
                            <span className="text-[10px] text-surface-400">Enter to save • Shift+Enter for new line</span>
                          </div>
                          <textarea
                            value={editingContent}
                            onChange={(e) => setEditingContent(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                saveEdit(m.id);
                              }
                            }}
                            className="w-full text-xs p-2.5 rounded-lg border border-surface-200 text-surface-900 bg-surface-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 resize-none transition"
                            rows={2}
                            autoFocus
                          />
                          <div className="flex justify-end gap-2 pt-0.5">
                            <button
                              onClick={() => setEditingMessageId(null)}
                              className="px-3 py-1.5 rounded-lg bg-surface-100 border border-surface-200 text-surface-700 text-xs font-medium hover:bg-surface-200 transition"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => saveEdit(m.id)}
                              disabled={!editingContent.trim()}
                              className="px-3.5 py-1.5 rounded-lg bg-primary-600 text-white text-xs font-medium hover:bg-primary-700 active:scale-95 disabled:opacity-50 transition shadow-xs flex items-center gap-1.5"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                              </svg>
                              Save Changes
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          {renderMessageContent(m.content)}
                          {!isDeletedMsg && (
                            <div className="flex items-center justify-end gap-1 mt-1">
                              {m.editedAt && (
                                <span className={`text-[9px] ${mine ? "text-primary-200" : "text-surface-400"}`}>
                                  (edited)
                                </span>
                              )}
                              <span className={`text-[10px] ${mine ? "text-primary-200" : "text-surface-400"}`}>
                                {formatTime(m.createdAt)}
                              </span>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
      </div>

      <div className="space-y-2">
        {uploadError && (
          <div className="px-3 py-2 rounded-xl bg-red-50 text-red-700 text-xs border border-red-200 flex items-center justify-between">
            <span>{uploadError}</span>
            <button onClick={() => setUploadError("")} className="font-bold ml-2">×</button>
          </div>
        )}

        {/* Pending attachments preview area */}
        {pendingAttachments.length > 0 && (
          <div className="flex flex-wrap gap-2 p-2.5 bg-white rounded-xl border border-surface-200">
            {pendingAttachments.map((att, i) => (
              <div
                key={i}
                className="relative group flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-100 border border-surface-200 text-xs text-surface-700"
              >
                {att.is_image ? (
                  <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m.75 12h3.75m-3.75 3h6m-6-6h6m-1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                )}
                <span className="truncate max-w-[150px] font-medium">{att.name}</span>
                <button
                  onClick={() => removePendingAttachment(i)}
                  className="text-surface-400 hover:text-red-600 p-0.5 rounded-full"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

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

        {/* WhatsApp Style Reply Preview Bar above Input */}
        {replyingTo && (
          <div className="bg-surface-50 border-l-4 border-emerald-500 rounded-xl p-3 flex items-center justify-between shadow-xs border border-surface-200">
            <div className="min-w-0 pr-2">
              <div className="flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 text-emerald-600 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 016 6v3" />
                </svg>
                <span className="text-xs font-bold text-emerald-700">
                  Replying to {replyingTo.senderName || "Staff"}
                </span>
              </div>
              <p className="text-xs text-surface-600 truncate mt-0.5">{replyingTo.content}</p>
            </div>
            <button
              onClick={() => setReplyingTo(null)}
              className="text-surface-400 hover:text-surface-700 p-1 rounded-full shrink-0"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Input Controls Bar */}
        <div className="flex gap-1.5 items-center bg-white rounded-2xl border border-surface-200 p-2 shadow-card">
          <input
            type="file"
            ref={fileInputRef}
            onChange={(e) => {
              if (e.target.files) handleFileUpload(e.target.files);
              e.target.value = "";
            }}
            multiple
            className="hidden"
          />
          <button
            onClick={() => {
              setUploadError("");
              setUploadModalOpen(true);
            }}
            disabled={uploadingFile || cooldown > 0}
            className="p-2.5 rounded-xl text-surface-500 hover:text-primary-600 hover:bg-surface-100 active:scale-95 transition-all shrink-0 disabled:opacity-40"
            title="Upload files or photos (Dropbox)"
          >
            {uploadingFile ? (
              <div className="w-5 h-5 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            )}
          </button>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={handlePaste}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
            disabled={cooldown > 0}
            placeholder={
              replyingTo
                ? `Type reply to ${replyingTo.senderName || "Staff"}…`
                : cooldown > 0
                ? `${t.chat.retryIn} ${cooldown}${t.chat.seconds}…`
                : t.chat.typeMessage
            }
            className="flex-1 px-2 py-2 rounded-xl text-sm placeholder:text-surface-400 bg-transparent focus:outline-none disabled:opacity-60"
          />
          <button
            onClick={sendMessage}
            disabled={(!input.trim() && pendingAttachments.length === 0) || !isConnected || cooldown > 0 || uploadingFile}
            className="p-2.5 rounded-xl bg-primary-600 text-white hover:bg-primary-700 active:scale-[0.96] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            title={t.chat.send}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
          </button>
        </div>
      </div>

      {/* Custom Delete Confirmation Modal */}
      {deleteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !deleting && setDeleteModalOpen(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 border border-surface-200 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 mx-auto flex items-center justify-center border border-red-200">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
              </svg>
            </div>
            <div>
              <h3 className="text-base font-bold text-surface-900">Delete Message?</h3>
              <p className="text-xs text-surface-500 mt-1">
                Are you sure you want to delete this message? It will be replaced with <span className="font-semibold text-surface-700">'Original message was deleted'</span>.
              </p>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setDeleteModalOpen(false)}
                disabled={deleting}
                className="flex-1 py-2.5 rounded-xl border border-surface-200 text-surface-700 text-xs font-medium hover:bg-surface-50 transition"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteMessage}
                disabled={deleting}
                className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-xs font-semibold hover:bg-red-700 active:scale-95 disabled:opacity-50 transition shadow-sm flex items-center justify-center gap-1.5"
              >
                {deleting ? "Deleting..." : "Delete Message"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Forward Message Modal */}
      {forwardModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setForwardModalOpen(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 border border-surface-200">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-semibold text-surface-900">Forward Message</h3>
                <p className="text-xs text-surface-500 mt-0.5">Select target chat groups to forward this message</p>
              </div>
              <button onClick={() => setForwardModalOpen(false)} className="text-surface-400 hover:text-surface-600 p-1 rounded-lg">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {forwardError && (
              <div className="mb-4 px-3 py-2 rounded-xl bg-red-50 text-red-700 text-xs border border-red-200">
                {forwardError}
              </div>
            )}

            <div className="max-h-60 overflow-y-auto space-y-2 mb-5 pr-1">
              {availableGroups.length === 0 ? (
                <p className="text-xs text-surface-400 text-center py-6">No other chat groups available</p>
              ) : (
                availableGroups.map((g) => {
                  const selected = selectedTargetGroupIds.includes(g.id);
                  return (
                    <div
                      key={g.id}
                      onClick={() =>
                        setSelectedTargetGroupIds((prev) =>
                          selected ? prev.filter((gid) => gid !== g.id) : [...prev, g.id]
                        )
                      }
                      className={`flex items-center justify-between p-3 rounded-xl border text-xs cursor-pointer transition-all ${
                        selected
                          ? "border-primary-500 bg-primary-50/60 font-medium text-primary-900"
                          : "border-surface-200 hover:border-surface-300 bg-surface-50/50"
                      }`}
                    >
                      <span className="truncate">{g.name}</span>
                      <div className={`w-4 h-4 rounded border flex items-center justify-center ${selected ? "bg-primary-600 border-primary-600 text-white" : "border-surface-300"}`}>
                        {selected && (
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                          </svg>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-surface-200">
              <button
                onClick={() => setForwardModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-medium border border-surface-200 text-surface-600 hover:bg-surface-50"
              >
                Cancel
              </button>
              <button
                onClick={handleForwardSubmit}
                disabled={selectedTargetGroupIds.length === 0 || forwarding}
                className="px-4 py-2 rounded-xl text-xs font-medium bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 transition-colors"
              >
                {forwarding ? "Forwarding..." : `Forward (${selectedTargetGroupIds.length})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Upload Drop Box Modal */}
      {uploadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => !uploadingFile && setUploadModalOpen(false)}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 border border-surface-200">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-semibold text-surface-900">Upload Files & Photos</h3>
                <p className="text-xs text-surface-500 mt-0.5">Drag and drop files, paste from clipboard, or browse from your PC</p>
              </div>
              <button
                onClick={() => setUploadModalOpen(false)}
                disabled={uploadingFile}
                className="text-surface-400 hover:text-surface-600 p-1 rounded-lg"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {uploadError && (
              <div className="mb-4 px-3 py-2 rounded-xl bg-red-50 text-red-700 text-xs border border-red-200 flex items-center justify-between">
                <span>{uploadError}</span>
                <button onClick={() => setUploadError("")} className="font-bold ml-2">×</button>
              </div>
            )}

            <div
              onDragOver={(e) => { e.preventDefault(); setIsDraggingModal(true); }}
              onDragLeave={(e) => { e.preventDefault(); setIsDraggingModal(false); }}
              onDrop={(e) => {
                e.preventDefault();
                setIsDraggingModal(false);
                if (e.dataTransfer.files?.length) handleFileUpload(e.dataTransfer.files);
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all flex flex-col items-center justify-center ${
                isDraggingModal
                  ? "border-primary-500 bg-primary-50/60 scale-[0.99]"
                  : "border-surface-300 hover:border-primary-400 bg-surface-50/50 hover:bg-surface-50"
              }`}
            >
              {uploadingFile ? (
                <div className="py-4 flex flex-col items-center">
                  <div className="w-8 h-8 border-3 border-primary-600 border-t-transparent rounded-full animate-spin mb-2" />
                  <p className="text-xs font-medium text-surface-700">Uploading attachment...</p>
                </div>
              ) : (
                <>
                  <div className="w-12 h-12 rounded-full bg-primary-50 text-primary-600 flex items-center justify-center mb-3 shadow-sm">
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                    </svg>
                  </div>
                  <p className="text-sm font-semibold text-surface-800 mb-1">
                    Click to browse or drop files here
                  </p>
                  <p className="text-xs text-surface-400 mb-3">
                    Supports images, PDFs, documents, audio & video
                  </p>
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border border-surface-200 text-[11px] font-medium text-surface-600 shadow-xs">
                    <span>Shortcut: Paste files (Ctrl+V) anywhere</span>
                  </div>
                </>
              )}
            </div>

            <div className="mt-4 pt-3 border-t border-surface-200 flex justify-between items-center text-xs text-surface-400">
              <span>Max 15MB per file • Max 5 files batch</span>
              <button
                onClick={() => setUploadModalOpen(false)}
                className="px-4 py-2 rounded-lg border border-surface-200 text-surface-600 font-medium hover:bg-surface-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Group Members Modal (org_admin only) */}
      {membersModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setMembersModalOpen(false)} />
          <div className="relative bg-white rounded-xl border border-surface-200 shadow-xl w-full max-w-md p-6 mx-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-surface-900">Group Members & Permissions</h2>
              <button
                onClick={() => setMembersModalOpen(false)}
                className="text-surface-400 hover:text-surface-600 p-1 rounded-lg"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {memberError && (
              <div className="mb-4 px-3 py-2 rounded-lg bg-red-50 text-red-700 text-xs">{memberError}</div>
            )}

            {/* Add Member Form */}
            <div className="mb-4 pb-4 border-b border-surface-200">
              <label className="block text-xs font-medium text-surface-500 mb-1.5">Add Staff Member</label>
              <div className="flex gap-2">
                <select
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-lg border border-surface-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="">Select a staff member...</option>
                  {allUsers
                    .filter((u) => !members.some((m) => m.user_id === u.id))
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.email || u.role})
                      </option>
                    ))}
                </select>
                <button
                  onClick={handleAddMember}
                  disabled={!selectedUserId || addingMember}
                  className="px-3 py-2 rounded-lg bg-primary-600 text-white text-xs font-medium hover:bg-primary-700 disabled:opacity-50 transition-colors"
                >
                  {addingMember ? "Adding..." : "Add"}
                </button>
              </div>
            </div>

            {/* Member List */}
            <div>
              <h3 className="text-xs font-medium text-surface-500 mb-2">Current Members ({members.length})</h3>
              {loadingMembers ? (
                <div className="py-6 text-center text-xs text-surface-400">Loading members...</div>
              ) : members.length === 0 ? (
                <div className="py-4 text-center text-xs text-surface-400">No members in group</div>
              ) : (
                <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
                  {members.map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center justify-between p-2.5 rounded-lg border border-surface-100 bg-surface-50/50"
                    >
                      <div className="min-w-0 pr-2">
                        <p className="text-xs font-medium text-surface-800 truncate">{m.user_name}</p>
                        {m.email && <p className="text-[11px] text-surface-400 truncate">{m.email}</p>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] px-2 py-0.5 rounded bg-surface-200/70 text-surface-600 font-medium capitalize">
                          {m.role_in_group}
                        </span>
                        <button
                          onClick={() => handleRemoveMember(m.user_id)}
                          className="text-red-500 hover:text-red-700 text-xs font-medium p-1"
                          title="Remove from group"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-5 pt-3 border-t border-surface-200 flex justify-end">
              <button
                onClick={() => setMembersModalOpen(false)}
                className="px-4 py-2 rounded-lg text-xs font-medium border border-surface-200 text-surface-600 hover:bg-surface-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}