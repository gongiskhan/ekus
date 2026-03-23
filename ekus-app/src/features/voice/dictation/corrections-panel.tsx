'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { VoiceCorrection } from '@/lib/types';

interface CorrectionsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  corrections: VoiceCorrection[];
  onDelete: (id: number) => void;
}

export function CorrectionsPanel({ isOpen, onClose, corrections, onDelete }: CorrectionsPanelProps) {
  const [search, setSearch] = useState('');

  const filtered = corrections.filter(c =>
    c.original.toLowerCase().includes(search.toLowerCase()) ||
    c.corrected.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[60]"
            style={{ background: 'rgba(0, 0, 0, 0.4)' }}
            onClick={onClose}
          />

          {/* Panel — slides from right */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 400, damping: 35 }}
            className="fixed right-0 top-0 bottom-0 w-72 z-[61] rounded-l-3xl flex flex-col overflow-hidden"
            style={{
              background: 'rgba(15, 20, 25, 0.92)',
              backdropFilter: 'blur(40px)',
              WebkitBackdropFilter: 'blur(40px)',
              boxShadow: '-8px 0 32px rgba(0, 0, 0, 0.3)',
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-6 pb-4">
              <h2 className="text-lg font-semibold" style={{ color: 'var(--text)' }}>Corrections</h2>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Search */}
            <div className="px-5 pb-3">
              <input
                type="text"
                placeholder="Search corrections..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                style={{
                  background: 'var(--bg-secondary)',
                  color: 'var(--text)',
                  border: '1px solid var(--glass-border)',
                }}
              />
            </div>

            {/* List */}
            <div className="flex-1 overflow-auto px-5 pb-safe">
              {filtered.length === 0 && (
                <p className="text-sm text-center py-8" style={{ color: 'var(--text-muted)' }}>
                  {corrections.length === 0 ? 'No corrections yet' : 'No matches'}
                </p>
              )}

              {filtered.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-2 py-3 border-b"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate" style={{ color: 'var(--text)' }}>
                      <span style={{ color: 'var(--red)', opacity: 0.8, textDecoration: 'line-through' }}>
                        {c.original}
                      </span>
                      {' '}
                      <span style={{ color: 'var(--text-muted)' }}>&rarr;</span>
                      {' '}
                      <span style={{ color: 'var(--primary)' }}>
                        {c.corrected}
                      </span>
                    </p>
                    {c.frequency > 1 && (
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        x{c.frequency}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => onDelete(c.id)}
                    className="flex-shrink-0 p-1.5 rounded-lg hover:bg-white/10 transition-colors"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
