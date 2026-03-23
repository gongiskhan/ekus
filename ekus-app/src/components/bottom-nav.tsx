'use client';

import { motion } from 'framer-motion';
import { useAppStore } from '@/lib/store';
import type { Tab } from '@/lib/types';

const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
  {
    id: 'chat',
    label: 'Chat',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    id: 'tasks',
    label: 'Tasks',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </svg>
    ),
  },
  {
    id: 'voice',
    label: 'Voice',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="22" />
      </svg>
    ),
  },
];

export function BottomNav() {
  const { activeTab, setActiveTab } = useAppStore();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 safe-bottom z-50 rounded-t-3xl"
      style={{
        background: 'rgba(15, 20, 25, 0.8)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        borderTop: '1px solid rgba(255, 255, 255, 0.08)',
        boxShadow: '0 -8px 30px rgba(0, 0, 0, 0.15)',
      }}
    >
      <div className="flex items-center justify-around max-w-md mx-auto pt-2 px-2">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="relative flex flex-col items-center justify-center min-w-[56px] min-h-[56px] flex-1 transition-colors press-feedback"
              style={{ WebkitTapHighlightColor: 'transparent' }}
              aria-label={tab.label}
            >
              {isActive && (
                <motion.div
                  layoutId="tab-indicator"
                  className="absolute inset-1 rounded-2xl bg-[#2a9d8f]"
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
              <span
                className={`relative z-10 transition-colors ${isActive ? 'text-white' : 'text-slate-500'}`}
              >
                {tab.icon}
              </span>
              <span
                className={`relative z-10 text-[11px] font-medium mt-0.5 transition-colors ${isActive ? 'text-white' : 'text-slate-500'}`}
              >
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
