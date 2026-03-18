/**
 * Ekus Terminal Server
 *
 * Node.js PTY server that provides real-time streaming of Claude Code output
 * via WebSocket. Uses `claude -p --output-format stream-json` for incremental
 * output, parses JSON events, and sends clean text to WebSocket clients.
 *
 * - HTTP API for creating job sessions
 * - WebSocket streaming of parsed text to browser
 * - Writes clean text to log files for SSE fallback
 * - Supports late-joining clients (text replay)
 */

import { createServer } from 'http';
import { existsSync, writeFileSync, appendFileSync, readFileSync, unlinkSync } from 'fs';
import { join, resolve } from 'path';
import { WebSocketServer } from 'ws';
import pty from 'node-pty';

// =============================================================================
// Configuration
// =============================================================================

const CONFIG = {
  port: parseInt(process.env.TERMINAL_PORT || '7601', 10),
  host: process.env.HOST || '0.0.0.0',
  defaultCols: 120,
  defaultRows: 40,
  maxOutputBuffer: 512 * 1024,
};

const EKUS_ROOT = resolve(import.meta.dirname, '..', '..');
const JOBS_DIR = resolve(import.meta.dirname, '..', 'gateway', 'jobs');

// =============================================================================
// Job Management
// =============================================================================

const activeJobs = new Map();

/**
 * Extract displayable text from a stream-json event.
 * With --include-partial-messages, Claude Code emits:
 * - stream_event with content_block_delta (text_delta) — token-level incremental text
 * - assistant events (full message) — skip to avoid duplicates
 * - result events (full result) — fallback only if no deltas received
 */
function extractText(event, jobInfo) {
  // stream_event wrapping content_block_delta → text_delta (incremental tokens)
  if (event.type === 'stream_event') {
    const inner = event.event;
    if (inner?.type === 'content_block_delta' && inner.delta?.type === 'text_delta') {
      jobInfo.gotStreamDeltas = true;
      return inner.delta.text || '';
    }
    return '';
  }

  // content_block_delta at top level (Anthropic API format)
  if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
    jobInfo.gotStreamDeltas = true;
    return event.delta.text || '';
  }

  // Fallback: if we never got stream deltas (--include-partial-messages not working),
  // extract text from assistant/result events as a last resort
  if (!jobInfo.gotStreamDeltas) {
    if (event.type === 'result' && typeof event.result === 'string') {
      return event.result;
    }
    if (event.type === 'assistant') {
      const msg = event.message || event;
      const content = msg.content;
      if (Array.isArray(content)) {
        return content.filter(b => b.type === 'text').map(b => b.text).join('');
      }
    }
  }

  return '';
}

/**
 * Start a job: spawn a PTY running claude -p --output-format stream-json.
 */
