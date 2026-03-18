'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/api';
import { Modal } from '@/components/modal';
import type { Note } from '@/lib/types';

const STORAGE_KEY = 'ekus-notes';

function loadNotes(): Note[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveNotes(notes: Note[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
}

const defaultMemoryFiles = ['lessons-learned.md', 'workflows.md', 'reminders.md'];

export function NotesTab() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [actionMenu, setActionMenu] = useState<string | null>(null);
  const [memoryPicker, setMemoryPicker] = useState<string | null>(null);
  const [memoryFiles, setMemoryFiles] = useState<string[]>(defaultMemoryFiles);
  const [toast, setToast] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setNotes(loadNotes());
    // Fetch memory file list dynamically
    api.listMemory().then((dict) => {
      if (dict && typeof dict === 'object') {
        const names = Object.keys(dict);
        setMemoryFiles([...new Set([...defaultMemoryFiles, ...names])]);
      }
    }).catch(() => {});
  }, []);

  const persist = (updated: Note[]) => {
    setNotes(updated);
    saveNotes(updated);
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const addNote = () => {
    const text = draft.trim();
    if (!text) return;
    const note: Note = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      content: text,
      created_at: new Date().toISOString(),
    };
    persist([note, ...notes]);
    setDraft('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const deleteNote = (id: string) => {
    persist(notes.filter((n) => n.id !== id));
    setActionMenu(null);
  };

  const startEdit = (note: Note) => {
    setEditingId(note.id);
    setEditContent(note.content);
    setActionMenu(null);
  };

  const saveEdit = () => {
    if (!editingId) return;
    persist(notes.map((n) => (n.id === editingId ? { ...n, content: editContent } : n)));
    setEditingId(null);
  };

  const sendToAgent = async (note: Note) => {
    setActionMenu(null);
    try {
      await api.createJob(note.content);
      showToast('Sent to agent');
    } catch {
      showToast('Failed to send');
    }
  };

  const createTask = async (note: Note) => {
    setActionMenu(null);
    try {
      const md = await api.getTasks();
      const lines = md.split('\n');
      const activeIdx = lines.findIndex((l: string) => l.trim() === '## Active');
      if (activeIdx === -1) {
        showToast('Could not find Active section');
        return;
      }
      const title = note.content.split('\n')[0].slice(0, 80);
      lines.splice(activeIdx + 1, 0, `- [ ] **${title}**`);
      await api.putTasks(lines.join('\n'));
      showToast('Task created');
    } catch {
      showToast('Failed to create task');
    }
  };

  const sendToMemory = async (note: Note, filename: string) => {
    setMemoryPicker(null);
    setActionMenu(null);
    try {
      const existing = await api.getMemory(filename);
      const appended = existing.trimEnd() + '\n\n' + note.content.trim() + '\n';
      await api.putMemory(filename, appended);
      showToast(`Added to ${filename}`);
    } catch {
      showToast('Failed to save to memory');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      addNote();
    }
  };

  const autoResize = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  };

  const timeAgo = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  };

  return (
    <div className="flex flex-col h-full pb-32">
      {/* Input area */}
      <div className="px-4 pt-4 pb-2 flex-shrink-0">
        <div className="glass rounded-xl p-3 flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              autoResize(e.target);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Jot something down..."
            rows={1}
            className="flex-1 bg-transparent border-none outline-none resize-none text-sm"
            style={{ color: 'var(--text)', minHeight: 24 }}
          />
          <button
            onClick={addNote}
            disabled={!draft.trim()}
            className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-opacity disabled:opacity-30"
            style={{ background: 'var(--primary)', color: 'white' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Notes list */}
      <div className="flex-1 overflow-y-auto px-4">
        {notes.length === 0 && (
          <div className="flex items-center justify-center h-32 text-sm" style={{ color: 'var(--text-muted)' }}>
            No notes yet. Type something above.
          </div>
        )}
        <AnimatePresence initial={false}>
          {notes.map((note) => (
            <motion.div
              key={note.id}
              layout
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: -100 }}
              transition={{ duration: 0.2 }}
              className="glass rounded-xl p-3 mb-2"
            >
              {/* Note content */}
              <pre
                className="text-sm whitespace-pre-wrap font-sans mb-2 leading-relaxed"
                style={{ color: 'var(--text)' }}
              >
                {note.content}
              </pre>

              {/* Footer: time + actions */}
              <div className="flex items-center justify-between">
                <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  {timeAgo(note.created_at)}
                </span>

                <div className="flex items-center gap-1">
                  {/* Action menu toggle */}
                  <button
                    onClick={() => setActionMenu(actionMenu === note.id ? null : note.id)}
                    className="p-1.5 rounded-lg transition-colors min-h-[32px] min-w-[32px] flex items-center justify-center"
                    style={{ color: actionMenu === note.id ? 'var(--primary)' : 'var(--text-muted)' }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <circle cx="12" cy="5" r="2" />
                      <circle cx="12" cy="12" r="2" />
                      <circle cx="12" cy="19" r="2" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Action buttons (expanded) */}
              <AnimatePresence>
                {actionMenu === note.id && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="overflow-hidden"
                  >
                    <div className="flex flex-wrap gap-1.5 pt-2 mt-2 border-t" style={{ borderColor: 'var(--border)' }}>
                      <ActionButton
                        label="Agent"
                        icon={<ChatIcon />}
                        onClick={() => sendToAgent(note)}
                      />
                      <ActionButton
                        label="Task"
                        icon={<TaskIcon />}
                        onClick={() => createTask(note)}
                      />
                      <ActionButton
                        label="Memory"
                        icon={<MemoryIcon />}
                        onClick={() => setMemoryPicker(note.id)}
                      />
                      <ActionButton
                        label="Edit"
                        icon={<EditIcon />}
                        onClick={() => startEdit(note)}
                      />
                      <ActionButton
                        label="Delete"
                        icon={<TrashIcon />}
                        onClick={() => deleteNote(note.id)}
                        danger
                      />
                    </div>

                    {/* Memory file picker */}
                    <AnimatePresence>
                      {memoryPicker === note.id && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="flex gap-1.5 pt-2">
                            {memoryFiles.map((file) => (
                              <button
                                key={file}
                                onClick={() => sendToMemory(note, file)}
                                className="flex-1 px-2 py-1.5 rounded-lg text-[11px] font-medium transition-colors min-h-[32px]"
                                style={{ background: 'var(--primary-light)', color: 'var(--primary)' }}
                              >
                                {file.replace('.md', '')}
                              </button>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Edit modal */}
      <Modal open={editingId !== null} onClose={() => setEditingId(null)} fullScreen>
        <div className="flex flex-col h-full">
          <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
            <button
              onClick={() => setEditingId(null)}
              className="text-sm font-medium min-h-[44px] min-w-[44px] flex items-center"
              style={{ color: 'var(--text-muted)' }}
            >
              Cancel
            </button>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Edit Note</h3>
            <button
              onClick={saveEdit}
              className="text-sm font-medium min-h-[44px] min-w-[44px] flex items-center justify-end"
              style={{ color: 'var(--primary)' }}
            >
              Save
            </button>
          </div>
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="flex-1 w-full p-4 text-sm font-mono bg-transparent border-none outline-none resize-none"
            style={{ color: 'var(--text)' }}
            autoFocus
          />
        </div>
      </Modal>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[200] px-4 py-2 rounded-full text-xs font-medium shadow-lg"
            style={{ background: 'var(--text)', color: 'var(--bg)' }}
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ActionButton({ label, icon, onClick, danger }: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors min-h-[32px]"
      style={{
        background: danger ? 'rgba(239,68,68,0.1)' : 'var(--primary-light)',
        color: danger ? '#ef4444' : 'var(--primary)',
      }}
    >
      {icon}
      {label}
    </button>
  );
}

function ChatIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function TaskIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

function MemoryIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}
