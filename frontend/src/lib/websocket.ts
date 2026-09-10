"use client";

import { useEffect, useRef, useCallback, useState } from "react";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8080";

function getWSToken(): string {
  if (typeof document === "undefined") return "";
  const match = document.cookie.match(/token=([^;]+)/);
  return match ? match[1] : "";
}

interface UseWebSocketOptions {
  onMessage?: (data: unknown) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (error: Event) => void;
}

export function useWebSocket(path: string, options: UseWebSocketOptions = {}) {
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const reconnectTimeout = useRef<ReturnType<typeof setTimeout>>();
  const optionsRef = useRef(options);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const connect = useCallback(() => {
    const token = getWSToken();
    if (!token) return;

    const sep = path.includes("?") ? "&" : "?";
    const ws = new WebSocket(`${WS_URL}${path}${sep}token=${token}`);

    ws.onopen = () => {
      setIsConnected(true);
      optionsRef.current.onOpen?.();
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        optionsRef.current.onMessage?.(data);
      } catch {
        optionsRef.current.onMessage?.(event.data);
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      optionsRef.current.onClose?.();
      reconnectTimeout.current = setTimeout(connect, 3000);
    };

    ws.onerror = (error) => {
      optionsRef.current.onError?.(error);
    };

    wsRef.current = ws;
  }, [path]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimeout.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const send = useCallback((data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  return { isConnected, send };
}