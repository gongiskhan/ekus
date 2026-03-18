'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import useSWR from 'swr';
import { api } from '@/lib/api';
import { useAppStore } from '@/lib/store';
import type { ChatSession } from '@/lib/types';

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

interface SessionItemProps {
  session: ChatSession;
  isActive: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}

function SessionItem({ session, isActive, onSelect, onRename, onDelete }: SessionItemProps) {
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editName, setEditName] = useState(session.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const handleLongPressStart = () => {
    if (session.id === '__history__') return;
    longPressTimer.current = setTimeout(() => setMenuOpen(true), 500);
  };

  const handleLongPressEnd = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  };

  if (editing) {
    return (
      <div className="px-3 py-2">
        <input
          ref={inputRef}
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              onRename(editName);
              setEditing(false);
            }
            if (e.key === 'Escape') setEditing(false);
          }}
          onBlur={() => {
            onRename(editName);
            setEditing(false);
          }}
          className="w-full px-2 py-1 text-sm rounded-lg border outline-none"
          style={{ borderColor: 'var(--primary)', background: 'white', color: 'var(--text)' }}
        />
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => { setMenuOpen(false); onSelect(); }}
        onTouchStart={handleLongPressStart}
        onTouchEnd={handleLongPressEnd}
        onTouchCancel={handleLongPressEnd}
        onContextMenu={(e) => {
          if (session.id !== '__history__') {
            e.preventDefault();
            setMenuOpen(true);
          }
        }}
        className="w-full text-left px-3 py-2.5 flex items-center gap-2 rounded-lg transition-colors"
        style={{
          background: isActive ? 'var(--primary-light)' : 'transparent',
          color: 'var(--text)',
          minHeight: 44,
        }}
      >
        {session.has_running && (
          <span className="w-2 h-2 rounded-full flex-shrink-0 animate-pulse" style={{ background: 'var(--emerald)' }} />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{session.name}</div>
          {session.updated_at && (
            <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {timeAgo(session.updated_at)}
              {session.job_count ? ` · ${session.job_count} msg${session.job_count > 1 ? 's' : ''}` : ''}
            </div>
          )}
        </div>
      </button>

      {/* Context menu */}
      <AnimatePresence>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-[70]" onClick={() => setMenuOpen(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.1 }}
              className="absolute right-2 top-1 z-[71] rounded-lg shadow-lg overflow-hidden"
              style={{ background: 'white', border: '1px solid var(--border)' }}
            >
              <button
                onClick={() => { setMenuOpen(false); setEditName(session.name); setEditing(true); }}
                className="block w-full text-left px-4 py-2 text-sm hover:bg-gray-50"
                style={{ color: 'var(--text)' }}
              >
                Rename
              </button>
              <button
                onClick={() => { setMenuOpen(false); onDelete(); }}
                className="block w-full text-left px-4 py-2 text-sm hover:bg-red-50"
                style={{ color: 'var(--red)' }}
              >
                Delete
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

interface SessionSidebarProps {
  open: boolean;
  onClose: () => void;
}

export function SessionSidebar({ open, onClose }: SessionSidebarProps) {
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const setActiveSessionId = useAppStore((s) => s.setActiveSessionId);

  const { data, mutate } = useSWR(
    open ? 'sessions' : null,
    () => api.listSessions(),
    { refreshInterval: 10000 }
  );

  const sessions: ChatSession[] = data?.sessions || [];
  const history: ChatSession | null = data?.history || null;

  const handleNewSession = async () => {
    const session = await api.createSession();
    setActiveSessionId(session.id);
    mutate();
    onClose();
  };

  const handleSelect = (id: string) => {
    setActiveSessionId(id);
    onClose();
  };

  const handleRename = async (id: string, name: string) => {
    await api.renameSession(id, name);
    mutate();
  };

  const handleDelete = async (id: string) => {
    await api.deleteSession(id);
    if (activeSessionId === id) {
      setActiveSessionId(null);
    }
    mutate();
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60]">
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/20 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
          />

          {/* Drawer */}
          <motion.div
            className="absolute left-0 top-0 bottom-0 w-[280px] z-[61] flex flex-col"
            style={{ background: 'var(--bg)', borderRight: '1px solid var(--border)' }}
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            drag="x"
            dragConstraints={{ left: -280, right: 0 }}
            dragElastic={0}
            onDragEnd={(_, info) => {
              if (info.offset.x < -100) onClose();
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
              <h2 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Conversations</h2>
              <button
                onClick={handleNewSession}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors"
                style={{ background: 'var(--primary)', color: 'white' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                New
              </button>
            </div>

            {/* Session list */}
            <div className="flex-1 overflow-y-auto py-1">
              {sessions.length === 0 && !history && (
                <div className="px-4 py-8 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                  No conversations yet
                </div>
              )}
              {sessions.map((s) => (
                <SessionItem
                  key={s.id}
                  session={s}
                  isActive={activeSessionId === s.id}
                  onSelect={() => handleSelect(s.id)}
                  onRename={(name) => handleRename(s.id, name)}
                  onDelete={() => handleDelete(s.id)}
                />
              ))}

              {/* History pseudo-session */}
              {history && (
                <>
                  <div className="mx-3 my-2" style={{ borderTop: '1px solid var(--border)' }} />
                  <SessionItem
                    session={history}
                    isActive={activeSessionId === '__history__'}
                    onSelect={() => handleSelect('__history__')}
                    onRename={() => {}}
                    onDelete={() => {}}
                  />
                </>
              )}
            </div>

            {/* Show all (no session filter) */}
            <div className="px-3 py-2 flex-shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
              <button
                onClick={() => { setActiveSessionId(null); onClose(); }}
                className="w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-colors"
                style={{
                  background: activeSessionId === null ? 'var(--primary-light)' : 'transparent',
                  color: 'var(--text-muted)',
                }}
              >
                Show all messages
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
