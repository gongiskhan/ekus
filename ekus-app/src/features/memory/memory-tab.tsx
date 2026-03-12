'use client';

import { useState, useEffect, useCallback } from 'react';
import useSWR from 'swr';
import { motion } from 'framer-motion';
import { api } from '@/lib/api';
// Memory API returns { filename: content } dict
import { MarkdownRenderer } from '@/components/markdown-renderer';
import { Modal } from '@/components/modal';

const defaultFiles = ['lessons-learned.md', 'workflows.md', 'reminders.md'];

export function MemoryTab() {
  const [activeFile, setActiveFile] = useState('lessons-learned.md');
  const [content, setContent] = useState('');
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [availableFiles, setAvailableFiles] = useState<string[]>(defaultFiles);

  // GET /api/memory returns { "filename": "content", ... } dict
  const { data: memoryDict } = useSWR<Record<string, string>>(
    'memory-list',
    () => api.listMemory(),
    { revalidateOnFocus: false }
  );

  useEffect(() => {
    if (memoryDict && typeof memoryDict === 'object') {
      const names = Object.keys(memoryDict);
      const merged = [...new Set([...defaultFiles, ...names])];
      setAvailableFiles(merged);
    }
  }, [memoryDict]);

  const fetchContent = useCallback(async (filename: string) => {
    try {
      // Try from already-loaded dict first
      if (memoryDict && memoryDict[filename]) {
        setContent(memoryDict[filename]);
        return;
      }
      const resp = await fetch(`${typeof window !== 'undefined' ? window.location.origin : ''}/api/memory/${filename}`);
      if (!resp.ok) {
        setContent('(File not found or empty)');
        return;
      }
      const text = await resp.text();
      setContent(text);
    } catch {
      setContent('(File not found or empty)');
    }
  }, [memoryDict]);

  useEffect(() => {
    fetchContent(activeFile);
  }, [activeFile, fetchContent]);

  const handleEdit = () => {
    setEditContent(content);
    setEditing(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.putMemory(activeFile, editContent);
      setContent(editContent);
      setEditing(false);
    } catch (err) {
      console.error('Failed to save:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full pb-32">
      {/* File tabs */}
      <div className="flex gap-2 px-4 pt-4 pb-2 overflow-x-auto flex-shrink-0">
        {availableFiles.map((file) => (
          <button
            key={file}
            onClick={() => setActiveFile(file)}
            className="relative flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors min-h-[32px]"
            style={{
              background: activeFile === file ? 'var(--primary)' : 'var(--glass)',
              color: activeFile === file ? 'white' : 'var(--text-muted)',
            }}
          >
            {file}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4">
        <div className="glass rounded-xl p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
              {activeFile}
            </h3>
            <button
              onClick={handleEdit}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors min-h-[32px]"
              style={{ background: 'var(--primary-light)', color: 'var(--primary)' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              Edit
            </button>
          </div>
          <MarkdownRenderer content={content} />
        </div>
      </div>

      {/* Edit modal */}
      <Modal open={editing} onClose={() => setEditing(false)} fullScreen>
        <div className="flex flex-col h-full">
          <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
            <button
              onClick={() => setEditing(false)}
              className="text-sm font-medium min-h-[44px] min-w-[44px] flex items-center"
              style={{ color: 'var(--text-muted)' }}
            >
              Cancel
            </button>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
              {activeFile}
            </h3>
            <button
              onClick={handleSave}
              disabled={saving}
              className="text-sm font-medium min-h-[44px] min-w-[44px] flex items-center justify-end disabled:opacity-40"
              style={{ color: 'var(--primary)' }}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="flex-1 w-full p-4 text-sm font-mono bg-transparent border-none outline-none resize-none"
            style={{ color: 'var(--text)' }}
            spellCheck={false}
          />
        </div>
      </Modal>
    </div>
  );
}
