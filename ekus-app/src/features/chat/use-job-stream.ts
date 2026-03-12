'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '@/lib/api';

interface UseJobStreamResult {
  output: string;
  status: 'connecting' | 'streaming' | 'completed' | 'failed' | 'idle';
  isStreaming: boolean;
}

export function useJobStream(jobId: string | null, initialStatus?: string): UseJobStreamResult {
  const [output, setOutput] = useState('');
  const [status, setStatus] = useState<UseJobStreamResult['status']>('idle');
  const offsetRef = useRef(0);
  const eventSourceRef = useRef<EventSource | null>(null);

  const cleanup = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!jobId || (initialStatus && initialStatus !== 'running')) {
      setStatus('idle');
      return;
    }

    setStatus('connecting');
    setOutput('');
    offsetRef.current = 0;

    const connect = () => {
      cleanup();
      const es = api.streamJob(jobId, offsetRef.current);
      eventSourceRef.current = es;

      es.onopen = () => {
        setStatus('streaming');
      };

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'output') {
            setOutput((prev) => prev + data.text);
            offsetRef.current += data.text.length;
            setStatus('streaming');
          } else if (data.type === 'status') {
            if (data.status === 'completed') {
              setStatus('completed');
              cleanup();
            } else if (data.status === 'failed') {
              setStatus('failed');
              cleanup();
            }
          } else if (data.type === 'done') {
            setStatus('completed');
            cleanup();
          }
        } catch {
          // If it's not JSON, treat as raw text
          setOutput((prev) => prev + event.data);
          offsetRef.current += event.data.length;
          setStatus('streaming');
        }
      };

      es.onerror = () => {
        cleanup();
        // Attempt reconnect after a delay
        setTimeout(() => {
          if (status === 'streaming' || status === 'connecting') {
            connect();
          }
        }, 2000);
      };
    };

    connect();

    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, initialStatus]);

  return {
    output,
    status,
    isStreaming: status === 'streaming' || status === 'connecting',
  };
}
