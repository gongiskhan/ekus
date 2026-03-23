'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface VoiceRecorderProps {
  onRecordingComplete: (blob: Blob) => void;
  disabled?: boolean;
}

export function VoiceRecorder({ onRecordingComplete, disabled }: VoiceRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const animFrame = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval>>(null);
  const chunks = useRef<Blob[]>([]);

  const updateLevel = useCallback(() => {
    if (!analyser.current) return;
    const data = new Uint8Array(analyser.current.frequencyBinCount);
    analyser.current.getByteFrequencyData(data);
    const avg = data.reduce((a, b) => a + b, 0) / data.length;
    setAudioLevel(avg / 255);
    animFrame.current = requestAnimationFrame(updateLevel);
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Microphone not available. This requires HTTPS or localhost.');
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyserNode = audioCtx.createAnalyser();
      analyserNode.fftSize = 256;
      source.connect(analyserNode);
      analyser.current = analyserNode;

      // Pick best supported audio format (Safari/iOS doesn't support webm)
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac', '']
        .find(t => t === '' || MediaRecorder.isTypeSupported(t)) || '';
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

      chunks.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        audioCtx.close();
        cancelAnimationFrame(animFrame.current);
        const blob = new Blob(chunks.current, { type: recorder.mimeType || 'audio/webm' });
        onRecordingComplete(blob);
      };

      mediaRecorder.current = recorder;
      recorder.start(100);
      setIsRecording(true);
      setDuration(0);
      timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
      updateLevel();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      if (msg.includes('Permission') || msg.includes('NotAllowedError')) {
        setError('Microphone permission denied. Please allow mic access.');
      } else if (msg.includes('secure') || msg.includes('getUserMedia')) {
        setError('Microphone requires HTTPS. Try accessing via localhost or enable HTTPS.');
      } else {
        setError(`Could not start recording: ${msg}`);
      }
    }
  }, [onRecordingComplete, updateLevel]);

  const stopRecording = useCallback(() => {
    if (mediaRecorder.current?.state === 'recording') {
      mediaRecorder.current.stop();
    }
    if (timerRef.current) clearInterval(timerRef.current);
    setIsRecording(false);
    setAudioLevel(0);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      cancelAnimationFrame(animFrame.current);
    };
  }, []);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col items-center gap-6">
      {/* Recording indicator */}
      <AnimatePresence>
        {isRecording && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="flex flex-col items-center gap-3"
          >
            {/* Audio level rings */}
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
            <span className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--red)' }}>
              <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--red)' }} />
              Recording
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Record / Stop button — neumorphic */}
      <div className="record-btn-outer rounded-full p-4 w-28 h-28 flex items-center justify-center">
        <motion.button
          whileTap={{ scale: 0.92 }}
          onClick={isRecording ? stopRecording : startRecording}
          disabled={disabled}
          className="record-btn-inner rounded-full w-full h-full flex flex-col items-center justify-center gap-1.5 disabled:opacity-50"
          style={{ color: isRecording ? 'var(--red)' : 'var(--text-secondary)' }}
        >
          {isRecording ? (
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
              <span className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>Tap to Record</span>
            </>
          )}
        </motion.button>
      </div>

      {error && (
        <motion.div
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          className="px-4 py-3 rounded-xl text-sm text-center max-w-xs"
          style={{ background: 'rgba(239, 68, 68, 0.1)', color: 'var(--red, #ef4444)' }}
        >
          {error}
        </motion.div>
      )}
      {/* Hint text hidden — label is inside the button now */}
    </div>
  );
}
