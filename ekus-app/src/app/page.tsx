'use client';

import { useEffect, useState } from 'react';
import { useAppStore } from '@/lib/store';
import { api } from '@/lib/api';
import { GlassPanel } from '@/components/glass-panel';
import { BottomNav } from '@/components/bottom-nav';
import { ChatTab } from '@/features/chat/chat-tab';
import { TasksTab } from '@/features/tasks/tasks-tab';
import { SchedulerTab } from '@/features/scheduler/scheduler-tab';
import { MemoryTab } from '@/features/memory/memory-tab';
import { NotesTab } from '@/features/notes/notes-tab';

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

export default function Home() {
  const activeTab = useAppStore((s) => s.activeTab);

  return (
    <div className="flex flex-col h-dvh" style={{ background: 'var(--bg)' }}>
      {/* Header */}
      <GlassPanel className="flex items-center justify-between px-4 py-3 flex-shrink-0 z-30">
        <h1 className="text-lg font-bold" style={{ color: 'var(--text)' }}>
          Ekus
        </h1>
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
    </div>
  );
}
