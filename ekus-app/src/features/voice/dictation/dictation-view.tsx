'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useDictation } from './use-dictation';
import { useCorrections } from './use-corrections';
import { DictationControls } from './dictation-controls';
import { DictationTranscript } from './dictation-transcript';
import { DictationToolbar } from './dictation-toolbar';
import { CorrectionsPanel } from './corrections-panel';

export function DictationView() {
  const { state, audioLevel, startRecording, stopRecording, setLanguage } = useDictation();
  const { corrections, addCorrectionsBatch, deleteCorrection } = useCorrections(state.language);
  const [correctionsOpen, setCorrectionsOpen] = useState(false);

  const isIdle = state.status === 'idle';
  const hasSegments = state.segments.length > 0;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-1 flex flex-col px-4 pb-28 pt-4 max-w-lg mx-auto w-full min-h-0">

        {/* Header: language selector + corrections toggle */}
        <div className="flex items-center justify-between mb-4 flex-shrink-0">
          {/* Language selector */}
          <div className="segmented-control p-1 rounded-full flex">
            <button
              onClick={() => setLanguage('pt')}
              disabled={!isIdle}
              className={`px-4 py-1.5 text-sm font-medium rounded-full transition-all disabled:opacity-70 ${
                state.language === 'pt' ? 'segmented-active' : 'text-slate-400'
              }`}
            >
              PT
            </button>
            <button
              onClick={() => setLanguage('en')}
              disabled={!isIdle}
              className={`px-4 py-1.5 text-sm font-medium rounded-full transition-all disabled:opacity-70 ${
                state.language === 'en' ? 'segmented-active' : 'text-slate-400'
              }`}
            >
              EN
            </button>
          </div>

          {/* Corrections toggle */}
          <button
            onClick={() => setCorrectionsOpen(true)}
            className="glass flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors hover:bg-white/10"
            style={{ color: 'var(--text-secondary)' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            Corrections
            {corrections.length > 0 && (
              <span
                className="inline-flex items-center justify-center w-5 h-5 text-[10px] font-bold rounded-full"
                style={{ background: 'var(--primary)', color: 'white' }}
              >
                {corrections.length > 99 ? '99+' : corrections.length}
              </span>
            )}
          </button>
        </div>

        {/* Transcript area + controls */}
        {hasSegments || state.cleanedText || !isIdle ? (
          <>
            <div className="flex-1 min-h-0 mb-4">
              <DictationTranscript
                segments={state.segments}
                cleanedText={state.cleanedText}
                onCorrection={addCorrectionsBatch}
              />
            </div>
            <div className="flex-shrink-0 flex justify-center mb-4">
              <DictationControls
                status={state.status}
                vadActive={state.vadActive}
                audioLevel={audioLevel}
                onStart={startRecording}
                onStop={stopRecording}
              />
            </div>
          </>
        ) : (
          /* Idle empty state — center mic button vertically, offset up */
          <div className="flex-1 flex flex-col items-center justify-center gap-6 -mt-12">
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Tap the button to start dictating
            </p>
            <DictationControls
              status={state.status}
              vadActive={state.vadActive}
              audioLevel={audioLevel}
              onStart={startRecording}
              onStop={stopRecording}
            />
          </div>
        )}

        {/* Toolbar */}
        <AnimatePresence>
          {isIdle && hasSegments && (
            <div className="flex-shrink-0">
              <DictationToolbar
                segments={state.segments}
                cleanedText={state.cleanedText}
              />
            </div>
          )}
        </AnimatePresence>

        {/* Error */}
        <AnimatePresence>
          {state.error && (
            <motion.div
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex-shrink-0 px-4 py-3 rounded-xl text-sm text-center max-w-xs mx-auto mt-2"
              style={{ background: 'rgba(239, 68, 68, 0.1)', color: 'var(--red)' }}
            >
              {state.error}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Corrections panel */}
      <CorrectionsPanel
        isOpen={correctionsOpen}
        onClose={() => setCorrectionsOpen(false)}
        corrections={corrections}
        onDelete={deleteCorrection}
      />
    </div>
  );
}
