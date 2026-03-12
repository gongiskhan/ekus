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
      <motion.div
        className="glass rounded-xl p-3 mb-2 cursor-grab active:cursor-grabbing"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
      >
        {/* Main task */}
        <div className="flex items-start gap-2">
          <button
            onClick={() => onToggle(task.id)}
            className="flex-shrink-0 mt-0.5 min-w-[20px] min-h-[20px] w-5 h-5 rounded border-2 flex items-center justify-center transition-colors"
            style={{
              borderColor: task.checked ? 'var(--primary)' : 'var(--text-muted)',
              background: task.checked ? 'var(--primary)' : 'transparent',
            }}
          >
            {task.checked && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </button>
          <div className="flex-1 min-w-0">
            <p
              className={`text-sm font-medium leading-snug ${task.checked ? 'line-through opacity-50' : ''}`}
              style={{ color: 'var(--text)' }}
            >
              {task.title}
            </p>
            {task.note && (
              <p className="text-xs mt-0.5 leading-snug" style={{ color: 'var(--text-muted)' }}>
                {task.note}
              </p>
            )}
          </div>
        </div>

        {/* Subtasks */}
        {task.subtasks.length > 0 && (
          <div className="ml-7 mt-2 space-y-1">
            {task.subtasks.map((st: Subtask, i: number) => (
              <div key={i} className="flex items-center gap-2">
                <button
                  onClick={() => onToggleSubtask(task.id, i)}
                  className="flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors"
                  style={{
                    borderColor: st.checked ? 'var(--primary)' : 'var(--text-muted)',
                    background: st.checked ? 'var(--primary)' : 'transparent',
                  }}
                >
                  {st.checked && (
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
                <span
                  className={`text-xs ${st.checked ? 'line-through opacity-50' : ''}`}
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {st.text}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-1 mt-2 pt-2 border-t flex-wrap" style={{ borderColor: 'var(--border)' }}>
          {actions.map((action, i) => (
            <button
              key={i}
              onClick={action.onClick}
              className="px-2.5 py-1 rounded-lg text-xs font-medium transition-colors"
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
                className="px-2 py-1 rounded text-xs font-medium hover:bg-white/40"
                style={{ color: 'var(--text-muted)' }}
              >
                No
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="p-1.5 rounded-lg hover:bg-red-50 transition-colors min-w-[32px] min-h-[32px] flex items-center justify-center"
              title="Delete"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}
