'use client';

import { useState, useEffect, useRef } from 'react';

const getBase = () => typeof window !== 'undefined' ? window.location.origin : '';

interface ChannelStatusResult {
  available: boolean;
  checking: boolean;
  sessionState: 'idle' | 'starting' | 'ready' | 'switching' | 'error';
  activeSessionId: string | null;
  error: string | null;
}

export function useChannelStatus(): ChannelStatusResult {
  const [available, setAvailable] = useState(false);
  const [checking, setChecking] = useState(true);
  const [sessionState, setSessionState] = useState<ChannelStatusResult['sessionState']>('idle');
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(() => {
    let mounted = true;

    const check = async () => {
      try {
        const base = getBase();
        const resp = await fetch(`${base}/api/channel/status`);
        const data = await resp.json();
        if (mounted) {
          setAvailable(data.available === true);
          setSessionState(data.session_state || 'idle');
          setActiveSessionId(data.active_session_id || null);
          setError(data.error || null);
          setChecking(false);
        }
      } catch {
        if (mounted) {
          setAvailable(false);
          setSessionState('error');
          setChecking(false);
        }
      }
    };

    check();
    // Poll faster during transitions, slower when stable
    const setupInterval = () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      const ms = (sessionState === 'starting' || sessionState === 'switching') ? 2000 : 10000;
      intervalRef.current = setInterval(check, ms);
    };
    setupInterval();

    return () => { mounted = false; if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [sessionState]);

  return { available, checking, sessionState, activeSessionId, error };
}
