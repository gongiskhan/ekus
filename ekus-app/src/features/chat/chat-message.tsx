'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { MarkdownRenderer } from '@/components/markdown-renderer';
import { StatusBadge } from '@/components/status-badge';
import type { Job } from '@/lib/types';

interface ChatMessageProps {
  job: Job;
  streamOutput?: string;
  isStreaming?: boolean;
}

export function ChatMessage({ job, streamOutput, isStreaming }: ChatMessageProps) {
  const [expanded, setExpanded] = useState(false);

  const output = streamOutput ?? job.summary ?? '';
  const isLong = output.length > 500;
  const displayOutput = isLong && !expanded && !isStreaming ? output.slice(0, 500) + '...' : output;

  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  const formatTime = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  return (
    <motion.div
      className="flex flex-col gap-2 mb-4"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      {/* User message */}
      <div className="flex justify-end">
        <div
          className="max-w-[85%] rounded-2xl rounded-br-md px-4 py-2.5 text-sm text-white"
          style={{ background: 'var(--primary)' }}
        >
          {job.prompt}
        </div>
      </div>

      {/* Assistant response */}
      {(output || isStreaming) && (
        <div className="flex justify-start">
          <div
            className="max-w-[85%] glass rounded-2xl rounded-bl-md px-4 py-3 cursor-pointer"
            onClick={() => isLong && setExpanded(!expanded)}
          >
            <div className="flex items-center gap-2 mb-1.5">
              <StatusBadge
                variant={
                  isStreaming
                    ? 'running'
                    : job.status === 'completed'
                    ? 'completed'
                    : job.status === 'failed'
                    ? 'failed'
                    : 'stopped'
                }
              />
              {job.duration_seconds != null && (
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {formatDuration(job.duration_seconds)}
                </span>
              )}
              {job.created_at && (
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {formatTime(job.created_at)}
                </span>
              )}
            </div>
            <MarkdownRenderer content={displayOutput} />
            {isLong && !isStreaming && (
              <button
                className="text-xs font-medium mt-1"
                style={{ color: 'var(--primary)' }}
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded(!expanded);
                }}
              >
                {expanded ? 'Show less' : 'Show more'}
              </button>
            )}
            {isStreaming && (
              <span
                className="inline-block w-1.5 h-4 ml-0.5 animate-pulse rounded-sm"
                style={{ background: 'var(--primary)' }}
              />
            )}
          </div>
        </div>
      )}
    </motion.div>
  );
}
