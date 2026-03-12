'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { StatusBadge } from '@/components/status-badge';
import { cronToHuman, timeAgo } from './cron-utils';
import type { SchedulerJob } from '@/lib/types';

interface JobRowProps {
  job: SchedulerJob;
  onToggle: (enabled: boolean) => void;
  onRunNow: () => void;
  onDelete: () => void;
  logs?: string[];
}

export function JobRow({ job, onToggle, onRunNow, onDelete, logs }: JobRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <motion.div
      className="glass rounded-xl overflow-hidden mb-3"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      {/* Main row */}
      <div
        className="flex items-center gap-3 p-3 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        {/* Toggle switch */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle(!job.enabled);
          }}
          className="flex-shrink-0 w-11 h-6 rounded-full p-0.5 transition-colors"
          style={{
            background: job.enabled ? 'var(--primary)' : '#d1d5db',
          }}
        >
          <motion.div
            className="w-5 h-5 rounded-full bg-white shadow-sm"
            animate={{ x: job.enabled ? 20 : 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          />
        </button>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="text-sm font-medium truncate"
              style={{ color: job.enabled ? 'var(--text)' : 'var(--text-muted)' }}
            >
              {job.description || job.id}
            </span>
            <StatusBadge variant={job.enabled ? 'completed' : 'disabled'} label={job.enabled ? 'Active' : 'Off'} />
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {cronToHuman(job.schedule)}
            </span>
            {job.last_run && (
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                -- {timeAgo(job.last_run)} ago
              </span>
            )}
          </div>
        </div>

        {/* Expand icon */}
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--text-muted)"
          strokeWidth="2"
          strokeLinecap="round"
          className={`transition-transform ${expanded ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>

      {/* Expanded content */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-3">
              <div className="border-t pt-3" style={{ borderColor: 'var(--border)' }}>
                <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>
                  Prompt
                </label>
                <p className="text-xs p-2 rounded-lg bg-white/30 whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>
                  {job.prompt}
                </p>
              </div>

              <div>
                <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>
                  Schedule
                </label>
                <code className="text-xs px-2 py-1 rounded bg-white/30" style={{ color: 'var(--text-secondary)' }}>
                  {job.schedule}
                </code>
              </div>

              {logs && logs.length > 0 && (
                <div>
                  <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>
                    Recent Logs
                  </label>
                  <div className="max-h-32 overflow-y-auto rounded-lg bg-white/30 p-2">
                    {logs.map((log, i) => (
                      <p key={i} className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
                        {log}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2">
                <button
                  onClick={onRunNow}
                  className="px-3 py-2 rounded-xl text-xs font-medium transition-colors min-h-[36px]"
                  style={{ background: 'var(--primary-light)', color: 'var(--primary)' }}
                >
                  Run Now
                </button>
                <div className="flex-1" />
                {confirmDelete ? (
                  <div className="flex items-center gap-1">
                    <span className="text-xs" style={{ color: 'var(--red)' }}>
                      Delete?
                    </span>
                    <button
                      onClick={() => { onDelete(); setConfirmDelete(false); }}
                      className="px-2 py-1.5 rounded text-xs font-medium text-white"
                      style={{ background: 'var(--red)' }}
                    >
                      Yes
                    </button>
                    <button
                      onClick={() => setConfirmDelete(false)}
                      className="px-2 py-1.5 rounded text-xs font-medium"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    className="px-3 py-2 rounded-xl text-xs font-medium transition-colors min-h-[36px]"
                    style={{ color: 'var(--red)' }}
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
