'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { DictationView } from './dictation/dictation-view';
import { VoiceRecorder } from './voice-recorder';
import { VoiceResults } from './voice-results';
import { useVoiceProcessing } from './use-voice-processing';
import { api } from '@/lib/api';

type VoiceMode = 'dictation' | 'voice-note';

interface Contact {
  name: string;
  jid: string;
}

function VoiceNoteView() {
  const { state, result, reset, transcribe, analyze, transcribeAndAnalyze } = useVoiceProcessing();
  const [processMode, setProcessMode] = useState<'transcribe' | 'full'>('full');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [autoSend, setAutoSend] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [sendError, setSendError] = useState('');
  const [contactSearch, setContactSearch] = useState('');

  useEffect(() => {
    api.listWhatsAppConversations().then(data => {
      setContacts(data.conversations || []);
    }).catch(() => {});
  }, []);

  const messageToSend = result.analysis || result.transcription;

  const sendToWhatsApp = useCallback(async () => {
    if (!selectedContact || !messageToSend) return;
    setSending(true);
    setSendError('');
    try {
      const res = await api.sendWhatsAppAudio(selectedContact.jid, messageToSend);
      if (res.ok) {
        setSent(true);
      } else {
        setSendError(res.error || 'Failed to send');
      }
    } catch {
      setSendError('Failed to send');
    } finally {
      setSending(false);
    }
  }, [selectedContact, messageToSend]);

  useEffect(() => {
    if (!autoSend || !selectedContact || !messageToSend || sent || sending) return;
    const shouldSend = state === 'done' || (state === 'transcribed' && processMode === 'transcribe');
    if (!shouldSend) return;

    setSending(true);
    setSendError('');
    api.sendWhatsAppAudio(selectedContact.jid, messageToSend)
      .then(res => {
        if (res.ok) setSent(true);
        else setSendError(res.error || 'Failed to send');
      })
      .catch(() => setSendError('Failed to send'))
      .finally(() => setSending(false));
  }, [state, autoSend, selectedContact, messageToSend, processMode, sent, sending]);

  const handleRecordingComplete = async (blob: Blob) => {
    setSent(false);
    setSendError('');
    if (processMode === 'full') {
      await transcribeAndAnalyze(blob);
    } else {
      await transcribe(blob);
    }
  };

  const handleReset = () => {
    reset();
    setSent(false);
    setSendError('');
  };

  const filteredContacts = contacts.filter(c =>
    c.name.toLowerCase().includes(contactSearch.toLowerCase())
  );

  const isProcessing = state === 'transcribing' || state === 'analyzing';
  const isDone = state === 'done' || (state === 'transcribed' && processMode === 'transcribe');

  return (
    <div className="flex-1 flex flex-col px-4 pb-20 pt-4 max-w-lg mx-auto w-full">
      {/* Contact selector */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
            Send to
          </span>
          {selectedContact && (
            <label className="flex items-center gap-1.5 cursor-pointer">
              <span className="text-xs" style={{ color: autoSend ? 'var(--primary)' : 'var(--text-muted)' }}>Auto</span>
              <button
                onClick={() => setAutoSend(!autoSend)}
                className="relative w-8 h-5 rounded-full transition-colors"
                style={{ background: autoSend ? 'var(--primary)' : 'rgba(255,255,255,0.12)' }}
              >
                <div
                  className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
                  style={{ transform: autoSend ? 'translateX(14px)' : 'translateX(2px)' }}
                />
              </button>
            </label>
          )}
        </div>

        {selectedContact ? (
          <button
            onClick={() => setSelectedContact(null)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl w-full text-left transition-colors"
            style={{ background: '#25D366', color: 'white' }}
          >
            <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold">
              {selectedContact.name.charAt(0).toUpperCase()}
            </div>
            <span className="flex-1 text-sm font-medium truncate">{selectedContact.name}</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        ) : (
          <div>
            <input
              type="text"
              placeholder="Search contacts..."
              value={contactSearch}
              onChange={e => setContactSearch(e.target.value)}
              className="w-full px-3 py-2 rounded-xl text-sm outline-none mb-2"
              style={{ background: 'var(--bg-secondary)', color: 'var(--text)', border: '1px solid var(--glass-border)' }}
            />
            <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
              {(contactSearch ? filteredContacts : contacts.slice(0, 10)).map(c => (
                <button
                  key={c.jid}
                  onClick={() => { setSelectedContact(c); setContactSearch(''); }}
                  className="glass flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors hover:bg-white/10"
                  style={{ color: 'var(--text)' }}
                >
                  <div className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-bold"
                    style={{ background: '#25D366' }}>
                    {c.name.charAt(0).toUpperCase()}
                  </div>
                  <span className="max-w-[100px] truncate">{c.name}</span>
                </button>
              ))}
              {contacts.length === 0 && (
                <span className="text-xs py-1.5" style={{ color: 'var(--text-muted)' }}>No contacts loaded</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Mode selector */}
      {state === 'idle' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mb-6">
          <div className="segmented-control p-1.5 rounded-full flex mx-auto w-[85%]">
            <button
              onClick={() => setProcessMode('full')}
              className={`flex-1 text-center py-2 text-sm font-medium rounded-full transition-all ${processMode === 'full' ? 'segmented-active' : 'text-slate-400'}`}
            >
              Compress
            </button>
            <button
              onClick={() => setProcessMode('transcribe')}
              className={`flex-1 text-center py-2 text-sm font-medium rounded-full transition-all ${processMode === 'transcribe' ? 'segmented-active' : 'text-slate-400'}`}
            >
              Transcribe Only
            </button>
          </div>
        </motion.div>
      )}

      {/* Recorder — centered vertically when idle/recording */}
      <div className={`flex justify-center ${state === 'idle' || state === 'recording' ? 'flex-1 items-center' : 'py-4'}`}
        style={{ display: 'flex' }}
      >
        <VoiceRecorder
          onRecordingComplete={handleRecordingComplete}
          disabled={isProcessing}
        />
      </div>

      {/* Results */}
      <div className="w-full mt-4">
        <VoiceResults
          state={state}
          transcription={result.transcription}
          analysis={result.analysis}
          error={result.error}
          onAnalyze={analyze}
          onSendToWhatsApp={sendToWhatsApp}
          onReset={handleReset}
          selectedContact={selectedContact}
          sending={sending}
          sent={sent}
        />
      </div>

      {/* Reset + error */}
      {isDone && (
        <div className="flex justify-center mt-4">
          <button
            onClick={handleReset}
            className="py-2.5 px-6 rounded-xl text-sm font-semibold transition-colors"
            style={{ color: 'var(--text-muted)', background: 'var(--bg-secondary)' }}
          >
            New Recording
          </button>
        </div>
      )}

      {sendError && (
        <p className="text-xs text-center mt-2" style={{ color: 'var(--red)' }}>{sendError}</p>
      )}
    </div>
  );
}

export function VoiceTab() {
  const [mode, setMode] = useState<VoiceMode>('dictation');

  return (
    <div className="h-full flex flex-col overflow-auto">
      {/* Mode selector at the top */}
      <div className="flex-shrink-0 px-4 pt-4 max-w-lg mx-auto w-full">
        <div className="segmented-control p-1.5 rounded-full flex mx-auto w-[70%]">
          <button
            onClick={() => setMode('dictation')}
            className={`flex-1 text-center py-2 text-sm font-medium rounded-full transition-all ${
              mode === 'dictation' ? 'segmented-active' : 'text-slate-400'
            }`}
          >
            Dictation
          </button>
          <button
            onClick={() => setMode('voice-note')}
            className={`flex-1 text-center py-2 text-sm font-medium rounded-full transition-all ${
              mode === 'voice-note' ? 'segmented-active' : 'text-slate-400'
            }`}
          >
            Voice Note
          </button>
        </div>
      </div>

      {/* Content */}
      {mode === 'dictation' ? (
        <DictationView />
      ) : (
        <VoiceNoteView />
      )}
    </div>
  );
}
