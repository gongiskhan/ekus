'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import useSWR from 'swr';
import { api } from '@/lib/api';
import { useAppStore } from '@/lib/store';
import type { Job } from '@/lib/types';
import { ChatMessage } from './chat-message';
import { ChatInput } from './chat-input';
import { useJobStream } from './use-job-stream';
import { SessionSidebar } from './session-sidebar';
import { useChannel } from '@/hooks/use-channel';
import { useChannelStatus } from '@/hooks/use-channel-status';
import { MarkdownRenderer, fixFileSrc } from '@/components/markdown-renderer';

function ThinkingIndicator() {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const interval = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(interval);
  }, []);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const timeStr = `${mins}:${secs.toString().padStart(2, '0')}s`;
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="flex gap-[6px] items-center">
        <div className="w-2.5 h-2.5 rounded-full bg-[#2a9d8f] dot-anim-1" />
        <div className="w-2.5 h-2.5 rounded-full bg-[#2a9d8f] dot-anim-2" />
        <div className="w-2.5 h-2.5 rounded-full bg-[#2a9d8f]/60 dot-anim-3" />
      </div>
      <span className="text-[13px] font-medium" style={{ color: 'var(--text-muted)' }}>{timeStr}</span>
    </div>
  );
}

export function ChatTab() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [activeStreamId, setActiveStreamId] = useState<string | null>(null);
  const [outputs, setOutputs] = useState<Record<string, string>>({});
  const [pendingJob, setPendingJob] = useState<Job | null>(null);
  const [uploading, setUploading] = useState(false);

  // Channel mode
  const { available: channelAvailable, sessionState, activeSessionId: channelActiveSessionId } = useChannelStatus();
  const channel = useChannel();

  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const setActiveSessionId = useAppStore((s) => s.setActiveSessionId);
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);

  const { data: jobs, mutate } = useSWR<Job[]>(
    `jobs-${activeSessionId ?? 'all'}`,
    () => api.listJobs(activeSessionId).then((data: { jobs?: Job[] }) => {
      const list = data.jobs || data;
      return Array.isArray(list) ? list : [];
    }),
    {
      refreshInterval: (data) => {
        const arr = data || [];
        return arr.some((j: Job) => j.status === 'running') || pendingJob ? 3000 : 30000;
      },
      fallbackData: [],
    }
  );

  useEffect(() => {
    if (pendingJob && (jobs || []).some((j) => j.id === pendingJob.id)) {
      setPendingJob(null);
    }
  }, [jobs, pendingJob]);

  const stream = useJobStream(activeStreamId, activeStreamId ? 'running' : undefined);

  useEffect(() => {
    if (stream.jobId && stream.output) {
      setOutputs((prev) => ({ ...prev, [stream.jobId!]: stream.output }));
    }
  }, [stream.jobId, stream.output]);

  useEffect(() => {
    if (stream.status === 'completed' || stream.status === 'failed') {
      setActiveStreamId(null);
      mutate();
    }
  }, [stream.status, mutate]);

  useEffect(() => {
    (jobs || []).forEach((job) => {
      if (job.status !== 'running' && !outputs[job.id] && !job.summary) {
        api.getJobOutput(job.id).then((text) => {
          if (text) {
            setOutputs((prev) => ({ ...prev, [job.id]: text }));
          }
        }).catch(() => {});
      }
    });
  }, [jobs, outputs]);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [jobs, stream.output, autoScroll, channel.messages]);

  // Load channel history when switching conversations
  const prevSessionRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const prev = prevSessionRef.current;
    prevSessionRef.current = activeSessionId;
    if (prev === undefined && !activeSessionId) return;
    if (prev === activeSessionId) return;
    if (!activeSessionId) {
      if (prev != null) channel.clearMessages();
      return;
    }
    channel.loadHistory(activeSessionId);
    if (channelActiveSessionId !== activeSessionId && sessionState === 'ready') {
      api.switchSession(activeSessionId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId]);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
      setAutoScroll(true);
    }
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    setAutoScroll(isNearBottom);
    setShowScrollBtn(!isNearBottom);
  }, []);

  const handleSend = useCallback(
    async (prompt: string, files: File[]) => {
      if (channelAvailable || sessionState === 'ready') {
        try {
          let uploadedPaths: string[] | undefined;
          if (files.length > 0) {
            setUploading(true);
            try {
              const uploads = await Promise.all(
                files.map(async (f) => {
                  const resp = await fetch(`${window.location.origin}/api/upload`, {
                    method: 'POST',
                    body: (() => { const fd = new FormData(); fd.append('file', f); return fd; })(),
                  });
                  if (!resp.ok) {
                    const err = await resp.json().catch(() => ({ detail: 'Upload failed' }));
                    throw new Error(err.detail || `Upload failed: ${resp.status}`);
                  }
                  return resp.json();
                })
              );
              uploadedPaths = uploads.map(u => u.path).filter(Boolean);
            } finally {
              setUploading(false);
            }
          }
          await channel.sendMessage(prompt, uploadedPaths?.length ? uploadedPaths : undefined, activeSessionId || undefined);
          setAutoScroll(true);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Upload failed';
          channel.addErrorMessage(`Failed to attach files: ${message}`);
        }
        return;
      }

      // Legacy job mode
      try {
        let sessionId = activeSessionId;
        if (!sessionId || sessionId === '__history__') {
          const session = await api.createSession();
          sessionId = session.id;
          setActiveSessionId(sessionId);
        }
        let result;
        if (files.length > 0) {
          result = await api.createJobWithFiles(prompt, files, sessionId);
        } else {
          result = await api.createJob(prompt, sessionId);
        }
        const id = result.job_id || result.id;
        if (id) {
          setPendingJob({
            id,
            prompt,
            status: 'running',
            created_at: new Date().toISOString(),
            session: sessionId || '',
          });
          setActiveStreamId(id);
          setAutoScroll(true);
        }
        mutate();
      } catch (err) {
        console.error('Failed to create job:', err);
      }
    },
    [mutate, activeSessionId, setActiveSessionId, channelAvailable, channel, sessionState]
  );

  const allJobs = [...(jobs || [])];
  if (pendingJob && !allJobs.some((j) => j.id === pendingJob.id)) {
    allJobs.push(pendingJob);
  }
  const sortedJobs = allJobs.sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  const isChannelMode = channel.messages.length > 0 || channelAvailable || sessionState === 'ready';
  const hasNoMessages = isChannelMode
    ? channel.messages.length === 0
    : sortedJobs.length === 0;

  return (
    <div className="flex flex-col h-full relative">
      <SessionSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Transition indicator */}
      {(sessionState === 'switching' || sessionState === 'starting') && (
        <div className="flex items-center justify-center py-1">
          <span className="text-[11px] px-2 py-0.5 rounded-full font-medium animate-pulse" style={{ background: 'rgba(234, 179, 8, 0.12)', color: 'var(--amber)' }}>
            {sessionState === 'switching' ? 'Switching...' : 'Starting...'}
          </span>
        </div>
      )}

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto no-scrollbar px-4 pt-3 pb-36"
      >
        {/* Empty state */}
        {hasNoMessages && (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
              style={{ background: 'rgba(42, 157, 143, 0.15)', border: '1px solid rgba(42, 157, 143, 0.25)' }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
              Start a conversation
            </p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Type a message below to get started
            </p>
          </div>
        )}

        {/* Channel messages */}
        {isChannelMode && channel.messages.length > 0 && (
          <div className="flex flex-col gap-5">
            {channel.messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} w-full`}>
                {msg.role === 'user' ? (
                  /* ── User bubble ── */
                  <div className="chat-bubble-user">
                    {msg.files && msg.files.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-2">
                        {msg.files.map((file, i) => {
                          const isImage = /\.(png|jpg|jpeg|webp|gif)$/i.test(file);
                          const url = fixFileSrc(file);
                          return isImage ? (
                            <img key={i} src={url} alt="" className="chat-image rounded-lg" />
                          ) : (
                            <a
                              key={i}
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg"
                              style={{ background: 'rgba(255, 255, 255, 0.15)', color: 'white' }}
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                <path d="M14 2v6h6" />
                              </svg>
                              {file.split('/').pop()}
                            </a>
                          );
                        })}
                      </div>
                    )}
                    <MarkdownRenderer content={msg.content} />
                  </div>
                ) : (
                  /* ── AI bubble ── */
                  <div className="chat-bubble-ai">
                    {msg.isThinking ? (
                      <ThinkingIndicator />
                    ) : (
                      <>
                        {msg.files && msg.files.length > 0 && (
                          <div className="flex flex-wrap gap-2 mb-2">
                            {msg.files.map((file, i) => {
                              const isImage = /\.(png|jpg|jpeg|webp|gif)$/i.test(file);
                              const url = fixFileSrc(file);
                              return isImage ? (
                                <img key={i} src={url} alt="" className="chat-image rounded-lg" />
                              ) : (
                                <a
                                  key={i}
                                  href={url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg"
                                  style={{ background: 'rgba(42, 157, 143, 0.15)', border: '1px solid rgba(42, 157, 143, 0.3)', color: '#5eead4' }}
                                >
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                    <path d="M14 2v6h6" />
                                  </svg>
                                  {file.split('/').pop()}
                                </a>
                              );
                            })}
                          </div>
                        )}
                        <MarkdownRenderer content={msg.content} />
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Legacy job messages */}
        {!isChannelMode && sortedJobs.map((job) => (
          <ChatMessage
            key={job.id}
            job={job}
            streamOutput={outputs[job.id]}
            isStreaming={job.id === activeStreamId && stream.isStreaming}
          />
        ))}
      </div>

      {/* Session switching overlay */}
      {(sessionState === 'switching' || sessionState === 'starting') && (
        <div className="absolute inset-0 flex items-center justify-center z-30" style={{ background: 'rgba(15, 20, 25, 0.6)', backdropFilter: 'blur(4px)' }}>
          <div className="text-center">
            <div className="animate-spin w-8 h-8 border-2 rounded-full mx-auto mb-2" style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              {sessionState === 'switching' ? 'Switching conversation...' : 'Starting session...'}
            </p>
          </div>
        </div>
      )}

      {/* Scroll to bottom FAB */}
      {showScrollBtn && !hasNoMessages && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-[150px] left-1/2 -translate-x-1/2 z-40 press-feedback"
          style={{
            background: '#1a2636',
            width: 40,
            height: 40,
            borderRadius: '50%',
            border: '1px solid rgba(42, 157, 143, 0.4)',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          aria-label="Scroll to bottom"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      )}

      <ChatInput onSend={handleSend} uploading={uploading} />
    </div>
  );
}
