'use client';

import { useState, useCallback } from 'react';
import useSWR from 'swr';
import { api } from '@/lib/api';
import { useAppStore } from '@/lib/store';

interface ProjectFolder {
  name: string;
  path: string;
  has_git: boolean;
  modified: string;
}

export function ProjectsTab() {
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const setActiveSessionId = useAppStore((s) => s.setActiveSessionId);

  const { data, mutate } = useSWR<{ projects: ProjectFolder[] }>(
    'projects',
    () => api.listProjects(),
    { refreshInterval: 30000 }
  );

  const projects = data?.projects || [];

  const handleCreate = useCallback(async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      await api.createProject(name);
      setNewName('');
      mutate();
    } catch (err) {
      console.error('Failed to create project:', err);
    } finally {
      setCreating(false);
    }
  }, [newName, mutate]);

  const handleOpenProject = useCallback(async (project: ProjectFolder) => {
    // Create a new session for this project, then switch to chat
    try {
      const session = await api.createSession(project.name);
      // Start the session with the project's working directory
      await api.switchSession(session.id, project.path);
      setActiveSessionId(session.id);
      setActiveTab('chat');
    } catch (err) {
      console.error('Failed to open project:', err);
    }
  }, [setActiveSessionId, setActiveTab]);

  return (
    <div className="h-full overflow-y-auto px-4 pt-4 pb-24">
      <div className="max-w-lg mx-auto">
        <h2 className="text-base font-semibold mb-4" style={{ color: 'var(--text)' }}>
          Projects
        </h2>

        {/* Create new project */}
        <div className="glass rounded-xl p-3 mb-4 flex gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="New project name..."
            className="flex-1 bg-transparent text-sm px-3 py-2 rounded-lg border border-white/10 outline-none focus:border-white/30"
            style={{ color: 'var(--text)' }}
          />
          <button
            onClick={handleCreate}
            disabled={creating || !newName.trim()}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-opacity disabled:opacity-40"
            style={{ background: 'var(--primary)' }}
          >
            {creating ? '...' : 'Create'}
          </button>
        </div>

        {/* Project list */}
        <div className="flex flex-col gap-2">
          {projects.map((project) => (
            <button
              key={project.path}
              onClick={() => handleOpenProject(project)}
              className="glass rounded-xl p-4 text-left transition-all hover:scale-[1.01] active:scale-[0.99]"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: project.has_git ? 'rgba(34, 197, 94, 0.15)' : 'rgba(148, 163, 184, 0.15)' }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                    stroke={project.has_git ? 'var(--emerald)' : 'var(--text-muted)'}
                    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
                  >
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: 'var(--text)' }}>
                    {project.name}
                  </p>
                  <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                    {project.path}
                    {project.has_git && (
                      <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full"
                        style={{ background: 'rgba(34, 197, 94, 0.12)', color: 'var(--emerald)' }}
                      >
                        git
                      </span>
                    )}
                  </p>
                </div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </div>
            </button>
          ))}

          {projects.length === 0 && (
            <div className="text-center py-8 opacity-50">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1" className="mx-auto mb-2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No projects found</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
