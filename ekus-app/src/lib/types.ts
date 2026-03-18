export interface Job {
  id: string;
  status: 'running' | 'completed' | 'failed' | 'stopped';
  prompt: string;
  full_prompt?: string;
  created_at: string;
  completed_at?: string;
  duration_seconds?: number;
  exit_code?: number;
  pid?: number;
  session?: string;
  log_file?: string;
  summary?: string;
  conversation_id?: string;
}

export interface ChatSession {
  id: string;
  name: string;
  created_at: string;
  updated_at?: string;
  job_count?: number;
  has_running?: boolean;
  last_prompt?: string;
}

export interface Task {
  id: number;
  title: string;
  note: string;
  checked: boolean;
  subtasks: Subtask[];
  section: string;
}

export interface Subtask {
  text: string;
  checked: boolean;
}

export interface TaskSection {
  id: string;
  name: string;
}

export interface SchedulerJob {
  id: string;
  description: string;
  schedule: string;
  prompt: string;
  enabled: boolean;
  last_run?: string;
}

export interface MemoryFile {
  name: string;
  size: number;
  modified: string;
}

export interface Note {
  id: string;
  content: string;
  created_at: string;
}

export type Tab = 'chat' | 'tasks' | 'scheduler' | 'memory' | 'notes';
