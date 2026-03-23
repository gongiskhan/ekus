'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

export interface DictationSegment {
  id: number;
  state: 'recording' | 'transcribing' | 'final';
  partialText: string;
  finalText: string;
  editedText: string | null;
}

export interface DictationState {
  status: 'idle' | 'connecting' | 'recording' | 'stopping' | 'cleaning';
  language: 'pt' | 'en';
  segments: DictationSegment[];
  cleanedText: string | null;
  vadActive: boolean;
  error: string | null;
}

const getBase = () => typeof window !== 'undefined' ? window.location.origin : '';

let segmentCounter = 0;

export function useDictation() {
  const [state, setState] = useState<DictationState>({
    status: 'idle',
    language: 'pt',
    segments: [],
    cleanedText: null,
    vadActive: false,
    error: null,
  });
  const [audioLevel, setAudioLevel] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);
  const currentSegmentRef = useRef<number>(0);
  const stoppingRef = useRef(false);

  const updateLevel = useCallback(() => {
    if (!analyserRef.current) return;
    const data = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(data);
    const avg = data.reduce((a, b) => a + b, 0) / data.length;
    setAudioLevel(avg / 255);
    animFrameRef.current = requestAnimationFrame(updateLevel);
  }, []);

  const cleanupMedia = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    analyserRef.current = null;
    cancelAnimationFrame(animFrameRef.current);
    setAudioLevel(0);
  }, []);

  const cleanupWs = useCallback(() => {
    if (reconnectRef.current) clearTimeout(reconnectRef.current);
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const setLanguage = useCallback((lang: 'pt' | 'en') => {
    setState(prev => ({ ...prev, language: lang }));
  }, []);

  const startRecording = useCallback(async () => {
    setState(prev => ({ ...prev, status: 'connecting', error: null, segments: [], cleanedText: null }));
    stoppingRef.current = false;

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setState(prev => ({ ...prev, status: 'idle', error: 'Microphone not available. Requires HTTPS or localhost.' }));
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Audio analysis
      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyserNode = audioCtx.createAnalyser();
      analyserNode.fftSize = 256;
      source.connect(analyserNode);
      analyserRef.current = analyserNode;

      // WebSocket connection
      const base = getBase();
      const wsUrl = base.replace(/^http/, 'ws') + '/api/voice/dictation';
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        // Send start command
        ws.send(JSON.stringify({ type: 'start', language: state.language }));

        // Start MediaRecorder
        const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', '']
          .find(t => t === '' || MediaRecorder.isTypeSupported(t)) || '';
        const recorder = new MediaRecorder(stream, {
          ...(mimeType ? { mimeType } : {}),
        });
        mediaRecorderRef.current = recorder;

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) {
            ws.send(e.data);
          }
        };

        recorder.start(500); // 500ms timeslice

        segmentCounter = 0;
        currentSegmentRef.current = 0;

        setState(prev => ({ ...prev, status: 'recording' }));
        updateLevel();
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          switch (data.type) {
            case 'vad_state':
              setState(prev => ({ ...prev, vadActive: data.is_speech }));
              break;

            case 'partial': {
              const segId = data.segment_id ?? currentSegmentRef.current;
              setState(prev => {
                const segments = [...prev.segments];
                const idx = segments.findIndex(s => s.id === segId);
                if (idx >= 0) {
                  segments[idx] = { ...segments[idx], partialText: data.text };
                } else {
                  segments.push({
                    id: segId,
                    state: 'recording',
                    partialText: data.text,
                    finalText: '',
                    editedText: null,
                  });
                  currentSegmentRef.current = segId;
                }
                return { ...prev, segments };
              });
              break;
            }

            case 'final': {
              const segId = data.segment_id ?? currentSegmentRef.current;
              setState(prev => {
                const segments = [...prev.segments];
                const idx = segments.findIndex(s => s.id === segId);
                if (idx >= 0) {
                  segments[idx] = {
                    ...segments[idx],
                    state: 'final',
                    finalText: data.text,
                    partialText: data.text,
                  };
                } else {
                  segments.push({
                    id: segId,
                    state: 'final',
                    partialText: data.text,
                    finalText: data.text,
                    editedText: null,
                  });
                }
                return { ...prev, segments };
              });
              segmentCounter = segId + 1;
              currentSegmentRef.current = segId + 1;
              break;
            }

            case 'cleanup':
              setState(prev => ({
                ...prev,
                status: 'idle',
                cleanedText: data.text,
              }));
              // Don't close yet — wait for 'stopped' event
              break;

            case 'stopped':
              setState(prev => ({
                ...prev,
                status: 'idle',
                cleanedText: prev.cleanedText || data.text || null,
              }));
              // Clean close after receiving final result
              cleanupWs();
              break;

            case 'error':
              setState(prev => ({
                ...prev,
                error: data.message || 'Transcription error',
              }));
              break;
          }
        } catch {
          // ignore parse errors
        }
      };

      ws.onclose = () => {
        if (!stoppingRef.current && state.status === 'recording') {
          // Unexpected close — reconnect
          reconnectRef.current = setTimeout(() => {
            // Only reconnect if we're still supposed to be recording
          }, 3000);
        }
      };

      ws.onerror = () => {
        setState(prev => ({
          ...prev,
          status: 'idle',
          error: 'WebSocket connection failed. Check if the voice server is running.',
        }));
        cleanupMedia();
      };

    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      let error = `Could not start recording: ${msg}`;
      if (msg.includes('Permission') || msg.includes('NotAllowedError')) {
        error = 'Microphone permission denied. Please allow mic access.';
      } else if (msg.includes('secure') || msg.includes('getUserMedia')) {
        error = 'Microphone requires HTTPS.';
      }
      setState(prev => ({ ...prev, status: 'idle', error }));
    }
  }, [state.language, updateLevel, cleanupMedia, cleanupWs]);

  const stopRecording = useCallback(() => {
    stoppingRef.current = true;
    setState(prev => ({ ...prev, status: 'stopping' }));

    const ws = wsRef.current;
    const sendStopAndCleanup = () => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'stop' }));
      }
      cleanupMedia();
    };

    // Stop MediaRecorder — wait for final chunk before sending stop
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.onstop = () => sendStopAndCleanup();
      mediaRecorderRef.current.stop();
    } else {
      sendStopAndCleanup();
    }

    // If no result arrives within 60s (transcription can take 13s+ on CPU), go idle
    setTimeout(() => {
      setState(prev => {
        if (prev.status === 'stopping' || prev.status === 'cleaning') {
          cleanupWs();
          return { ...prev, status: 'idle' };
        }
        return prev;
      });
    }, 60000);
  }, [cleanupMedia, cleanupWs]);

  // Ping keepalive every 30s
  useEffect(() => {
    const interval = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupMedia();
      cleanupWs();
    };
  }, [cleanupMedia, cleanupWs]);

  return {
    state,
    audioLevel,
    startRecording,
    stopRecording,
    setLanguage,
  };
}
