import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Tab } from './types';

interface AppStore {
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
  activeSessionId: string | null;
  setActiveSessionId: (id: string | null) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  menuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
}

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      activeTab: 'chat',
      setActiveTab: (tab) => set({ activeTab: tab }),
      activeSessionId: null,
      setActiveSessionId: (id) => set({ activeSessionId: id }),
      sidebarOpen: false,
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      menuOpen: false,
      setMenuOpen: (open) => set({ menuOpen: open }),
    }),
    {
      name: 'ekus-app-store',
      partialize: (state) => ({
        activeTab: state.activeTab,
        activeSessionId: state.activeSessionId,
      }),
    }
  )
);
