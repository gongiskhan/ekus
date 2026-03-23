'use client';

import { useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { DictationSegment } from './use-dictation';

interface DictationTranscriptProps {
  segments: DictationSegment[];
  cleanedText: string | null;
  onCorrection: (pairs: { original: string; corrected: string }[]) => void;
}

function diffWords(original: string, edited: string): { original: string; corrected: string }[] {
  const origWords = original.trim().split(/\s+/);
  const editWords = edited.trim().split(/\s+/);
  const pairs: { original: string; corrected: string }[] = [];

  const len = Math.min(origWords.length, editWords.length);
  for (let i = 0; i < len; i++) {
    if (origWords[i] !== editWords[i]) {
      pairs.push({ original: origWords[i], corrected: editWords[i] });
    }
  }
  return pairs;
}

function SegmentLine({
  segment,
  onCorrection,
}: {
  segment: DictationSegment;
  onCorrection: (pairs: { original: string; corrected: string }[]) => void;
}) {
  const editRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  const handleInput = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (!editRef.current) return;
      const edited = editRef.current.innerText;
      if (edited !== segment.finalText) {
        const pairs = diffWords(segment.finalText, edited);
        if (pairs.length > 0) {
          onCorrection(pairs);
        }
      }
    }, 3000);
  }, [segment.finalText, onCorrection]);

  const handleBlur = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!editRef.current) return;
    const edited = editRef.current.innerText;
    if (edited !== segment.finalText) {
      const pairs = diffWords(segment.finalText, edited);
      if (pairs.length > 0) {
        onCorrection(pairs);
      }
    }
  }, [segment.finalText, onCorrection]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  if (segment.state === 'final') {
    return (
      <div
        ref={editRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onBlur={handleBlur}
        className="text-sm leading-relaxed outline-none rounded-lg px-2 py-1 -mx-2 transition-colors focus:bg-white/5"
        style={{ color: 'var(--text)' }}
      >
        {segment.editedText ?? segment.finalText}
      </div>
    );
  }

  // Partial / recording segment
  return (
    <motion.div
      animate={{ opacity: [0.6, 0.9, 0.6] }}
      transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
      className="text-sm leading-relaxed italic px-2 py-1 -mx-2"
      style={{ color: 'var(--text-secondary)', opacity: 0.6 }}
    >
      {segment.partialText || '...'}
    </motion.div>
  );
}

export function DictationTranscript({ segments, cleanedText, onCorrection }: DictationTranscriptProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [segments, cleanedText]);

  if (segments.length === 0 && !cleanedText) return null;

  return (
    <div ref={scrollRef} className="flex-1 overflow-auto space-y-1 min-h-0">
      {/* Segments */}
      {segments.map((seg) => (
        <SegmentLine key={seg.id} segment={seg} onCorrection={onCorrection} />
      ))}

      {/* Cleaned text card */}
      <AnimatePresence>
        {cleanedText && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="glass rounded-xl p-4 mt-4"
          >
            <h4 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--primary)' }}>
              Cleaned
            </h4>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text)' }}>
              {cleanedText}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
