'use client';

import { useState, useCallback, useEffect } from 'react';
import useSWR from 'swr';
import { motion } from 'framer-motion';
import { api } from '@/lib/api';
import type { Task, TaskSection } from '@/lib/types';
import { parseTaskMarkdown, toMarkdown } from './task-utils';
import { TaskCard } from './task-card';
import { GlassCard } from '@/components/glass-card';
import { Modal } from '@/components/modal';
import { useDebounce } from '@/hooks/use-debounce';

interface TaskData {
  sections: TaskSection[];
  tasks: Record<string, Task[]>;
}

export function TasksTab() {
  const [taskData, setTaskData] = useState<TaskData | null>(null);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newNote, setNewNote] = useState('');

  const { data: rawContent, mutate } = useSWR<string>(
    'tasks',
    () => api.getTasks(),
    { refreshInterval: 30000 }
  );

  useEffect(() => {
    if (rawContent) {
      setTaskData(parseTaskMarkdown(rawContent));
    }
  }, [rawContent]);

  const saveToServer = useDebounce((data: TaskData) => {
    const md = toMarkdown(data.sections, data.tasks);
    api.putTasks(md).then(() => mutate());
  }, 1000);

  const updateTasks = useCallback(
    (updater: (data: TaskData) => TaskData) => {
      setTaskData((prev) => {
        if (!prev) return prev;
        const next = updater(prev);
        saveToServer(next);
        return next;
      });
    },
    [saveToServer]
  );

  const toggleTask = useCallback(
    (sectionId: string, taskId: number) => {
      updateTasks((data) => ({
        ...data,
        tasks: {
          ...data.tasks,
          [sectionId]: data.tasks[sectionId].map((t) =>
            t.id === taskId ? { ...t, checked: !t.checked } : t
          ),
        },
      }));
    },
    [updateTasks]
  );

  const toggleSubtask = useCallback(
    (sectionId: string, taskId: number, subtaskIndex: number) => {
      updateTasks((data) => ({
        ...data,
        tasks: {
          ...data.tasks,
          [sectionId]: data.tasks[sectionId].map((t) =>
            t.id === taskId
              ? {
                  ...t,
                  subtasks: t.subtasks.map((st, i) =>
                    i === subtaskIndex ? { ...st, checked: !st.checked } : st
                  ),
                }
              : t
          ),
        },
      }));
    },
    [updateTasks]
  );

  const moveTask = useCallback(
    (fromSection: string, taskId: number, toSection: string) => {
      updateTasks((data) => {
        const task = data.tasks[fromSection]?.find((t) => t.id === taskId);
        if (!task) return data;
        return {
          ...data,
          tasks: {
            ...data.tasks,
            [fromSection]: data.tasks[fromSection].filter((t) => t.id !== taskId),
            [toSection]: [...(data.tasks[toSection] || []), { ...task, section: toSection }],
          },
        };
      });
    },
    [updateTasks]
  );

  const deleteTask = useCallback(
    (sectionId: string, taskId: number) => {
      updateTasks((data) => ({
        ...data,
        tasks: {
          ...data.tasks,
          [sectionId]: data.tasks[sectionId].filter((t) => t.id !== taskId),
        },
      }));
    },
    [updateTasks]
  );

  const addTask = useCallback(() => {
    if (!addingTo || !newTitle.trim()) return;
    updateTasks((data) => ({
      ...data,
      tasks: {
        ...data.tasks,
        [addingTo]: [
          ...(data.tasks[addingTo] || []),
          {
            id: Date.now() + Math.random(),
            title: newTitle.trim(),
            note: newNote.trim(),
            checked: false,
            subtasks: [],
            section: addingTo,
          },
        ],
      },
    }));
    setNewTitle('');
    setNewNote('');
    setAddingTo(null);
  }, [addingTo, newTitle, newNote, updateTasks]);

  if (!taskData) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const { sections, tasks } = taskData;

  return (
    <div className="h-full overflow-x-auto pb-32">
      <div className="flex gap-4 p-4 min-w-max">
        {sections.map((section, sectionIndex) => {
          const sectionTasks = tasks[section.id] || [];
          const prevSection = sectionIndex > 0 ? sections[sectionIndex - 1] : null;
          const nextSection = sectionIndex < sections.length - 1 ? sections[sectionIndex + 1] : null;

          return (
            <div key={section.id} className="w-72 flex-shrink-0">
              <div className="flex items-center justify-between mb-3 px-1">
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                  {section.name}
                </h3>
                <span
                  className="text-xs px-2 py-0.5 rounded-full"
                  style={{ background: 'var(--primary-light)', color: 'var(--primary)' }}
                >
                  {sectionTasks.length}
                </span>
              </div>

              <div className="space-y-0">
                {sectionTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onToggle={() => toggleTask(section.id, task.id)}
                    onToggleSubtask={(_, si) => toggleSubtask(section.id, task.id, si)}
                    onMoveLeft={
                      prevSection
                        ? () => moveTask(section.id, task.id, prevSection.id)
                        : undefined
                    }
                    onMoveRight={
                      nextSection
                        ? () => moveTask(section.id, task.id, nextSection.id)
                        : undefined
                    }
                    onDelete={() => deleteTask(section.id, task.id)}
                  />
                ))}
              </div>

              <button
                onClick={() => setAddingTo(section.id)}
                className="w-full mt-2 p-2 rounded-xl text-sm font-medium hover:bg-white/40 transition-colors flex items-center justify-center gap-1 min-h-[44px]"
                style={{ color: 'var(--text-muted)', border: '1px dashed var(--border)' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Add task
              </button>
            </div>
          );
        })}
      </div>

      {/* Add task modal */}
      <Modal open={addingTo !== null} onClose={() => setAddingTo(null)}>
        <div className="p-5">
          <h3 className="text-base font-semibold mb-4" style={{ color: 'var(--text)' }}>
            Add Task
          </h3>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>
                Title
              </label>
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl text-sm bg-white/50 border-none outline-none min-h-[44px]"
                style={{ color: 'var(--text)' }}
                placeholder="Task title"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && addTask()}
              />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>
                Note (optional)
              </label>
              <input
                type="text"
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl text-sm bg-white/50 border-none outline-none min-h-[44px]"
                style={{ color: 'var(--text)' }}
                placeholder="Additional details"
                onKeyDown={(e) => e.key === 'Enter' && addTask()}
              />
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setAddingTo(null)}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-white/40 transition-colors min-h-[44px]"
                style={{ color: 'var(--text-muted)' }}
              >
                Cancel
              </button>
              <button
                onClick={addTask}
                disabled={!newTitle.trim()}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium text-white transition-colors min-h-[44px] disabled:opacity-40"
                style={{ background: 'var(--primary)' }}
              >
                Add
              </button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
