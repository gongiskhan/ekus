import html from "./dashboard.html";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, PUT, DELETE, OPTIONS",
          "access-control-allow-headers": "Content-Type",
        },
      });
    }

    const corsHeaders = {
      "access-control-allow-origin": "*",
    };

    // Tasks API
    if (url.pathname === "/api/tasks" && request.method === "GET") {
      const tasks = await env.TASKS_KV.get("TASKS.md");
      return new Response(tasks || "", {
        headers: { "content-type": "text/plain;charset=UTF-8", ...corsHeaders },
      });
    }

    if (url.pathname === "/api/tasks" && request.method === "PUT") {
      const body = await request.text();
      await env.TASKS_KV.put("TASKS.md", body);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json", ...corsHeaders },
      });
    }

    // Memory API — list all memory keys
    if (url.pathname === "/api/memory" && request.method === "GET") {
      const list = await env.TASKS_KV.list({ prefix: "memory:" });
      const files = {};
      for (const key of list.keys) {
        const name = key.name.replace("memory:", "");
        const value = await env.TASKS_KV.get(key.name);
        files[name] = value || "";
      }
      return new Response(JSON.stringify(files), {
        headers: { "content-type": "application/json;charset=UTF-8", ...corsHeaders },
      });
    }

    // Memory API — get single file
    if (url.pathname.startsWith("/api/memory/") && request.method === "GET") {
      const name = decodeURIComponent(url.pathname.replace("/api/memory/", ""));
      const value = await env.TASKS_KV.get("memory:" + name);
      if (value === null) {
        return new Response("Not found", { status: 404, headers: corsHeaders });
      }
      return new Response(value, {
        headers: { "content-type": "text/plain;charset=UTF-8", ...corsHeaders },
      });
    }

    // Memory API — put single file
    if (url.pathname.startsWith("/api/memory/") && request.method === "PUT") {
      const name = decodeURIComponent(url.pathname.replace("/api/memory/", ""));
      const body = await request.text();
      await env.TASKS_KV.put("memory:" + name, body);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json", ...corsHeaders },
      });
    }

    // Memory API — delete single file
    if (url.pathname.startsWith("/api/memory/") && request.method === "DELETE") {
      const name = decodeURIComponent(url.pathname.replace("/api/memory/", ""));
      await env.TASKS_KV.delete("memory:" + name);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json", ...corsHeaders },
      });
    }

    // Dashboard HTML
    return new Response(html, {
      headers: { "content-type": "text/html;charset=UTF-8" },
    });
  },
};
