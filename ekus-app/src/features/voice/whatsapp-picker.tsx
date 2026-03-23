'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/api';

interface WhatsAppPickerProps {
  isOpen: boolean;
  onClose: () => void;
  message: string;
}

interface Conversation {
  name: string;
  jid: string;
}

export function WhatsAppPicker({ isOpen, onClose, message }: WhatsAppPickerProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (isOpen) {
      setLoading(true);
      setError('');
      setSent(null);
      api.listWhatsAppConversations()
        .then(data => {
          setConversations(data.conversations || []);
          if (data.error) setError(data.error);
        })
        .catch(() => setError('Failed to load conversations'))
        .finally(() => setLoading(false));
    }
  }, [isOpen]);

  const send = async (recipient: string) => {
    setSending(recipient);
    try {
      const result = await api.sendWhatsApp(recipient, message);
      if (result.ok) {
        setSent(recipient);
        setTimeout(() => onClose(), 1500);
      } else {
        setError(result.error || 'Failed to send');
      }
    } catch {
      setError('Failed to send message');
    } finally {
      setSending(null);
    }
  };

  const filtered = conversations.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase())
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
            className="fixed inset-0 bg-black/30 z-50"
            onClick={onClose}
          />
          {/* Sheet */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 z-50 glass rounded-t-2xl max-h-[70vh] flex flex-col"
          >
            {/* Handle */}
            <div className="flex justify-center py-2">
              <div className="w-10 h-1 rounded-full" style={{ background: 'var(--text-muted)', opacity: 0.3 }} />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-4 pb-3">
              <h3 className="text-base font-semibold" style={{ color: 'var(--text)' }}>Send to WhatsApp</h3>
              <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Message preview */}
            <div className="mx-4 mb-3 p-3 rounded-xl text-xs leading-relaxed max-h-20 overflow-auto"
              style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}>
              {message.length > 200 ? message.slice(0, 200) + '...' : message}
            </div>

            {/* Search */}
            <div className="px-4 mb-3">
              <input
                type="text"
                placeholder="Search conversations..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                style={{
                  background: 'var(--bg-secondary)',
                  color: 'var(--text)',
                  border: '1px solid var(--border)',
                }}
              />
            </div>

            {/* List */}
            <div className="flex-1 overflow-auto px-4 pb-safe">
              {loading && (
                <div className="flex items-center justify-center py-8">
                  <div className="w-5 h-5 rounded-full animate-spin" style={{ border: '2px solid var(--primary-light)', borderTopColor: 'var(--primary)' }} />
                </div>
              )}

              {error && !loading && (
                <p className="text-sm text-center py-4" style={{ color: 'var(--red)' }}>{error}</p>
              )}

              {!loading && filtered.length === 0 && !error && (
                <p className="text-sm text-center py-4" style={{ color: 'var(--text-muted)' }}>
                  No conversations found
                </p>
              )}

              {filtered.map((convo) => (
                <button
                  key={convo.jid}
                  onClick={() => send(convo.jid)}
                  disabled={!!sending}
                  className="w-full flex items-center gap-3 p-3 rounded-xl mb-1 transition-colors hover:bg-white/10 disabled:opacity-50"
                >
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-semibold"
                    style={{ background: '#25D366' }}>
                    {convo.name.charAt(0).toUpperCase()}
                  </div>
                  <span className="flex-1 text-left text-sm font-medium" style={{ color: 'var(--text)' }}>
                    {convo.name}
                  </span>
                  {sending === convo.jid && (
                    <div className="w-4 h-4 rounded-full animate-spin" style={{ border: '2px solid var(--primary-light)', borderTopColor: 'var(--primary)' }} />
                  )}
                  {sent === convo.jid && (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--emerald)" strokeWidth="2">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
