'use client';

import { useState, useCallback } from 'react';
import { api } from '@/lib/api';

export type VoiceState =
  | 'idle'
  | 'recording'
  | 'transcribing'
  | 'transcribed'
  | 'analyzing'
  | 'done'
  | 'error';

interface VoiceResult {
  audioBlob: Blob | null;
  transcription: string;
  analysis: string;
  audioId: string;
  error: string;
}

export function useVoiceProcessing() {
  const [state, setState] = useState<VoiceState>('idle');
  const [result, setResult] = useState<VoiceResult>({
    audioBlob: null,
    transcription: '',
    analysis: '',
    audioId: '',
    error: '',
  });

  const reset = useCallback(() => {
    setState('idle');
    setResult({ audioBlob: null, transcription: '', analysis: '', audioId: '', error: '' });
  }, []);

  const transcribe = useCallback(async (blob: Blob) => {
    setState('transcribing');
    setResult(prev => ({ ...prev, audioBlob: blob, error: '' }));
    try {
      const data = await api.transcribeAudio(blob);
      setResult(prev => ({ ...prev, transcription: data.text, audioId: data.audio_id }));
      setState('transcribed');
      return data.text;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Transcription failed';
      setResult(prev => ({ ...prev, error: msg }));
      setState('error');
      return '';
    }
  }, []);

  const analyze = useCallback(async (text?: string) => {
    const toAnalyze = text || result.transcription;
    if (!toAnalyze) return;
    setState('analyzing');
    try {
      const data = await api.analyzeText(toAnalyze);
      setResult(prev => ({ ...prev, analysis: data.analysis }));
      setState('done');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Analysis failed';
      setResult(prev => ({ ...prev, error: msg }));
      setState('error');
    }
  }, [result.transcription]);

  const transcribeAndAnalyze = useCallback(async (blob: Blob) => {
    const text = await transcribe(blob);
    if (text) {
      await analyze(text);
    }
  }, [transcribe, analyze]);

  return {
    state,
    setState,
    result,
    reset,
    transcribe,
    analyze,
    transcribeAndAnalyze,
  };
}
