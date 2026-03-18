'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { useAppStore } from '@/lib/store';
import { api } from '@/lib/api';
import { GlassPanel } from '@/components/glass-panel';
import { BottomNav } from '@/components/bottom-nav';
import { ChatTab } from '@/features/chat/chat-tab';
import { TasksTab } from '@/features/tasks/tasks-tab';
import { SchedulerTab } from '@/features/scheduler/scheduler-tab';
import { MemoryTab } from '@/features/memory/memory-tab';
import { NotesTab } from '@/features/notes/notes-tab';
import { InstallPrompt } from '@/components/install-prompt';
import type { ChatSession } from '@/lib/types';

function HealthIndicator() {
  const [status, setStatus] = useState<'checking' | 'online' | 'offline'>('checking');

  useEffect(() => {
    const check = async () => {
      try {
        await api.checkHealth();
        setStatus('online');
      } catch {
        setStatus('offline');
      }
    };
    check();
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, []);

  const colors = {
    checking: 'var(--text-muted)',
    online: 'var(--emerald)',
    offline: 'var(--red)',
  };

  const labels = {
    checking: 'Connecting...',
    online: 'Online',
    offline: 'Offline',
  };

  return (
    <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: colors[status] }}>
      <span
        className={`w-2 h-2 rounded-full ${status === 'checking' ? 'animate-pulse' : ''}`}
        style={{ background: colors[status] }}
      />
      {labels[status]}
    </span>
  );
}

function useSessionName(): string | null {
  const activeTab = useAppStore((s) => s.activeTab);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const { data } = useSWR(
    activeTab === 'chat' && activeSessionId && activeSessionId !== '__history__' ? 'sessions' : null,
    () => api.listSessions(),
    { refreshInterval: 30000 }
  );
  if (!data || !activeSessionId) return null;
  const sessions: ChatSession[] = data.sessions || [];
  const session = sessions.find((s) => s.id === activeSessionId);
  return session?.name || null;
}

export default function Home() {
  const activeTab = useAppStore((s) => s.activeTab);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const sessionName = useSessionName();

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      // Force update: unregister old SW, clear caches, re-register
      navigator.serviceWorker.getRegistrations().then((regs) => {
        regs.forEach((r) => r.update());
      });
      caches.keys().then((names) => {
        names.filter((n) => n.startsWith('ekus-') && n !== 'ekus-20260312b')
          .forEach((n) => caches.delete(n));
      });
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);

  return (
    <div className="flex flex-col h-dvh" style={{ background: 'var(--bg)' }}>
      {/* Header */}
      <GlassPanel className="flex items-center justify-between px-4 py-3 flex-shrink-0 z-30">
        <div className="flex items-center gap-2">
          {activeTab === 'chat' && (
            <button
              onClick={toggleSidebar}
              className="p-1.5 -ml-1.5 rounded-lg transition-colors hover:bg-black/5"
              aria-label="Toggle conversations"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text)" strokeWidth="2" strokeLinecap="round">
                <path d="M3 12h18M3 6h18M3 18h18" />
              </svg>
            </button>
          )}
          <h1 className="text-lg font-bold truncate max-w-[200px]" style={{ color: 'var(--text)' }}>
            {activeTab === 'chat' && sessionName ? sessionName : 'Ekus'}
          </h1>
        </div>
        <HealthIndicator />
      </GlassPanel>

      {/* Content */}
      <main className="flex-1 overflow-hidden">
        {activeTab === 'chat' && <ChatTab />}
        {activeTab === 'tasks' && <TasksTab />}
        {activeTab === 'scheduler' && <SchedulerTab />}
        {activeTab === 'notes' && <NotesTab />}
        {activeTab === 'memory' && <MemoryTab />}
      </main>

      {/* Bottom nav */}
      <BottomNav />
      <InstallPrompt />
    </div>
  );
}
