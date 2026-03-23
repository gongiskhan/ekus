'use client';

import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '@/lib/store';
import type { Tab } from '@/lib/types';

const menuItems: { id: Tab | 'sessions'; label: string; icon: React.ReactNode }[] = [
  {
    id: 'sessions',
    label: 'Sessions',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
      </svg>
    ),
  },
  {
    id: 'scheduler',
    label: 'Schedule',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    id: 'notes',
    label: 'Notes',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
      </svg>
    ),
  },
  {
    id: 'memory',
    label: 'Memory',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
      </svg>
    ),
  },
  {
    id: 'projects',
    label: 'Projects',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
      </svg>
    ),
  },
];

export function SideMenu() {
  const { menuOpen, setMenuOpen, activeTab, setActiveTab, setSidebarOpen } = useAppStore();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen, setMenuOpen]);

  return (
    <AnimatePresence>
      {menuOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[60]"
            style={{ background: 'rgba(0, 0, 0, 0.4)' }}
          />

          {/* Menu panel */}
          <motion.div
            ref={menuRef}
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', stiffness: 400, damping: 35 }}
            className="fixed left-0 top-0 bottom-0 w-44 z-[61] rounded-r-3xl flex flex-col overflow-y-auto no-scrollbar"
            style={{
              background: 'rgba(15, 20, 25, 0.85)',
              backdropFilter: 'blur(40px)',
              WebkitBackdropFilter: 'blur(40px)',
              boxShadow: '8px 0 32px rgba(0, 0, 0, 0.3)',
            }}
          >
            {/* Brand */}
            <div className="px-6 pt-6 pb-8 mt-2">
              <h2 className="text-3xl font-extrabold tracking-tight text-white drop-shadow-md">Ekoa</h2>
            </div>

            {/* Menu items */}
            <nav className="flex flex-col gap-2 flex-1 px-2">
              {menuItems.map((item) => {
                const isActive = item.id === 'sessions' ? false : activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      if (item.id === 'sessions') {
                        setActiveTab('chat');
                        setMenuOpen(false);
                        setSidebarOpen(true);
                      } else {
                        setActiveTab(item.id as Tab);
                        setMenuOpen(false);
                      }
                    }}
                    className={`w-full flex items-center gap-4 px-4 py-3 rounded-2xl transition-all ${
                      isActive
                        ? 'nav-active text-white'
                        : 'text-slate-300 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <span className={isActive ? 'text-emerald-300' : 'text-emerald-400'}>
                      {item.icon}
                    </span>
                    <span className="font-medium text-lg">{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
