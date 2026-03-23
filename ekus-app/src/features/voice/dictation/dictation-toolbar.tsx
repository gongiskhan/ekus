'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { api } from '@/lib/api';
import { WhatsAppPicker } from '../whatsapp-picker';

interface DictationToolbarProps {
  segments: { state: string; finalText: string; editedText: string | null }[];
  cleanedText: string | null;
}

export function DictationToolbar({ segments, cleanedText }: DictationToolbarProps) {
  const [copied, setCopied] = useState(false);
  const [sentChat, setSentChat] = useState(false);
  const [whatsappOpen, setWhatsappOpen] = useState(false);

  const getFullText = () => {
    if (cleanedText) return cleanedText;
    return segments
      .filter(s => s.state === 'final')
      .map(s => s.editedText ?? s.finalText)
      .join(' ');
  };

  const text = getFullText();
  const hasText = text.trim().length > 0;

  const handleCopy = async () => {
    if (!hasText) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSendToChat = async () => {
    if (!hasText) return;
    try {
      await api.sendChannelMessage(text);
      setSentChat(true);
      setTimeout(() => setSentChat(false), 2000);
    } catch {
      // silent
    }
  };

  const handleShare = async () => {
    if (!hasText || !navigator.share) return;
    try {
      await navigator.share({ text });
    } catch {
      // user cancelled or not supported
    }
  };

  if (!hasText) return null;

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-2 justify-center flex-wrap"
      >
        {/* Copy */}
        <button
          onClick={handleCopy}
          className="glass flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors hover:bg-white/10"
          style={{ color: copied ? 'var(--primary)' : 'var(--text)' }}
        >
          {copied ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          )}
          {copied ? 'Copied' : 'Copy'}
        </button>

        {/* Send to Chat */}
        <button
          onClick={handleSendToChat}
          className="glass flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors hover:bg-white/10"
          style={{ color: sentChat ? 'var(--primary)' : 'var(--text)' }}
        >
          {sentChat ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          )}
          {sentChat ? 'Sent' : 'Chat'}
        </button>

        {/* WhatsApp */}
        <button
          onClick={() => setWhatsappOpen(true)}
          className="glass flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors hover:bg-white/10"
          style={{ color: 'var(--text)' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ color: '#25D366' }}>
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
            <path d="M12 0C5.373 0 0 5.373 0 12c0 2.127.555 4.126 1.528 5.86L.06 23.65a.5.5 0 0 0 .612.612l5.84-1.49A11.94 11.94 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22a9.94 9.94 0 0 1-5.38-1.572l-.386-.232-3.466.885.905-3.4-.247-.395A9.94 9.94 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z" />
          </svg>
          WhatsApp
        </button>

        {/* Share (only if Web Share API available) */}
        {typeof navigator !== 'undefined' && typeof navigator.share === 'function' && (
          <button
            onClick={handleShare}
            className="glass flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors hover:bg-white/10"
            style={{ color: 'var(--text)' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="5" r="3" />
              <circle cx="6" cy="12" r="3" />
              <circle cx="18" cy="19" r="3" />
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
            </svg>
            Share
          </button>
        )}
      </motion.div>

      <WhatsAppPicker
        isOpen={whatsappOpen}
        onClose={() => setWhatsappOpen(false)}
        message={text}
      />
    </>
  );
}
