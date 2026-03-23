'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/api';
import type { VoiceState } from './use-voice-processing';

interface VoiceResultsProps {
  state: VoiceState;
  transcription: string;
  analysis: string;
  error: string;
  onAnalyze: () => void;
  onSendToWhatsApp: () => void;
  onReset: () => void;
  selectedContact?: { name: string; jid: string } | null;
  sending?: boolean;
  sent?: boolean;
}

export function VoiceResults({
  state,
  transcription,
  analysis,
  error,
  onAnalyze,
  onSendToWhatsApp,
  onReset,
  selectedContact,
  sending,
  sent,
}: VoiceResultsProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [ttsLoading, setTtsLoading] = useState(false);
  const [ttsUrl, setTtsUrl] = useState<string | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Auto-expand transcription when it's the only result (no analysis)
  useEffect(() => {
    if (transcription && !analysis) {
      setShowOriginal(true);
    } else if (analysis) {
      setShowOriginal(false);
    }
  }, [transcription, analysis]);

  // Auto-generate TTS when compressed text arrives
  useEffect(() => {
    if (!analysis) return;
    let cancelled = false;
    setTtsLoading(true);
    api.textToSpeech(analysis).then(blob => {
      if (cancelled) return;
      setTtsUrl(URL.createObjectURL(blob));
      setTtsLoading(false);
    }).catch(() => {
      if (!cancelled) setTtsLoading(false);
    });
    return () => { cancelled = true; };
  }, [analysis]);

  const playAudio = (url: string) => {
    if (isPlaying) {
      audioRef.current?.pause();
      setIsPlaying(false);
      return;
    }
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.onended = () => setIsPlaying(false);
    audio.play();
    setIsPlaying(true);
  };

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  if (state === 'idle' || state === 'recording') return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-4 w-full"
    >
      {/* Processing states */}
      <AnimatePresence mode="wait">
        {(state === 'transcribing' || state === 'analyzing') && (
          <motion.div
            key={state}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex items-center justify-center gap-3 py-8"
          >
            <div className="w-5 h-5 rounded-full animate-spin" style={{ border: '2px solid var(--primary-light)', borderTopColor: 'var(--primary)' }} />
            <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
              {state === 'transcribing' ? 'Transcribing...' : 'Compressing...'}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error */}
      {error && (
        <div className="glass rounded-xl p-4" style={{ borderColor: 'var(--red)' }}>
          <p className="text-sm" style={{ color: 'var(--red)' }}>{error}</p>
          <button onClick={onReset} className="mt-2 text-sm font-medium underline" style={{ color: 'var(--primary)' }}>
            Try again
          </button>
        </div>
      )}

      {/* Compressed message — primary result */}
      {analysis && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass rounded-xl p-4"
        >
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Compressed</h3>
            <button
              onClick={() => copyText(analysis)}
              className="p-1.5 rounded-lg transition-colors hover:bg-white/10"
              title="Copy"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            </button>
          </div>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            {analysis}
          </p>

          {/* TTS audio player */}
          {ttsLoading && (
            <div className="flex items-center gap-2 mt-3 py-2">
              <div className="w-4 h-4 rounded-full animate-spin" style={{ border: '2px solid var(--primary-light)', borderTopColor: 'var(--primary)' }} />
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Generating audio...</span>
            </div>
          )}
          {ttsUrl && (
            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => playAudio(ttsUrl)}
              className="mt-3 w-full py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-colors"
              style={{ background: 'var(--bg-secondary)', color: 'var(--text)' }}
            >
              {isPlaying ? (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="var(--primary)"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
                  Stop
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="var(--primary)"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                  Play compressed audio
                </>
              )}
            </motion.button>
          )}

          {/* WhatsApp send button */}
          {selectedContact && !sent && (
            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              whileTap={{ scale: 0.97 }}
              onClick={onSendToWhatsApp}
              disabled={sending}
              className="mt-2 w-full py-2.5 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 disabled:opacity-50"
              style={{ background: '#25D366' }}
            >
              {sending ? (
                <div className="w-4 h-4 rounded-full animate-spin" style={{ border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'white' }} />
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
                  <path d="M12 0C5.373 0 0 5.373 0 12c0 2.127.555 4.126 1.528 5.86L.06 23.65a.5.5 0 0 0 .612.612l5.84-1.49A11.94 11.94 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22a9.94 9.94 0 0 1-5.38-1.572l-.386-.232-3.466.885.905-3.4-.247-.395A9.94 9.94 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z" />
                </svg>
              )}
              Send audio to {selectedContact.name}
            </motion.button>
          )}
          {sent && (
            <div className="mt-2 flex items-center justify-center gap-2 py-2.5 rounded-xl" style={{ background: '#25D366', color: 'white' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span className="text-sm font-semibold">Sent to {selectedContact?.name}</span>
            </div>
          )}
        </motion.div>
      )}

      {/* Transcription — primary when no analysis, collapsible when analysis exists */}
      {transcription && (
        <div className="glass rounded-xl p-4">
          <button
            onClick={() => setShowOriginal(!showOriginal)}
            className="flex items-center justify-between w-full"
          >
            <h3 className="text-sm font-semibold" style={{ color: analysis ? 'var(--text-muted)' : 'var(--text)' }}>
              {analysis ? 'Original' : 'Transcription'}
            </h3>
            {analysis && (
              <svg
                width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2"
                style={{ transform: showOriginal ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s' }}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            )}
          </button>
          {showOriginal && (
            <motion.p
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="text-sm leading-relaxed mt-2"
              style={{ color: analysis ? 'var(--text-muted)' : 'var(--text-secondary)' }}
            >
              {transcription}
            </motion.p>
          )}
          {state === 'transcribed' && !analysis && (
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={onAnalyze}
              className="mt-3 w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-colors"
              style={{ background: 'var(--primary)' }}
            >
              Compress with AI
            </motion.button>
          )}
        </div>
      )}

      {/* Actions moved to voice-tab.tsx */}
    </motion.div>
  );
}
