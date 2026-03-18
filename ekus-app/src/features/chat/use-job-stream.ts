'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '@/lib/api';

interface UseJobStreamResult {
  output: string;
  jobId: string | null;  // Which job this output belongs to
  status: 'connecting' | 'streaming' | 'completed' | 'failed' | 'idle';
  isStreaming: boolean;
}

/**
 * Streams job output via WebSocket (terminal server on :7601) with SSE fallback.
 * WebSocket gives real-time token-by-token output from stream-json.
 * SSE reads from the log file (works when terminal server is down).
 */
export function useJobStream(jobId: string | null, initialStatus?: string): UseJobStreamResult {
  const [output, setOutput] = useState('');
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<UseJobStreamResult['status']>('idle');
  const statusRef = useRef<UseJobStreamResult['status']>('idle');
  const offsetRef = useRef(0);
  const wsRef = useRef<WebSocket | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const updateStatus = useCallback((s: UseJobStreamResult['status']) => {
    statusRef.current = s;
    setStatus(s);
  }, []);

  const cleanup = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!jobId || (initialStatus && initialStatus !== 'running')) {
      setStatus('idle');
      setCurrentJobId(null);
      return;
    }

    updateStatus('connecting');
    setOutput('');
    setCurrentJobId(jobId);
    offsetRef.current = 0;

    // Try WebSocket first (terminal server on port 7601)
    const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
    const wsUrl = `ws://${host}:7601?jobId=${jobId}`;
    let wsConnected = false;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    // If WebSocket doesn't connect within 3s, fall back to SSE
    const wsTimeout = setTimeout(() => {
      if (!wsConnected) {
        ws.close();
        wsRef.current = null;
        connectSSE();
      }
    }, 3000);

    ws.onopen = () => {
      clearTimeout(wsTimeout);
      wsConnected = true;
      updateStatus('streaming');
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'output') {
          const text = data.content ?? '';
          setOutput((prev) => prev + text);
          updateStatus('streaming');
        } else if (data.type === 'done') {
          updateStatus(data.exitCode === 0 ? 'completed' : 'failed');
          cleanup();
        } else if (data.type === 'error') {
          // Terminal server says job not found — try SSE
          ws.close();
          wsRef.current = null;
          connectSSE();
        }
      } catch {
        // Non-JSON, treat as raw text
        setOutput((prev) => prev + event.data);
        updateStatus('streaming');
      }
    };

    ws.onerror = () => {
      clearTimeout(wsTimeout);
      if (!wsConnected) {
        wsRef.current = null;
        connectSSE();
      }
    };

    ws.onclose = (e) => {
      clearTimeout(wsTimeout);
      if (!wsConnected) {
        wsRef.current = null;
        connectSSE();
      } else if (e.code !== 1000 && e.code !== 1005 && statusRef.current === 'streaming') {
        // Lost connection mid-stream — fall back to SSE with current offset
        wsRef.current = null;
        connectSSE();
      }
    };

    // SSE fallback (reads from log file via gateway)
    function connectSSE() {
      if (eventSourceRef.current) return;
      const es = api.streamJob(jobId!, offsetRef.current);
      eventSourceRef.current = es;

      es.onopen = () => {
        updateStatus('streaming');
      };

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'output') {
            const text = data.content ?? data.text ?? '';
            setOutput((prev) => prev + text);
            offsetRef.current += text.length;
            updateStatus('streaming');
          } else if (data.type === 'status') {
            if (data.status === 'completed') {
              updateStatus('completed');
              cleanup();
            } else if (data.status === 'failed') {
              updateStatus('failed');
              cleanup();
            }
          } else if (data.type === 'done') {
            updateStatus('completed');
            cleanup();
          }
        } catch {
          setOutput((prev) => prev + event.data);
          offsetRef.current += event.data.length;
          updateStatus('streaming');
        }
      };

      es.onerror = () => {
        cleanup();
        setTimeout(() => {
          if (statusRef.current === 'streaming' || statusRef.current === 'connecting') {
            connectSSE();
          }
        }, 2000);
      };
    }

    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, initialStatus]);

  return {
    output,
    jobId: currentJobId,
    status,
    isStreaming: status === 'streaming' || status === 'connecting',
  };
}
