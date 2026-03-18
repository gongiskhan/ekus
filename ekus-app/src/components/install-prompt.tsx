'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function isIos() {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent);
}

function isInStandaloneMode() {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in navigator && (navigator as unknown as { standalone: boolean }).standalone)
  );
}

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showBanner, setShowBanner] = useState(false);
  const [showIosInstructions, setShowIosInstructions] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Already installed or dismissed
    if (isInStandaloneMode()) return;
    if (localStorage.getItem('ekus-install-dismissed')) return;

    // Chrome/Android: capture the install prompt event
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      // Show banner after a short delay so it doesn't flash immediately
      setTimeout(() => setShowBanner(true), 2000);
    };
    window.addEventListener('beforeinstallprompt', handler);

    // iOS: show custom instructions after delay
    if (isIos()) {
      setTimeout(() => setShowBanner(true), 3000);
    }

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = useCallback(async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setShowBanner(false);
      }
      setDeferredPrompt(null);
    } else if (isIos()) {
      setShowIosInstructions(true);
    }
  }, [deferredPrompt]);

  const handleDismiss = () => {
    setShowBanner(false);
    setDismissed(true);
    localStorage.setItem('ekus-install-dismissed', '1');
  };

  if (dismissed || isInStandaloneMode()) return null;

  return (
    <>
      {/* Install banner */}
      <AnimatePresence>
        {showBanner && (
          <motion.div
            initial={{ opacity: 0, y: 60 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 60 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="fixed bottom-20 left-3 right-3 z-[90] rounded-2xl p-4 shadow-xl"
            style={{
              background: 'linear-gradient(135deg, #059669 0%, #047857 100%)',
              boxShadow: '0 8px 32px rgba(5, 150, 105, 0.3)',
            }}
          >
            <div className="flex items-start gap-3">
              {/* App icon */}
              <div className="flex-shrink-0 w-12 h-12 rounded-xl overflow-hidden shadow-lg bg-white/20 flex items-center justify-center">
                <img src="/icon-192.png" alt="Ekus" className="w-10 h-10 rounded-lg" />
              </div>

              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-white">Install Ekus</h3>
                <p className="text-xs text-white/80 mt-0.5 leading-relaxed">
                  Add to your home screen for a full-screen app experience with quick access.
                </p>
              </div>

              {/* Close button */}
              <button
                onClick={handleDismiss}
                className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-full"
                style={{ background: 'rgba(255,255,255,0.15)' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <button
              onClick={handleInstall}
              className="w-full mt-3 py-2.5 rounded-xl text-sm font-semibold transition-colors"
              style={{ background: 'white', color: '#059669' }}
            >
              {isIos() ? 'How to Install' : 'Install App'}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* iOS instructions modal */}
      <AnimatePresence>
        {showIosInstructions && (
          <motion.div
            className="fixed inset-0 z-[200] flex items-end justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowIosInstructions(false)} />
            <motion.div
              className="relative z-10 w-full max-w-lg rounded-t-3xl p-6 pb-10"
              style={{ background: 'var(--bg)' }}
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            >
              <div className="w-10 h-1 rounded-full mx-auto mb-5" style={{ background: 'var(--text-muted)' }} />
              <h3 className="text-lg font-bold mb-4" style={{ color: 'var(--text)' }}>
                Install Ekus on iPhone
              </h3>

              <div className="space-y-4">
                <Step
                  number={1}
                  text="Tap the Share button in Safari"
                  icon={<ShareIcon />}
                />
                <Step
                  number={2}
                  text={`Scroll down and tap "Add to Home Screen"`}
                  icon={<PlusSquareIcon />}
                />
                <Step
                  number={3}
                  text={`Tap "Add" in the top right`}
                  icon={null}
                />
              </div>

              <p className="text-xs mt-4 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                Ekus will appear on your home screen and open as a full-screen app, just like a native app.
              </p>

              <button
                onClick={() => setShowIosInstructions(false)}
                className="w-full mt-5 py-3 rounded-xl text-sm font-semibold"
                style={{ background: 'var(--primary)', color: 'white' }}
              >
                Got it
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function Step({ number, text, icon }: { number: number; text: string; icon: React.ReactNode | null }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
        style={{ background: 'var(--primary-light)', color: 'var(--primary)' }}
      >
        {number}
      </div>
      <p className="text-sm flex-1" style={{ color: 'var(--text)' }}>{text}</p>
      {icon && <span style={{ color: 'var(--primary)' }}>{icon}</span>}
    </div>
  );
}

function ShareIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  );
}

function PlusSquareIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <line x1="12" y1="8" x2="12" y2="16" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  );
}
