const getBase = () => typeof window !== 'undefined' ? window.location.origin : '';

export const api = {
  // Jobs
  listJobs: (conversationId?: string | null) => {
    const params = conversationId ? `?conversation_id=${conversationId}` : '';
    return fetch(`${getBase()}/api/jobs${params}`).then(r => r.json());
  },
  getJob: (id: string) => fetch(`${getBase()}/api/job/${id}`).then(r => r.json()),
  getJobOutput: (id: string) => fetch(`${getBase()}/api/job/${id}/output`).then(r => r.text()),
  createJob: (prompt: string, conversationId?: string | null) =>
    fetch(`${getBase()}/job`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, conversation_id: conversationId || undefined }),
    }).then(r => r.json()),
  createJobWithFiles: (prompt: string, files: File[], conversationId?: string | null) => {
    const form = new FormData();
    form.append('prompt', prompt);
    if (conversationId) form.append('conversation_id', conversationId);
    files.forEach(f => form.append('files', f));
    return fetch(`${getBase()}/api/job/with-files`, { method: 'POST', body: form }).then(r => r.json());
  },
  stopJob: (id: string) => fetch(`${getBase()}/job/${id}`, { method: 'DELETE' }).then(r => r.json()),

  // Streaming
  streamJob: (id: string, offset = 0) => {
    return new EventSource(`${getBase()}/api/job/${id}/stream?offset=${offset}`);
  },

  // Sessions
  listSessions: () => fetch(`${getBase()}/api/sessions`).then(r => r.json()),
  createSession: (name?: string) =>
    fetch(`${getBase()}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }).then(r => r.json()),
  renameSession: (id: string, name: string) =>
    fetch(`${getBase()}/api/sessions/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }).then(r => r.json()),
  deleteSession: (id: string) =>
    fetch(`${getBase()}/api/sessions/${id}`, { method: 'DELETE' }).then(r => r.json()),

  // Tasks
  getTasks: () => fetch(`${getBase()}/api/tasks`).then(r => r.text()),
  putTasks: (content: string) =>
    fetch(`${getBase()}/api/tasks`, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain' },
      body: content,
    }),

  // Scheduler
  listSchedulerJobs: () => fetch(`${getBase()}/api/scheduler/jobs`).then(r => r.json()),
  addSchedulerJob: (job: Record<string, unknown>) =>
    fetch(`${getBase()}/api/scheduler/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(job),
    }).then(r => r.json()),
  updateSchedulerJob: (id: string, data: Record<string, unknown>) =>
    fetch(`${getBase()}/api/scheduler/jobs/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then(r => r.json()),
  deleteSchedulerJob: (id: string) =>
    fetch(`${getBase()}/api/scheduler/jobs/${id}`, {
      method: 'DELETE',
    }).then(r => r.json()),
  runSchedulerJob: (id: string) =>
    fetch(`${getBase()}/api/scheduler/jobs/${id}/run`, {
      method: 'POST',
    }).then(r => r.json()),
  getSchedulerJobLogs: (id: string) =>
    fetch(`${getBase()}/api/scheduler/jobs/${id}/logs`).then(r => r.json()),

  // Memory
  listMemory: () => fetch(`${getBase()}/api/memory`).then(r => r.json()),
  getMemory: (name: string) => fetch(`${getBase()}/api/memory/${name}`).then(r => r.text()),
  putMemory: (name: string, content: string) =>
    fetch(`${getBase()}/api/memory/${name}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain' },
      body: content,
    }),
  deleteMemory: (name: string) =>
    fetch(`${getBase()}/api/memory/${name}`, { method: 'DELETE' }),

  // Upload
  uploadFile: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return fetch(`${getBase()}/api/upload`, { method: 'POST', body: form }).then(r => r.json());
  },

  // Health
  checkHealth: () => fetch(`${getBase()}/health`).then(r => r.json()),
};
