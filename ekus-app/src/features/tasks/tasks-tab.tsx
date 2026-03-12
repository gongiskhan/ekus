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
              className={`w-72 flex-shrink-0 rounded-xl p-2 transition-colors ${isDragOver ? 'bg-[var(--primary-light)]' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                setDragOverSection(section.id);
              }}
              onDragLeave={(e) => {
                // Only clear if leaving the column (not entering a child)
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setDragOverSection(null);
                }
              }}
              onDrop={(e) => handleDrop(section.id, e)}
            >
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
