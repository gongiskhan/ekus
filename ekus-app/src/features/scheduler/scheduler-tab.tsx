'use client';

import { useState, useCallback } from 'react';
import useSWR from 'swr';
import { api } from '@/lib/api';
import type { SchedulerJob } from '@/lib/types';
import { JobRow } from './job-row';
import { Modal } from '@/components/modal';
import { PullToRefresh } from '@/components/pull-to-refresh';

export function SchedulerTab() {
  const [showAdd, setShowAdd] = useState(false);
  const [newJob, setNewJob] = useState({
    id: '',
    description: '',
    schedule: '',
    prompt: '',
    enabled: true,
  });
  const [jobLogs, setJobLogs] = useState<Record<string, string[]>>({});

  const { data: jobsData, mutate } = useSWR<{ jobs: SchedulerJob[] }>(
    'scheduler-jobs',
    () => api.listSchedulerJobs(),
    { refreshInterval: 60000 }
  );
  const jobs = jobsData?.jobs ?? [];

  const handleToggle = useCallback(
    async (id: string, enabled: boolean) => {
      await api.updateSchedulerJob(id, { enabled });
      mutate();
    },
    [mutate]
  );

  const handleRunNow = useCallback(
    async (id: string) => {
      await api.runSchedulerJob(id);
      mutate();
    },
    [mutate]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      await api.deleteSchedulerJob(id);
      mutate();
    },
    [mutate]
  );

  const handleAdd = useCallback(async () => {
    if (!newJob.id.trim() || !newJob.schedule.trim() || !newJob.prompt.trim()) return;
    await api.addSchedulerJob(newJob);
    setNewJob({ id: '', description: '', schedule: '', prompt: '', enabled: true });
    setShowAdd(false);
    mutate();
  }, [newJob, mutate]);

  const loadLogs = useCallback(async (id: string) => {
    try {
      const data = await api.getSchedulerJobLogs(id);
      const logLines = data.logs || data;
      setJobLogs((prev) => ({ ...prev, [id]: Array.isArray(logLines) ? logLines : [] }));
    } catch {
      // Logs may not be available
    }
  }, []);

  const handleRefresh = useCallback(async () => {
    await mutate();
  }, [mutate]);

  return (
    <PullToRefresh onRefresh={handleRefresh} className="h-full pb-32">
      <div className="p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold" style={{ color: 'var(--text)' }}>
            Scheduled Jobs
          </h2>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1 px-3 py-2 rounded-xl text-sm font-medium transition-colors min-h-[44px]"
            style={{ background: 'var(--primary)', color: 'white' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add Job
          </button>
        </div>

        {jobs.length === 0 && (
          <div className="text-center py-12 opacity-50">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1" className="mx-auto mb-3">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l4 2" />
            </svg>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              No scheduled jobs yet
            </p>
          </div>
        )}

        {jobs.map((job) => (
          <JobRow
            key={job.id}
            job={job}
            onToggle={(enabled) => handleToggle(job.id, enabled)}
            onRunNow={() => { handleRunNow(job.id); loadLogs(job.id); }}
            onDelete={() => handleDelete(job.id)}
            logs={jobLogs[job.id]}
          />
        ))}
      </div>

      {/* Add job modal */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)}>
        <div className="p-5">
          <h3 className="text-base font-semibold mb-4" style={{ color: 'var(--text)' }}>
            New Scheduled Job
          </h3>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>
                ID
              </label>
              <input
                type="text"
                value={newJob.id}
                onChange={(e) => setNewJob((p) => ({ ...p, id: e.target.value }))}
                className="w-full px-3 py-2.5 rounded-xl text-sm bg-black/20 border-none outline-none min-h-[44px]"
                style={{ color: 'var(--text)' }}
                placeholder="my-job-id"
              />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>
                Description
              </label>
              <input
                type="text"
                value={newJob.description}
                onChange={(e) => setNewJob((p) => ({ ...p, description: e.target.value }))}
                className="w-full px-3 py-2.5 rounded-xl text-sm bg-black/20 border-none outline-none min-h-[44px]"
                style={{ color: 'var(--text)' }}
                placeholder="What this job does"
              />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>
                Cron Schedule
              </label>
              <input
                type="text"
                value={newJob.schedule}
                onChange={(e) => setNewJob((p) => ({ ...p, schedule: e.target.value }))}
                className="w-full px-3 py-2.5 rounded-xl text-sm bg-black/20 border-none outline-none min-h-[44px] font-mono"
                style={{ color: 'var(--text)' }}
                placeholder="*/10 6-23 * * *"
              />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>
                Prompt
              </label>
              <textarea
                value={newJob.prompt}
                onChange={(e) => setNewJob((p) => ({ ...p, prompt: e.target.value }))}
                className="w-full px-3 py-2.5 rounded-xl text-sm bg-black/20 border-none outline-none resize-none"
                style={{ color: 'var(--text)', minHeight: 80 }}
                placeholder="The prompt to execute"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setNewJob((p) => ({ ...p, enabled: !p.enabled }))}
                className="w-11 h-6 rounded-full p-0.5 transition-colors"
                style={{ background: newJob.enabled ? 'var(--primary)' : 'rgba(255,255,255,0.12)' }}
              >
                <div
                  className="w-5 h-5 rounded-full bg-white shadow-sm transition-transform"
                  style={{ transform: newJob.enabled ? 'translateX(20px)' : 'translateX(0)' }}
                />
              </button>
              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                {newJob.enabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setShowAdd(false)}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-white/10 transition-colors min-h-[44px]"
                style={{ color: 'var(--text-muted)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleAdd}
                disabled={!newJob.id.trim() || !newJob.schedule.trim() || !newJob.prompt.trim()}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium text-white transition-colors min-h-[44px] disabled:opacity-40"
                style={{ background: 'var(--primary)' }}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      </Modal>
    </PullToRefresh>
  );
}
