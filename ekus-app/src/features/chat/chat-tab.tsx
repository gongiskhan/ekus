'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import useSWR from 'swr';
import { api } from '@/lib/api';
import type { Job } from '@/lib/types';
import { ChatMessage } from './chat-message';
import { ChatInput } from './chat-input';
import { useJobStream } from './use-job-stream';

export function ChatTab() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [activeStreamId, setActiveStreamId] = useState<string | null>(null);
  const [outputs, setOutputs] = useState<Record<string, string>>({});

  const { data: jobs, mutate } = useSWR<Job[]>(
    'jobs',
    () => api.listJobs().then((data: { jobs?: Job[] }) => {
      const list = data.jobs || data;
      return Array.isArray(list) ? list : [];
    }),
    {
      refreshInterval: (data) => {
        const arr = data || [];
        return arr.some((j: Job) => j.status === 'running') ? 3000 : 30000;
      },
      fallbackData: [],
    }
  );

  // Find the currently running job
  const runningJob = (jobs || []).find((j) => j.status === 'running');

  useEffect(() => {
    if (runningJob) {
      setActiveStreamId(runningJob.id);
    } else {
      setActiveStreamId(null);
    }
  }, [runningJob]);

  const stream = useJobStream(activeStreamId, runningJob?.status);

  useEffect(() => {
    if (activeStreamId && stream.output) {
      setOutputs((prev) => ({ ...prev, [activeStreamId]: stream.output }));
    }
  }, [activeStreamId, stream.output]);

  // Fetch summaries for completed jobs that don't have one yet
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
        let result;
        if (files.length > 0) {
          result = await api.createJobWithFiles(prompt, files);
        } else {
          result = await api.createJob(prompt);
        }
        if (result.id) {
          setActiveStreamId(result.id);
          setAutoScroll(true);
        }
        mutate();
      } catch (err) {
        console.error('Failed to create job:', err);
      }
    },
    [mutate]
  );

  const sortedJobs = [...(jobs || [])].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  return (
    <div className="flex flex-col h-full">
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
