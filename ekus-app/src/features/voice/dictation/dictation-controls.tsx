'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface DictationControlsProps {
  status: 'idle' | 'connecting' | 'recording' | 'stopping' | 'cleaning';
  vadActive: boolean;
  audioLevel: number;
  onStart: () => void;
  onStop: () => void;
}

export function DictationControls({ status, vadActive, audioLevel, onStart, onStop }: DictationControlsProps) {
  const [duration, setDuration] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval>>(null);

  const isRecording = status === 'recording';
  const isConnecting = status === 'connecting';
  const isStopping = status === 'stopping' || status === 'cleaning';

  useEffect(() => {
    if (isRecording) {
      setDuration(0);
      timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRecording]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const handleClick = () => {
    if (isRecording) {
      onStop();
    } else if (status === 'idle') {
      onStart();
    }
  };

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Audio level rings + VAD indicator */}
      <AnimatePresence>
        {isRecording && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="flex flex-col items-center gap-3"
          >
            <div className="relative w-32 h-32 flex items-center justify-center">
              <motion.div
                className="absolute inset-0 rounded-full"
                style={{ border: '2px solid var(--primary)', opacity: 0.2 }}
                animate={{ scale: 1 + audioLevel * 0.5 }}
                transition={{ duration: 0.1 }}
              />
              <motion.div
                className="absolute inset-2 rounded-full"
                style={{ border: '2px solid var(--primary)', opacity: 0.4 }}
                animate={{ scale: 1 + audioLevel * 0.3 }}
                transition={{ duration: 0.1 }}
              />
              <motion.div
                className="absolute inset-4 rounded-full"
                style={{ background: 'var(--primary-light)' }}
                animate={{ scale: 1 + audioLevel * 0.15 }}
                transition={{ duration: 0.1 }}
              />
              <span className="relative text-2xl font-mono font-semibold" style={{ color: 'var(--primary)' }}>
                {formatTime(duration)}
              </span>
            </div>

            {/* Recording indicator */}
            <span className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--red)' }}>
              <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--red)' }} />
              Recording
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Record / Stop button */}
      <div className="record-btn-outer rounded-full p-4 w-28 h-28 flex items-center justify-center">
        <motion.button
          whileTap={{ scale: 0.92 }}
          onClick={handleClick}
          disabled={isConnecting || isStopping}
          className="record-btn-inner rounded-full w-full h-full flex flex-col items-center justify-center gap-1.5 disabled:opacity-50"
          style={{ color: isRecording ? 'var(--red)' : 'var(--text-secondary)' }}
        >
          {isConnecting ? (
            <div className="w-6 h-6 rounded-full animate-spin" style={{ border: '2px solid var(--primary-light)', borderTopColor: 'var(--primary)' }} />
          ) : isStopping ? (
            <div className="w-6 h-6 rounded-full animate-spin" style={{ border: '2px solid var(--text-muted)', borderTopColor: 'var(--text-secondary)' }} />
          ) : isRecording ? (
            <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          ) : (
            <>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="22" />
              </svg>
              <span className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>Dictate</span>
            </>
          )}
        </motion.button>
      </div>
    </div>
  );
}
