#!/usr/bin/env bun
/**
 * Ekus Channel Server
 *
 * MCP channel server that bridges the Ekus dashboard chat with a persistent
 * Claude Code session. Receives messages via HTTP from the gateway, pushes
 * them to Claude via MCP notifications, and forwards Claude's replies back
 * to the gateway.
 *
 * Protocol:
 *   - stdio: MCP connection to Claude Code (spawned as subprocess)
 *   - HTTP :8788: receives messages from gateway, serves health check
 *   - POST to gateway :7600/api/channel/reply: forwards Claude's replies
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const GATEWAY_URL =
  process.env.GATEWAY_URL || "http://localhost:7600";
const PORT = parseInt(process.env.CHANNEL_PORT || "8788", 10);

// ── MCP Server ──────────────────────────────────────────────────────

const mcp = new Server(
  { name: "ekus-channel", version: "0.1.0" },
  {
    capabilities: {
      experimental: { "claude/channel": {} },
      tools: {},
    },
    instructions: `You are **Ekus** — a sharp, resourceful personal assistant for Gonçalo.

Messages arrive as <channel source="ekus-channel" chat_id="..." ...>. These come from the Ekus dashboard chat UI.

IMPORTANT RULES:
- Reply to EVERY message using the "reply" tool. Pass back the chat_id from the channel tag.
- Be concise but thorough. Use markdown formatting.
- You have full access to the filesystem, shell, MCP tools, and everything in this Claude Code session.
- Follow the instructions in CLAUDE.md.
- If a message includes file paths, read them before responding.
- For multi-step tasks, give progress updates by calling reply multiple times if needed.`,
  }
);

// ── Reply Tool ──────────────────────────────────────────────────────

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "reply",
      description:
        "Send a reply back to the Ekus dashboard chat. Always pass the chat_id from the inbound <channel> tag.",
      inputSchema: {
        type: "object" as const,
        properties: {
          chat_id: {
            type: "string",
            description: "The chat_id from the inbound channel message",
          },
          text: {
            type: "string",
            description: "The reply text (supports markdown)",
          },
          files: {
            type: "array",
            items: { type: "string" },
            description:
              "Optional array of absolute file paths to attach to the reply",
          },
        },
        required: ["chat_id", "text"],
      },
    },
  ],
}));

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name === "reply") {
    const { chat_id, text, files } = req.params.arguments as {
      chat_id: string;
      text: string;
      files?: string[];
    };

    // Forward reply to gateway
    try {
      const resp = await fetch(`${GATEWAY_URL}/api/channel/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id, text, files: files || [] }),
      });

      if (!resp.ok) {
        const err = await resp.text();
        console.error(`[ekus-channel] Gateway reply failed: ${err}`);
        return {
          content: [{ type: "text" as const, text: `Reply delivery failed: ${err}` }],
        };
      }
    } catch (e: any) {
      console.error(`[ekus-channel] Gateway unreachable: ${e.message}`);
      return {
        content: [
          {
            type: "text" as const,
            text: `Reply delivery failed (gateway unreachable): ${e.message}`,
          },
        ],
      };
    }

    return { content: [{ type: "text" as const, text: "sent" }] };
  }

  throw new Error(`Unknown tool: ${req.params.name}`);
});

// ── Connect to Claude Code ──────────────────────────────────────────

await mcp.connect(new StdioServerTransport());
console.error(`[ekus-channel] MCP connected, starting HTTP server on :${PORT}`);

// ── HTTP Server ─────────────────────────────────────────────────────

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    // Health check
    if (url.pathname === "/health" && req.method === "GET") {
      return new Response(
        JSON.stringify({ status: "ok", server: "ekus-channel" }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // Receive message from gateway
    if (url.pathname === "/message" && req.method === "POST") {
      try {
        const body = (await req.json()) as {
          chat_id: string;
          message: string;
          session_id?: string;
          files?: string[];
        };

        if (!body.message) {
          return new Response(
            JSON.stringify({ error: "No message provided" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }

        // Build meta for channel tag attributes
        const meta: Record<string, string> = {
          chat_id: body.chat_id,
        };
        if (body.session_id) {
          meta.session_id = body.session_id;
        }

        // Build content (message + file references)
        let content = body.message;
        if (body.files && body.files.length > 0) {
          content += "\n\nAttached files:\n" + body.files.map((f) => `- ${f}`).join("\n");
        }

        // Push notification to Claude
        await mcp.notification({
          method: "notifications/claude/channel",
          params: { content, meta },
        });

        console.error(
          `[ekus-channel] Message pushed: chat_id=${body.chat_id}, ${content.length} chars`
        );

        return new Response(
          JSON.stringify({ ok: true, chat_id: body.chat_id }),
          { headers: { "Content-Type": "application/json" } }
        );
      } catch (e: any) {
        console.error(`[ekus-channel] Error processing message: ${e.message}`);
        return new Response(
          JSON.stringify({ error: e.message }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    return new Response("Ekus Channel Server", { status: 200 });
  },
});

console.error(`[ekus-channel] HTTP server listening on http://127.0.0.1:${PORT}`);
