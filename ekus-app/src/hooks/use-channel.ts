'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface ChannelReply {
  chat_id: string;
  text: string;
  files?: string[];
  timestamp: string;
}

export interface ChannelMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  files?: string[];
  timestamp: string;
  isThinking?: boolean;
}

const getBase = () => typeof window !== 'undefined' ? window.location.origin : '';

export function useChannel() {
  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [thinkingId, setThinkingId] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const thinkingStartRef = useRef<number | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const connectWs = useCallback(() => {
    const base = getBase();
    const wsUrl = base.replace(/^http/, 'ws') + '/api/channel/ws';

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      console.log('[Channel] WebSocket connected');
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'reply') {
          const reply = data as ChannelReply;
          setMessages(prev => [
            ...prev.filter(m => !(m.id === reply.chat_id && m.isThinking)),
            {
              id: reply.chat_id + '-reply',
              role: 'assistant',
              content: reply.text,
              files: reply.files,
              timestamp: reply.timestamp,
            },
          ]);
          setThinkingId(null);
          thinkingStartRef.current = null;
        }
      } catch (e) {
        console.error('[Channel] Parse error:', e);
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      console.log('[Channel] WebSocket disconnected, reconnecting...');
      reconnectRef.current = setTimeout(connectWs, 3000);
    };

    ws.onerror = (err) => {
      console.error('[Channel] WebSocket error:', err);
      ws.close();
    };
  }, []);

  useEffect(() => {
    connectWs();
    return () => {
      wsRef.current?.close();
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
    };
  }, [connectWs]);

  // Ping to keep alive
  useEffect(() => {
    const interval = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send('ping');
      }
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  // Poll for reply when WebSocket is not connected
  const pollForReply = useCallback((chatId: string) => {
    const base = getBase();
    let attempts = 0;
    const maxAttempts = 60; // 2 minutes max
    const interval = setInterval(async () => {
      attempts++;
      if (attempts > maxAttempts) {
        clearInterval(interval);
        return;
      }
      try {
        const resp = await fetch(`${base}/api/channel/reply/${chatId}`);
        if (resp.ok) {
          const data = await resp.json();
          if (data.text) {
            clearInterval(interval);
            setMessages(prev => [
              ...prev.filter(m => !(m.id === chatId && m.isThinking)),
              {
                id: chatId + '-reply',
                role: 'assistant',
                content: data.text,
                files: data.files,
                timestamp: data.timestamp,
              },
            ]);
            setThinkingId(null);
            thinkingStartRef.current = null;
          }
        }
      } catch {
        // ignore polling errors
      }
    }, 2000);
    return interval;
  }, []);

  const sendMessage = useCallback(async (text: string, files?: string[], sessionId?: string) => {
    const base = getBase();
    const chatId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    const userMsg: ChannelMessage = {
      id: chatId + '-user',
      role: 'user',
      content: text,
      files,
      timestamp: new Date().toISOString(),
    };

    const thinkingMsg: ChannelMessage = {
      id: chatId,
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      isThinking: true,
    };

    setMessages(prev => [...prev, userMsg, thinkingMsg]);
    setThinkingId(chatId);
    thinkingStartRef.current = Date.now();

    try {
      const resp = await fetch(`${base}/api/channel/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, session_id: sessionId, files }),
      });
      const data = await resp.json();

      if (!resp.ok) {
        throw new Error(data.detail || 'Failed to send message');
      }

      const serverChatId = data.chat_id;

      // Update thinking placeholder with real chat_id from server
      setMessages(prev => prev.map(m =>
        m.id === chatId ? { ...m, id: serverChatId } : m
      ));
      setThinkingId(serverChatId);

      // Always start polling as fallback (WebSocket delivery will race with it)
      const pollInterval = pollForReply(serverChatId);

      // Clean up polling if WebSocket delivers the reply first
      const cleanup = () => {
        clearInterval(pollInterval);
      };
      // Store cleanup so WebSocket handler can call it
      if (wsRef.current) {
        const origHandler = wsRef.current.onmessage;
        wsRef.current.onmessage = (event) => {
          try {
            const d = JSON.parse(event.data);
            if (d.type === 'reply' && d.chat_id === serverChatId) {
              cleanup();
            }
          } catch { /* ignore */ }
          origHandler?.call(wsRef.current!, event);
        };
      }

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setMessages(prev => [
        ...prev.filter(m => m.id !== chatId),
        {
          id: chatId + '-error',
          role: 'assistant',
          content: `Error: ${message}. Channel may be unavailable — try the legacy job mode.`,
          timestamp: new Date().toISOString(),
        },
      ]);
      setThinkingId(null);
      thinkingStartRef.current = null;
    }
  }, [pollForReply]);

  const addErrorMessage = useCallback((text: string) => {
    setMessages(prev => [...prev, {
      id: Date.now().toString(36) + '-error',
      role: 'assistant',
      content: `Error: ${text}`,
      timestamp: new Date().toISOString(),
    }]);
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setThinkingId(null);
  }, []);

  const loadHistory = useCallback(async (sessionId: string) => {
    const base = getBase();
    try {
      const resp = await fetch(`${base}/api/channel/history/${sessionId}`);
      const data = await resp.json();
      if (data.messages && data.messages.length > 0) {
        const loaded: ChannelMessage[] = data.messages.map((m: { chat_id: string; role: 'user' | 'assistant'; content: string; files?: string[]; timestamp: string }) => ({
          id: m.chat_id + (m.role === 'assistant' ? '-reply' : '-user'),
          role: m.role,
          content: m.content,
          files: m.files,
          timestamp: m.timestamp,
        }));
        setMessages(loaded);
      } else {
        setMessages([]);
      }
    } catch {
      setMessages([]);
    }
  }, []);

  return {
    messages,
    sendMessage,
    addErrorMessage,
    clearMessages,
    loadHistory,
    isConnected,
    thinkingId,
    thinkingStart: thinkingStartRef.current,
  };
}
