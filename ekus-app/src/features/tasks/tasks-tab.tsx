'use client';

import { useState, useCallback, useEffect } from 'react';
import useSWR from 'swr';
import { api } from '@/lib/api';
import type { Task, TaskSection } from '@/lib/types';
import { parseTaskMarkdown, toMarkdown } from './task-utils';
import { TaskCard } from './task-card';
import type { MoveAction } from './task-card';
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
  const [dragOverSection, setDragOverSection] = useState<string | null>(null);

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

  const moveTask = useCallback(
    (fromSection: string, taskId: number, toSection: string) => {
      updateTasks((data) => {
        const task = data.tasks[fromSection]?.find((t) => t.id === taskId);
        if (!task) return data;
        const movedTask = { ...task, section: toSection };
        // Auto-check when moving to done, auto-uncheck when moving to active
        if (toSection === 'done') movedTask.checked = true;
        if (toSection === 'active') movedTask.checked = false;
        return {
          ...data,
          tasks: {
            ...data.tasks,
            [fromSection]: data.tasks[fromSection].filter((t) => t.id !== taskId),
            [toSection]: [...(data.tasks[toSection] || []), movedTask],
          },
        };
      });
    },
    [updateTasks]
  );

  const toggleTask = useCallback(
    (sectionId: string, taskId: number) => {
      updateTasks((data) => {
        const task = data.tasks[sectionId]?.find((t) => t.id === taskId);
        if (!task) return data;

        // Checking a task in Active → move to Done
        if (sectionId === 'active' && !task.checked && data.tasks['done']) {
          return {
            ...data,
            tasks: {
              ...data.tasks,
              [sectionId]: data.tasks[sectionId].filter((t) => t.id !== taskId),
              done: [...data.tasks['done'], { ...task, checked: true, section: 'done' }],
            },
          };
        }

        // Unchecking a task in Done → move to Active
        if (sectionId === 'done' && task.checked && data.tasks['active']) {
          return {
            ...data,
            tasks: {
              ...data.tasks,
              [sectionId]: data.tasks[sectionId].filter((t) => t.id !== taskId),
              active: [...data.tasks['active'], { ...task, checked: false, section: 'active' }],
            },
          };
        }

        // Otherwise just toggle
        return {
          ...data,
          tasks: {
            ...data.tasks,
            [sectionId]: data.tasks[sectionId].map((t) =>
              t.id === taskId ? { ...t, checked: !t.checked } : t
            ),
          },
        };
      });
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

  const getActionsForTask = useCallback(
    (sectionId: string, taskId: number): MoveAction[] => {
      if (!taskData) return [];
      const sectionIds = taskData.sections.map((s) => s.id);
      const actions: MoveAction[] = [];

      if (sectionId !== 'waiting-on' && sectionIds.includes('waiting-on')) {
        actions.push({
          label: 'Waiting On',
          onClick: () => moveTask(sectionId, taskId, 'waiting-on'),
        });
      }
      if (sectionId !== 'done' && sectionIds.includes('done')) {
        actions.push({
          label: 'Done',
          onClick: () => moveTask(sectionId, taskId, 'done'),
        });
      }
      if (sectionId !== 'active' && sectionIds.includes('active')) {
        actions.push({
          label: 'Active',
          onClick: () => moveTask(sectionId, taskId, 'active'),
        });
      }

      return actions;
    },
    [taskData, moveTask]
  );

  const handleDrop = useCallback(
    (targetSection: string, e: React.DragEvent) => {
      e.preventDefault();
      setDragOverSection(null);
      try {
        const data = JSON.parse(e.dataTransfer.getData('application/json'));
        if (data.fromSection && data.fromSection !== targetSection) {
          moveTask(data.fromSection, data.taskId, targetSection);
        }
      } catch {
        // ignore invalid drag data
      }
    },
    [moveTask]
  );

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
        {sections.map((section) => {
          const sectionTasks = tasks[section.id] || [];
          const isDragOver = dragOverSection === section.id;

          return (
            <div
              key={section.id}
              className={`w-[280px] flex-shrink-0 glass-panel rounded-3xl p-4 flex flex-col gap-3 max-h-[calc(100vh-12rem)] overflow-y-auto no-scrollbar transition-colors ${
                isDragOver ? 'border-[var(--primary)] bg-[var(--primary-light)]' : ''
              }`}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                setDragOverSection(section.id);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setDragOverSection(null);
                }
              }}
              onDrop={(e) => handleDrop(section.id, e)}
            >
              <header className="flex items-center gap-2 px-2 pb-1">
                <h2 className="text-lg font-bold text-white drop-shadow-sm">
                  {section.name}
                </h2>
                <span className="bg-[var(--accent)] text-white text-sm font-bold w-6 h-6 flex items-center justify-center rounded-full shadow-sm">
                  {sectionTasks.length}
                </span>
              </header>

              <div className="flex flex-col gap-2">
                {sectionTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    sectionId={section.id}
                    onToggle={() => toggleTask(section.id, task.id)}
                    onToggleSubtask={(_, si) => toggleSubtask(section.id, task.id, si)}
                    actions={getActionsForTask(section.id, task.id)}
                    onDelete={() => deleteTask(section.id, task.id)}
                  />
                ))}
              </div>

              <button
                onClick={() => setAddingTo(section.id)}
                className="w-full py-3 rounded-2xl border-[1.5px] border-dashed border-[rgba(42,157,143,0.5)] text-white font-semibold flex justify-center items-center gap-2 hover:bg-white/5 transition-colors min-h-[44px]"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
          <h3 className="text-base font-semibold mb-4 text-white">
            Add Task
          </h3>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium mb-1 block text-[var(--text-secondary)]">
                Title
              </label>
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl text-sm text-white bg-white/5 border border-[var(--glass-border)] outline-none focus:border-[var(--primary)] transition-colors min-h-[44px] placeholder:text-[var(--text-muted)]"
                placeholder="Task title"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && addTask()}
              />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block text-[var(--text-secondary)]">
                Note (optional)
              </label>
              <input
                type="text"
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl text-sm text-white bg-white/5 border border-[var(--glass-border)] outline-none focus:border-[var(--primary)] transition-colors min-h-[44px] placeholder:text-[var(--text-muted)]"
                placeholder="Additional details"
                onKeyDown={(e) => e.key === 'Enter' && addTask()}
              />
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setAddingTo(null)}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium text-[var(--text-muted)] hover:bg-white/5 transition-colors min-h-[44px]"
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