function startJob(jobId, prompt, cwd) {
  if (activeJobs.has(jobId)) {
    throw new Error(`Job ${jobId} already running`);
  }

  const workingDir = cwd || EKUS_ROOT;
  const promptFile = `/tmp/ekus-prompt-${jobId}.txt`;
  const logFile = join(JOBS_DIR, `${jobId}.log`);

  writeFileSync(promptFile, prompt);
  if (!existsSync(logFile)) {
    writeFileSync(logFile, '');
  }

  // Build command with stream-json for incremental output
  const envFile = join(workingDir, '.env');
  const sourceEnv = existsSync(envFile) ? `source "${envFile}" && ` : '';
  const cmd = `${sourceEnv}claude -p --output-format stream-json --verbose --include-partial-messages --dangerously-skip-permissions "$(cat "${promptFile}")"`;

  console.log(`[Job ${jobId}] Starting PTY in ${workingDir}`);

  // Build clean environment
  const cleanEnv = { ...process.env };
  delete cleanEnv.CLAUDECODE;

  const ptyProcess = pty.spawn('/bin/bash', ['-c', cmd], {
    name: 'xterm-256color',
    cols: CONFIG.defaultCols,
    rows: CONFIG.defaultRows,
    cwd: workingDir,
    env: {
      ...cleanEnv,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      PATH: `/opt/homebrew/bin:${process.env.PATH}`,
    },
  });

  const jobInfo = {
    pty: ptyProcess,
    logFile,
    promptFile,
    wsClients: new Set(),
    textBuffer: '',      // Accumulated text for late-joining clients & log
    lineBuffer: '',      // Incomplete JSON line buffer for parsing
    gotStreamDeltas: false, // Track if we received incremental deltas
    startTime: Date.now(),
    exitCode: null,
    done: false,
  };

  activeJobs.set(jobId, jobInfo);

  // Handle PTY output — parse stream-json events, extract text
  ptyProcess.onData((data) => {
    jobInfo.lineBuffer += data;
    const lines = jobInfo.lineBuffer.split('\n');
    jobInfo.lineBuffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let text = '';
      try {
        const event = JSON.parse(trimmed);
        text = extractText(event, jobInfo);
      } catch {
        // Not valid JSON — could be raw output, error messages, etc.
        // Strip any ANSI codes and forward as-is
        text = trimmed
          .replace(/\x1B\[[0-9;]*[A-Za-z]/g, '')
          .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, '')
          .replace(/\x1B[@-Z\\-_]/g, '')
          .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
        if (text) text += '\n';
      }

      if (!text) continue;

      // Accumulate text
      jobInfo.textBuffer += text;
      if (jobInfo.textBuffer.length > CONFIG.maxOutputBuffer) {
        jobInfo.textBuffer = jobInfo.textBuffer.slice(-CONFIG.maxOutputBuffer);
      }

      // Write to log file
      try {
        appendFileSync(logFile, text);
      } catch (e) {
        console.error(`[Job ${jobId}] Log write error:`, e.message);
      }

      // Send to WebSocket clients
      const msg = JSON.stringify({ type: 'output', content: text });
      for (const ws of jobInfo.wsClients) {
        if (ws.readyState === 1) {
          ws.send(msg);
        }
      }
    }
  });

  // Handle PTY exit
  ptyProcess.onExit(({ exitCode, signal }) => {
    console.log(`[Job ${jobId}] PTY exited (code=${exitCode}, signal=${signal})`);

    // Process any remaining buffered line
    if (jobInfo.lineBuffer.trim()) {
      try {
        const event = JSON.parse(jobInfo.lineBuffer.trim());
        const text = extractText(event, jobInfo);
        if (text) {
          jobInfo.textBuffer += text;
          try { appendFileSync(logFile, text); } catch {}
          const msg = JSON.stringify({ type: 'output', content: text });
          for (const ws of jobInfo.wsClients) {
            if (ws.readyState === 1) ws.send(msg);
          }
        }
      } catch {}
    }

    jobInfo.exitCode = exitCode;
    jobInfo.done = true;

    // Notify all WebSocket clients
    const msg = JSON.stringify({ type: 'done', exitCode });
    for (const ws of jobInfo.wsClients) {
      if (ws.readyState === 1) {
        ws.send(msg);
      }
    }

    updateJobYaml(jobId, exitCode, jobInfo.startTime);
    try { unlinkSync(promptFile); } catch {}

    // Keep for 60s for late-joining clients
    setTimeout(() => {
      activeJobs.delete(jobId);
      console.log(`[Job ${jobId}] Cleaned up`);
    }, 60_000);
  });

  return { jobId, pid: ptyProcess.pid };
}

/**
 * Update job YAML with completion status.
 */
function updateJobYaml(jobId, exitCode, startTime) {
  const yamlFile = join(JOBS_DIR, `${jobId}.yaml`);
  if (!existsSync(yamlFile)) return;

  try {
    let content = readFileSync(yamlFile, 'utf-8');
    const duration = Math.round((Date.now() - startTime) / 1000);
    const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const status = exitCode === 0 ? 'completed' : 'failed';

    content = content.replace(/^status: .+$/m, `status: ${status}`);
    if (/^exit_code:/m.test(content)) {
      content = content.replace(/^exit_code: .+$/m, `exit_code: ${exitCode}`);
    } else {
      content += `exit_code: ${exitCode}\n`;
    }
    if (/^duration_seconds:/m.test(content)) {
      content = content.replace(/^duration_seconds: .+$/m, `duration_seconds: ${duration}`);
    } else {
      content += `duration_seconds: ${duration}\n`;
    }
    if (/^completed_at:/m.test(content)) {
      content = content.replace(/^completed_at: .+$/m, `completed_at: '${now}'`);
    } else {
      content += `completed_at: '${now}'\n`;
    }

    writeFileSync(yamlFile, content);
    console.log(`[Job ${jobId}] Updated YAML: ${status} (${duration}s)`);
  } catch (e) {
    console.error(`[Job ${jobId}] Failed to update YAML:`, e.message);
  }
}

