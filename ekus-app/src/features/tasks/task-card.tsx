'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import type { Task, Subtask } from '@/lib/types';

export interface MoveAction {
  label: string;
  onClick: () => void;
}

interface TaskCardProps {
  task: Task;
  sectionId: string;
  onToggle: (taskId: number) => void;
  onToggleSubtask: (taskId: number, subtaskIndex: number) => void;
  actions: MoveAction[];
  onDelete: () => void;
}

export function TaskCard({
  task,
  sectionId,
  onToggle,
  onToggleSubtask,
  actions,
  onDelete,
}: TaskCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/json', JSON.stringify({ taskId: task.id, fromSection: sectionId }));
        e.dataTransfer.effectAllowed = 'move';
      }}
    >
      <motion.article
        className={`rounded-2xl p-4 cursor-grab active:cursor-grabbing flex flex-col gap-3 ${
          task.checked ? 'opacity-70' : ''
        }`}
        style={{
          background: 'rgba(255, 255, 255, 0.1)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.2)',
        }}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: task.checked ? 0.7 : 1, y: 0 }}
        transition={{ duration: 0.2 }}
      >
        {/* Main task */}
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={task.checked}
            onChange={() => onToggle(task.id)}
            className="custom-checkbox mt-0.5"
          />
          <div className="flex-1 min-w-0">
            <h3
              className={`font-bold text-white leading-tight drop-shadow-sm ${
                task.checked ? 'line-through text-white/80' : ''
              }`}
            >
              {task.title}
            </h3>
            {task.note && (
              <p className="text-sm mt-1 leading-snug text-[var(--text-secondary)]">
                {task.note}
              </p>
            )}
          </div>
        </div>

        {/* Subtasks */}
        {task.subtasks.length > 0 && (
          <ul className="flex flex-col gap-2 pl-[2.25rem]">
            {task.subtasks.map((st: Subtask, i: number) => (
              <li key={i} className="flex items-center gap-2 text-sm text-white/80">
                <input
                  type="checkbox"
                  checked={st.checked}
                  onChange={() => onToggleSubtask(task.id, i)}
                  className="custom-checkbox w-4 h-4"
                />
                <span className={st.checked ? 'line-through text-white/60' : ''}>
                  {st.text}
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* Action buttons */}
        <div
          className="flex items-center gap-1 pt-2 border-t flex-wrap"
          style={{ borderColor: 'rgba(255, 255, 255, 0.08)' }}
        >
          {actions.map((action, i) => (
            <button
              key={i}
              onClick={action.onClick}
              className="px-2.5 py-1 rounded-lg text-xs font-medium transition-colors hover:bg-white/10"
              style={{
                color: 'var(--primary)',
                background: 'var(--primary-light)',
              }}
            >
              {action.label}
            </button>
          ))}
          <div className="flex-1" />
          {confirmDelete ? (
            <div className="flex items-center gap-1">
              <span className="text-xs mr-1" style={{ color: 'var(--red)' }}>Delete?</span>
              <button
                onClick={() => { onDelete(); setConfirmDelete(false); }}
                className="px-2 py-1 rounded text-xs font-medium text-white"
                style={{ background: 'var(--red)' }}
              >
                Yes
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-2 py-1 rounded text-xs font-medium text-[var(--text-muted)] hover:bg-white/10"
              >
                No
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="p-1.5 rounded-lg hover:bg-white/10 transition-colors min-w-[32px] min-h-[32px] flex items-center justify-center text-[var(--text-muted)]"
              title="Delete"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      </motion.article>
    </div>
  );
}
