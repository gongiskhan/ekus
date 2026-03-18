'use client';

import { useEffect, useRef, useCallback } from 'react';

interface XtermTerminalProps {
  jobId: string;
  onConnect?: () => void;
  onError?: () => void;
  onDone?: (exitCode: number) => void;
}

/**
 * Embedded terminal that connects to the Ekus terminal server via WebSocket
 * and renders PTY output using xterm.js.
 *
 * Signals back to the parent via callbacks:
 * - onConnect: WebSocket connected, terminal is active
 * - onError: WebSocket failed to connect (parent should fall back to SSE)
 * - onDone: Job completed (parent can switch to markdown view)
 */
export function XtermTerminal({ jobId, onConnect, onError, onDone }: XtermTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<unknown>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Use refs for callbacks to avoid stale closures
  const onConnectRef = useRef(onConnect);
  const onErrorRef = useRef(onError);
  const onDoneRef = useRef(onDone);
  onConnectRef.current = onConnect;
  onErrorRef.current = onError;
  onDoneRef.current = onDone;

  const initTerminal = useCallback(async () => {
    if (!containerRef.current || termRef.current) return;

    // Dynamic import to avoid SSR issues with xterm.js
    const [{ Terminal }, { FitAddon }] = await Promise.all([
      import('@xterm/xterm'),
      import('@xterm/addon-fit'),
    ]);
    // CSS import (ignore TS error — bundler handles CSS imports)
    // @ts-expect-error CSS module import handled by bundler
    await import('@xterm/xterm/css/xterm.css');

    const fitAddon = new FitAddon();

    const term = new Terminal({
      theme: {
        background: '#0d1117',
        foreground: '#e6edf3',
        cursor: '#e6edf3',
        cursorAccent: '#0d1117',
        selectionBackground: '#264f78',
        black: '#484f58',
        red: '#ff7b72',
        green: '#3fb950',
        yellow: '#d29922',
        blue: '#58a6ff',
        magenta: '#bc8cff',
        cyan: '#39d353',
        white: '#b1bac4',
        brightBlack: '#6e7681',
        brightRed: '#ffa198',
        brightGreen: '#56d364',
        brightYellow: '#e3b341',
        brightBlue: '#79c0ff',
        brightMagenta: '#d2a8ff',
        brightCyan: '#56d364',
        brightWhite: '#f0f6fc',
      },
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      lineHeight: 1.2,
      cursorBlink: false,
      disableStdin: true,
      scrollback: 10000,
      convertEol: true,
    });

    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    termRef.current = term;

    requestAnimationFrame(() => {
      try { fitAddon.fit(); } catch {}
    });

    // Connect WebSocket to terminal server
    const host = window.location.hostname;
    const wsUrl = `ws://${host}:7601?jobId=${jobId}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    // Timeout: if no connection in 3s, signal error
    const connectTimeout = setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        onErrorRef.current?.();
        ws.close();
      }
    }, 3000);

    ws.onopen = () => {
      clearTimeout(connectTimeout);
      onConnectRef.current?.();
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'output') {
          term.write(data.content);
        } else if (data.type === 'done') {
          onDoneRef.current?.(data.exitCode);
        } else if (data.type === 'error') {
          term.write(`\r\n\x1b[31m${data.message}\x1b[0m\r\n`);
          onErrorRef.current?.();
        }
      } catch {
        term.write(event.data);
      }
    };

    ws.onerror = () => {
      clearTimeout(connectTimeout);
      onErrorRef.current?.();
    };

    ws.onclose = (e) => {
      clearTimeout(connectTimeout);
      // If closed before ever opening, signal error
      if (e.code !== 1000 && e.code !== 1005) {
        onErrorRef.current?.();
      }
    };

    // Resize observer for dynamic sizing
    const resizeObserver = new ResizeObserver(() => {
      try { fitAddon.fit(); } catch {}
    });
    resizeObserver.observe(containerRef.current);

    // Cleanup function
    cleanupRef.current = () => {
      clearTimeout(connectTimeout);
      resizeObserver.disconnect();
      ws.close();
      term.dispose();
      termRef.current = null;
      wsRef.current = null;
    };
  }, [jobId]);

  useEffect(() => {
    initTerminal();
    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [initTerminal]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '300px',
        borderRadius: '8px',
        overflow: 'hidden',
        background: '#0d1117',
      }}
    />
  );
}