function stopJob(jobId) {
  const jobInfo = activeJobs.get(jobId);
  if (!jobInfo || jobInfo.done) return false;
  try { jobInfo.pty.kill(); } catch {}
  return true;
}

// =============================================================================
// WebSocket Handler
// =============================================================================

function handleWebSocket(ws, req) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const jobId = url.searchParams.get('jobId');

  if (!jobId) {
    ws.close(4001, 'Missing jobId parameter');
    return;
  }

  const jobInfo = activeJobs.get(jobId);
  if (!jobInfo) {
    ws.send(JSON.stringify({ type: 'error', message: 'Job not found or already completed' }));
    ws.close(4004, 'Job not found');
    return;
  }

  console.log(`[Job ${jobId}] WebSocket client connected`);

  // Replay accumulated text for late-joining clients
  if (jobInfo.textBuffer) {
    ws.send(JSON.stringify({ type: 'output', content: jobInfo.textBuffer }));
  }

  if (jobInfo.done) {
    ws.send(JSON.stringify({ type: 'done', exitCode: jobInfo.exitCode }));
  }

  jobInfo.wsClients.add(ws);

  ws.on('close', () => {
    console.log(`[Job ${jobId}] WebSocket client disconnected`);
    jobInfo.wsClients.delete(ws);
  });

  ws.on('error', (err) => {
    console.error(`[Job ${jobId}] WebSocket error:`, err.message);
    jobInfo.wsClients.delete(ws);
  });
}

// =============================================================================
// HTTP Server
// =============================================================================

function handleHttpRequest(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      activeJobs: activeJobs.size,
      jobs: Array.from(activeJobs.entries()).map(([id, info]) => ({
        id,
        done: info.done,
        exitCode: info.exitCode,
        uptime: Math.round((Date.now() - info.startTime) / 1000),
        clients: info.wsClients.size,
      })),
    }));
    return;
  }

  if (req.url === '/api/jobs' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      jobs: Array.from(activeJobs.entries()).map(([id, info]) => ({
        id,
        done: info.done,
        exitCode: info.exitCode,
        uptime: Math.round((Date.now() - info.startTime) / 1000),
      })),
    }));
    return;
  }

  if (req.url === '/api/jobs' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const { jobId, prompt, cwd } = JSON.parse(body);
        if (!jobId || !prompt) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing jobId or prompt' }));
          return;
        }
        const result = startJob(jobId, prompt, cwd);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, ...result }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  const stopMatch = req.url?.match(/^\/api\/jobs\/([^/]+)\/stop$/);
  if (stopMatch && req.method === 'POST') {
    const stopped = stopJob(stopMatch[1]);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: stopped }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Ekus Terminal Server — connect via WebSocket with ?jobId=xxx');
}

// =============================================================================
// Main
// =============================================================================

function main() {
  const httpServer = createServer(handleHttpRequest);

  const wss = new WebSocketServer({
    server: httpServer,
    perMessageDeflate: false,
    maxPayload: 1024 * 1024,
  });

  wss.on('connection', handleWebSocket);

  function shutdown(signal) {
    console.log(`\nReceived ${signal}, shutting down...`);
    for (const [id, info] of activeJobs) {
      console.log(`Killing job ${id}`);
      try { info.pty.kill(); } catch {}
    }
    wss.close(() => {
      httpServer.close(() => {
        console.log('Terminal server shut down cleanly');
        process.exit(0);
      });
    });
    setTimeout(() => process.exit(1), 5000);
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  httpServer.listen(CONFIG.port, CONFIG.host, () => {
    console.log(`[Terminal] Server started on http://${CONFIG.host}:${CONFIG.port}`);
    console.log(`[Terminal] WebSocket: ws://${CONFIG.host}:${CONFIG.port}?jobId=xxx`);
    console.log(`[Terminal] EKUS_ROOT: ${EKUS_ROOT}`);
  });
}

main();
