const getBase = () => typeof window !== 'undefined' ? window.location.origin : '';

async function checkedJson(r: Response) {
  if (!r.ok) {
    const text = await r.text().catch(() => r.statusText);
    let detail = text;
    try { detail = JSON.parse(text).detail || text; } catch {}
    throw new Error(detail);
  }
  return r.json();
}

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

  // Voice
  transcribeAudio: (file: Blob, filename?: string) => {
    const ext = file.type.includes('mp4') ? '.m4a' : file.type.includes('webm') ? '.webm' : '.wav';
    const form = new FormData();
    form.append('file', file, filename || `recording${ext}`);
    return fetch(`${getBase()}/api/voice/transcribe`, { method: 'POST', body: form }).then(checkedJson);
  },
  analyzeText: (text: string, prompt?: string) =>
    fetch(`${getBase()}/api/voice/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, prompt }),
    }).then(checkedJson),
  textToSpeech: (text: string, voice?: string) =>
    fetch(`${getBase()}/api/voice/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice }),
    }).then(r => {
      if (!r.ok) throw new Error(`TTS failed: ${r.statusText}`);
      return r.blob();
    }),

  // Voice dictation
  listCorrections: (language?: string) => {
    const params = language ? `?language=${language}` : '';
    return fetch(`${getBase()}/api/voice/corrections${params}`).then(checkedJson);
  },
  addCorrectionsBatch: (corrections: { original: string; corrected: string }[], language?: string) =>
    fetch(`${getBase()}/api/voice/corrections/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ corrections, language }),
    }).then(checkedJson),
  deleteCorrection: (id: number) =>
    fetch(`${getBase()}/api/voice/corrections/${id}`, { method: 'DELETE' }).then(checkedJson),
  getVoicePreferences: () =>
    fetch(`${getBase()}/api/voice/preferences`).then(checkedJson),
  updateVoicePreferences: (prefs: Record<string, string>) =>
    fetch(`${getBase()}/api/voice/preferences`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(prefs),
    }).then(checkedJson),
  cleanupText: (text: string, language?: string) =>
    fetch(`${getBase()}/api/voice/cleanup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, language }),
    }).then(checkedJson),
  listVocabulary: (language?: string) => {
    const params = language ? `?language=${language}` : '';
    return fetch(`${getBase()}/api/voice/vocabulary${params}`).then(checkedJson);
  },
  addVocabulary: (term: string, language?: string, category?: string) =>
    fetch(`${getBase()}/api/voice/vocabulary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ term, language, category }),
    }).then(checkedJson),
  deleteVocabulary: (id: number) =>
    fetch(`${getBase()}/api/voice/vocabulary/${id}`, { method: 'DELETE' }).then(checkedJson),

  // WhatsApp
  listWhatsAppConversations: () =>
    fetch(`${getBase()}/api/whatsapp/conversations`).then(r => r.json()),
  sendWhatsApp: (recipient: string, message: string) =>
    fetch(`${getBase()}/api/whatsapp/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient, message }),
    }).then(r => r.json()),
  sendWhatsAppAudio: (recipient: string, text: string, voice?: string) =>
    fetch(`${getBase()}/api/whatsapp/send-audio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient, text, voice }),
    }).then(r => r.json()),

  // Projects
  listProjects: () => fetch(`${getBase()}/api/projects`).then(r => r.json()),
  createProject: (name: string) =>
    fetch(`${getBase()}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }).then(r => r.json()),

  // Health
  checkHealth: () => fetch(`${getBase()}/health`).then(r => r.json()),

  // Channel
  sendChannelMessage: (message: string, sessionId?: string, files?: string[]) =>
    fetch(`${getBase()}/api/channel/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, session_id: sessionId, files }),
    }).then(r => r.json()),
  getChannelStatus: () =>
    fetch(`${getBase()}/api/channel/status`).then(r => r.json()),
  switchSession: (sessionId: string, workingDir?: string) =>
    fetch(`${getBase()}/api/channel/switch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, working_dir: workingDir }),
    }).then(r => r.json()),
  getChannelHistory: (sessionId: string) =>
    fetch(`${getBase()}/api/channel/history/${sessionId}`).then(r => r.json()),
};
