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
      {/* File chip tabs */}
      <div className="flex gap-3 px-4 pt-4 pb-2 overflow-x-auto flex-shrink-0 no-scrollbar">
        {availableFiles.map((file) => (
          <button
            key={file}
            onClick={() => setActiveFile(file)}
            className="whitespace-nowrap flex-shrink-0 px-4 py-1.5 rounded-full text-sm font-medium transition-all min-h-[32px]"
            style={activeFile === file ? {
              background: 'rgba(255,255,255,0.15)',
              border: '1px solid rgba(42,157,143,0.5)',
              boxShadow: '0 0 15px rgba(42,157,143,0.4)',
              color: 'var(--text)',
            } : {
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid transparent',
              color: 'var(--text-secondary)',
            }}
          >
            {file}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4">
        <div className="glass-panel rounded-2xl p-5 mb-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold" style={{ color: 'var(--text)' }}>
              {activeFile}
            </h2>
            <button
              onClick={handleEdit}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold transition-opacity hover:opacity-90"
              style={{ background: '#b1ebc8', color: '#0f5132' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z" />
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
