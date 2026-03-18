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

export function ChatTab() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [activeStreamId, setActiveStreamId] = useState<string | null>(null);
  const [outputs, setOutputs] = useState<Record<string, string>>({});
  // Optimistic job: shown immediately while SWR hasn't refreshed yet
  const [pendingJob, setPendingJob] = useState<Job | null>(null);

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

  // Clear pending job once SWR picks it up
  useEffect(() => {
    if (pendingJob && (jobs || []).some((j) => j.id === pendingJob.id)) {
      setPendingJob(null);
    }
  }, [jobs, pendingJob]);

  const stream = useJobStream(activeStreamId, activeStreamId ? 'running' : undefined);

  // Store streaming output keyed by job ID — use stream.jobId (not activeStreamId)
  // to avoid race condition where activeStreamId changes before stream.output resets
  useEffect(() => {
    if (stream.jobId && stream.output) {
      setOutputs((prev) => ({ ...prev, [stream.jobId!]: stream.output }));
    }
  }, [stream.jobId, stream.output]);

  // Clear activeStreamId when stream completes
  useEffect(() => {
    if (stream.status === 'completed' || stream.status === 'failed') {
      setActiveStreamId(null);
      // Force SWR refresh to get final job status
      mutate();
    }
  }, [stream.status, mutate]);

  // Fetch outputs for completed jobs that don't have one yet
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
  }, [jobs, stream.output, autoScroll]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    setAutoScroll(isNearBottom);
  }, []);

  const handleSend = useCallback(
    async (prompt: string, files: File[]) => {
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
          // Add optimistic job so it appears immediately
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
    [mutate, activeSessionId, setActiveSessionId]
  );

  // Merge SWR jobs + pending optimistic job, sorted by created_at
  const allJobs = [...(jobs || [])];
  if (pendingJob && !allJobs.some((j) => j.id === pendingJob.id)) {
    allJobs.push(pendingJob);
  }
  const sortedJobs = allJobs.sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  return (
    <div className="flex flex-col h-full">
      <SessionSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 pt-4 pb-32"
      >
        {sortedJobs.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center opacity-50">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1" className="mb-3">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              No messages yet. Send a prompt to get started.
            </p>
          </div>
        )}
        {sortedJobs.map((job) => (
          <ChatMessage
            key={job.id}
            job={job}
            streamOutput={outputs[job.id]}
            isStreaming={job.id === activeStreamId && stream.isStreaming}
          />
        ))}
      </div>
      <ChatInput onSend={handleSend} />
    </div>
  );
}
