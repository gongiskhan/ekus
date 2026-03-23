'use client';

import { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface ChatInputProps {
  onSend: (prompt: string, files: File[]) => void;
  disabled?: boolean;
  uploading?: boolean;
}

export function ChatInput({ onSend, disabled, uploading }: ChatInputProps) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [showAttach, setShowAttach] = useState(false);
  const [inputKey, setInputKey] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed && files.length === 0) return;
    onSend(trimmed, files);
    setText('');
    setFiles([]);
    setShowAttach(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [text, files, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 120) + 'px';
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          setFiles((prev) => [...prev, file]);
        }
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files;
    if (selected) {
      setFiles((prev) => [...prev, ...Array.from(selected)]);
    }
    setInputKey((k) => k + 1);
    setShowAttach(false);
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="fixed bottom-[76px] left-0 right-0 safe-bottom z-40 px-4 pb-2">
      {/* File previews */}
      {files.length > 0 && (
        <div className="flex gap-2 px-3 pt-2 pb-1 overflow-x-auto">
          {files.map((file, i) => (
            <div key={i} className="relative flex-shrink-0">
              {file.type.startsWith('image/') ? (
                <img
                  src={URL.createObjectURL(file)}
                  alt={file.name}
                  className="w-14 h-14 rounded-lg object-cover border border-white/10"
                />
              ) : (
                <div
                  className="w-14 h-14 rounded-lg flex items-center justify-center"
                  style={{ background: 'rgba(255, 255, 255, 0.06)', border: '1px solid rgba(255, 255, 255, 0.1)' }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5eead4" strokeWidth="1.5">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <path d="M14 2v6h6" />
                  </svg>
                </div>
              )}
              <button
                onClick={() => removeFile(i)}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center text-xs"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Attach menu */}
      <AnimatePresence>
        {showAttach && (
          <>
          <div className="fixed inset-0 z-40" onClick={() => setShowAttach(false)} />
          <motion.div
            className="absolute bottom-full left-3 mb-2 rounded-xl overflow-hidden z-50"
            style={{
              background: 'rgba(26, 35, 50, 0.95)',
              backdropFilter: 'blur(24px)',
              WebkitBackdropFilter: 'blur(24px)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
            }}
            initial={{ opacity: 0, y: 8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ duration: 0.12 }}
          >
            <label
              htmlFor="ekus-camera-input"
              className="flex items-center gap-2 px-4 py-3 text-sm w-full text-left min-h-[44px] cursor-pointer transition-colors"
              style={{ color: 'var(--text)' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
              Camera
            </label>
            <label
              htmlFor="ekus-photos-input"
              className="flex items-center gap-2 px-4 py-3 text-sm w-full text-left min-h-[44px] cursor-pointer transition-colors"
              style={{ color: 'var(--text)' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="M21 15l-5-5L5 21" />
              </svg>
              Photos
            </label>
            <label
              htmlFor="ekus-file-input"
              className="flex items-center gap-2 px-4 py-3 text-sm w-full text-left min-h-[44px] cursor-pointer transition-colors"
              style={{ color: 'var(--text)' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
              File
            </label>
          </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Hidden file inputs */}
      <input key={`cam-${inputKey}`} id="ekus-camera-input" type="file" accept="image/*" capture="environment" className="sr-only" onChange={handleFileSelect} />
      <input key={`photo-${inputKey}`} id="ekus-photos-input" type="file" accept="image/*" className="sr-only" onChange={handleFileSelect} />
      <input key={`file-${inputKey}`} id="ekus-file-input" type="file" className="sr-only" onChange={handleFileSelect} />

      {/* Input bar */}
      <div
        className="flex items-end gap-2 p-2 rounded-2xl"
        style={{
          background: '#1a2636',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          boxShadow: '0 -2px 16px rgba(0, 0, 0, 0.25)',
        }}
      >
        <button
          className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center press-feedback transition-colors"
          style={{ background: 'rgba(255, 255, 255, 0.08)', border: '1px solid rgba(255, 255, 255, 0.1)' }}
          onClick={() => setShowAttach(!showAttach)}
          aria-label={showAttach ? 'Close attachments' : 'Attach file'}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          onPaste={handlePaste}
          placeholder="Type a message..."
          rows={1}
          disabled={disabled}
          className="flex-1 resize-none px-3 py-2 text-[16px] border-none outline-none bg-transparent text-white placeholder:text-white/40"
          style={{ maxHeight: 120 }}
        />

        <button
          onClick={handleSend}
          disabled={disabled || uploading || (!text.trim() && files.length === 0)}
          className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center press-feedback disabled:opacity-30 transition-colors"
          style={{ background: '#2a9d8f' }}
          aria-label="Send message"
        >
          {uploading ? (
            <div className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
