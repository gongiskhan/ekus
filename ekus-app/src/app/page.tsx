'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { useAppStore } from '@/lib/store';
import { api } from '@/lib/api';
import { BottomNav } from '@/components/bottom-nav';
import { SideMenu } from '@/components/side-menu';
import { ChatTab } from '@/features/chat/chat-tab';
import { TasksTab } from '@/features/tasks/tasks-tab';
import { SchedulerTab } from '@/features/scheduler/scheduler-tab';
import { MemoryTab } from '@/features/memory/memory-tab';
import { NotesTab } from '@/features/notes/notes-tab';
import { VoiceTab } from '@/features/voice/voice-tab';
import { ProjectsTab } from '@/features/projects/projects-tab';
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
    <span className="flex items-center gap-2 text-xs font-medium" style={{ color: colors[status] }}>
      <span>{labels[status]}</span>
      <span
        className={`w-2.5 h-2.5 rounded-full ${status === 'checking' ? 'animate-pulse' : ''}`}
        style={{
          background: colors[status],
          boxShadow: status === 'online' ? '0 0 8px rgba(42, 157, 143, 0.8)' : 'none',
        }}
      />
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

const tabTitles: Record<string, string> = {
  chat: 'Chat',
  tasks: 'Tasks',
  scheduler: 'Schedule',
  notes: 'Notes',
  memory: 'Memory',
  voice: 'Voice',
  projects: 'Projects',
};

export default function Home() {
  const activeTab = useAppStore((s) => s.activeTab);
  const setMenuOpen = useAppStore((s) => s.setMenuOpen);
  const sessionName = useSessionName();

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        regs.forEach((r) => r.update());
      });
      caches.keys().then((names) => {
        names.filter((n) => (n.startsWith('ekus-') || n.startsWith('ekoa-')) && n !== 'ekoa-20260321a')
          .forEach((n) => caches.delete(n));
      });
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);

  const headerTitle = activeTab === 'chat' && sessionName
    ? sessionName
    : tabTitles[activeTab] || 'Chat';

  return (
    <div className="flex flex-col h-dvh" style={{ background: 'var(--bg)' }}>
      {/* Header */}
      <header
        className="flex items-center justify-between px-4 py-2 flex-shrink-0 z-30"
        style={{
          background: 'rgba(255, 255, 255, 0.04)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        }}
      >
        <div className="flex items-center gap-2">
          {/* Hamburger menu button — opens side menu */}
          <button
            onClick={() => setMenuOpen(true)}
            className="flex flex-col gap-[5px] items-center justify-center w-10 h-10 -ml-1 rounded-lg transition-colors press-feedback"
            aria-label="Toggle menu"
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            <span className="w-5 h-[1.5px] bg-white/70 rounded-full" />
            <span className="w-5 h-[1.5px] bg-white/70 rounded-full" />
            <span className="w-3.5 h-[1.5px] bg-white/70 rounded-full" />
          </button>
          <h1 className="text-base font-semibold truncate max-w-[200px]" style={{ color: 'var(--text)' }}>
            {headerTitle}
          </h1>
        </div>
        <HealthIndicator />
      </header>

      {/* Content */}
      <main className="flex-1 overflow-hidden">
        {activeTab === 'chat' && <ChatTab />}
        {activeTab === 'tasks' && <TasksTab />}
        {activeTab === 'scheduler' && <SchedulerTab />}
        {activeTab === 'notes' && <NotesTab />}
        {activeTab === 'memory' && <MemoryTab />}
        {activeTab === 'voice' && <VoiceTab />}
        {activeTab === 'projects' && <ProjectsTab />}
      </main>

      {/* Side menu */}
      <SideMenu />

      {/* Bottom nav */}
      <BottomNav />
      <InstallPrompt />
    </div>
  );
}
