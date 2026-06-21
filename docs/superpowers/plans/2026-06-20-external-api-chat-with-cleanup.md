# External API Chat with Temp Workspace Cleanup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add external Sync/Async chat API endpoints with webhook callback and auto-cleanup of temporary workspaces.

**Architecture:** Three new REST endpoints in the existing API workspace router (`server/endpoints/api/workspace/index.js`), one new async handler function in `apiChatHandler.js`, a webhook sender utility, and a Bree cleanup job.

**Tech Stack:** Express.js, Prisma (SQLite/Postgres), Bree job scheduler, `prom-client` metrics

**Existing patterns:** Follow `POST /v1/workspace/chat-auto` and `ApiChatHandler.chatSync` patterns for the sync endpoint. Follow `workspace_chats` model pattern for async status tracking.

## Global Constraints

- All new endpoints use `[validApiKey]` auth middleware (same as existing `/v1/` routes)
- Workspace auto-creation uses existing `Workspace.new()` with `isTemp: true`
- `chat-sync` reuses `ApiChatHandler.chatSync()` logic
- Cleanup job runs every 12 hours, deletes workspaces older than 24 hours
- Webhook delivery uses `axios` or native `http` module with 5s timeout

---

### Task 1: Chat Sync Endpoint

**Files:**
- Modify: `server/endpoints/api/workspace/index.js`
- Reference: existing `POST /v1/workspace/chat-auto` at `server/endpoints/api/workspace/index.js:110`

**Interfaces:**
- Consumes: `validApiKey` middleware, `ApiChatHandler.chatSync()`, `Workspace.new()` with `isTemp`
- Produces: `POST /v1/workspace/chat-sync` route handler

- [ ] **Step 1: Read existing `chat-auto` route to understand the pattern**

Read `server/endpoints/api/workspace/index.js` around the `chat-auto` route (line 110+) and the existing `/v1/workspace/:slug/chat` route to understand workspace creation + chat dispatch pattern.

- [ ] **Step 2: Add `chat-sync` route**

After the existing `chat-auto` route block, add:

```js
// Sync Chat — auto-create temp workspace, respond immediately
app.post(
  "/v1/workspace/chat-sync",
  [validApiKey],
  async (request, response) => {
    try {
      const { workspaceName, message, mode, sessionId, attachments, reset } = request.body;
      if (!workspaceName?.trim()) return response.status(400).json({ error: "workspaceName is required" });
      if (!message?.trim()) return response.status(400).json({ error: "message is required" });

      const workspace = await findOrCreateWorkspace(workspaceName, sessionId, reset, request);
      const result = await ApiChatHandler.chatSync({
        workspace,
        message,
        mode: mode || "chat",
        attachments: attachments || [],
        user: null,
        sessionId,
        apiSessionId: request.auth?.id || null,
      });

      return response.status(200).json({
        success: true,
        response: result.textResponse,
        workspaceName: workspace.slug,
        sources: result.sources || [],
        chatId: result.chatId || null,
      });
    } catch (e) {
      console.error("chat-sync error:", e.message);
      return response.status(500).json({ success: false, error: e.message });
    }
  }
);
```

- [ ] **Step 3: Extract `findOrCreateWorkspace` helper**

Add a helper function at the top of the route file (or in a shared place):

```js
async function findOrCreateWorkspace(workspaceName, sessionId, reset, request) {
  if (sessionId) {
    const existing = await prisma.workspaces.findFirst({
      where: { slug: `temp-${sessionId}` },
    });
    if (existing) {
      if (reset) {
        await WorkspaceThreads.delete({ workspaceId: existing.id });
      }
      return existing;
    }
  }
  const newWs = await Workspace.new(workspaceName, 1, { isTemp: true });
  return newWs;
}
```

- [ ] **Step 4: Wire up the route in the function**

Ensure the `chat-sync` route is inside the `workspaceEndpoints` function alongside existing routes, and add `findOrCreateWorkspace` as a module-level function.

- [ ] **Step 5: Commit**

```bash
git add server/endpoints/api/workspace/index.js
git commit -m "feat: add POST /v1/workspace/chat-sync endpoint"
```

---

### Task 2: Async Chat Endpoint + Webhook

**Files:**
- Modify: `server/endpoints/api/workspace/index.js`
- Modify: `server/utils/chats/apiChatHandler.js`

**Interfaces:**
- Consumes: `validApiKey`, `WorkspaceChats` model, `findOrCreateWorkspace`
- Produces: `POST /v1/workspace/chat-async`, `chatAsync()` function, webhook delivery

- [ ] **Step 1: Add webhook delivery utility**

In `server/utils/http.js`, add:

```js
async function sendWebhook(url, payload) {
  if (!url) return;
  const https = url.startsWith("https") ? require("https") : require("http");
  return new Promise((resolve) => {
    const data = JSON.stringify(payload);
    const parsed = new URL(url);
    const opts = {
      hostname: parsed.hostname,
      port: parsed.port || (url.startsWith("https") ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
      timeout: 5000,
    };
    const req = https.request(opts, (res) => { resolve(true); });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
    req.write(data);
    req.end();
  });
}
```

Export it from the module.

- [ ] **Step 2: Add `chatAsync` function to `apiChatHandler.js`**

```js
async function chatAsync({ workspace, message, mode, attachments, sessionId, apiSessionId, webhookUrl }) {
  const { WorkspaceChats } = require("../../models/workspaceChats");
  const chat = await WorkspaceChats.newChat({
    workspaceId: workspace.id,
    prompt: message,
    status: "pending",
    sessionId,
    apiSessionId,
  });

  process.nextTick(async () => {
    try {
      const result = await chatSync({ workspace, message, mode, attachments: attachments || [], user: null, sessionId, apiSessionId });
      await WorkspaceChats.markComplete(chat.id, result.textResponse);
      await sendWebhook(webhookUrl, {
        chatId: chat.id,
        status: "completed",
        response: result.textResponse,
        workspaceName: workspace.slug,
        sources: result.sources || [],
      });
    } catch (e) {
      await WorkspaceChats.markError(chat.id, e.message);
      await sendWebhook(webhookUrl, {
        chatId: chat.id,
        status: "error",
        error: e.message,
        workspaceName: workspace.slug,
      });
    }
  });

  return { chatId: chat.id, status: "pending" };
}
```

- [ ] **Step 3: Add chat-async route**

In `server/endpoints/api/workspace/index.js`:

```js
app.post(
  "/v1/workspace/chat-async",
  [validApiKey],
  async (request, response) => {
    try {
      const { workspaceName, message, mode, sessionId, attachments, reset, webhookUrl } = request.body;
      if (!workspaceName?.trim()) return response.status(400).json({ error: "workspaceName is required" });
      if (!message?.trim()) return response.status(400).json({ error: "message is required" });

      const workspace = await findOrCreateWorkspace(workspaceName, sessionId, reset, request);
      const result = await ApiChatHandler.chatAsync({
        workspace,
        message,
        mode: mode || "chat",
        attachments: attachments || [],
        sessionId,
        apiSessionId: request.auth?.id || null,
        webhookUrl,
      });

      return response.status(202).json({ success: true, ...result });
    } catch (e) {
      console.error("chat-async error:", e.message);
      return response.status(500).json({ success: false, error: e.message });
    }
  }
);
```

- [ ] **Step 4: Add status polling route**

```js
app.get(
  "/v1/workspace/chat-async/status/:chatId",
  [validApiKey],
  async (request, response) => {
    try {
      const chat = await WorkspaceChats.get({ id: Number(request.params.chatId) });
      if (!chat) return response.status(404).json({ error: "Chat not found" });
      return response.status(200).json({
        chatId: chat.id,
        status: chat.status,
        response: chat.status === "completed" ? chat.response : undefined,
      });
    } catch (e) {
      return response.status(500).json({ error: e.message });
    }
  }
);
```

- [ ] **Step 5: Commit**

```bash
git add server/utils/http.js server/endpoints/api/workspace/index.js server/utils/chats/apiChatHandler.js
git commit -m "feat: add POST /v1/workspace/chat-async with webhook + status polling"
```

---

### Task 3: WorkspaceChats Model — status support

**Files:**
- Read: `server/models/workspaceChats.js`
- Modify: `server/models/workspaceChats.js`

- [ ] **Step 1: Read existing model**

Read `server/models/workspaceChats.js` to find existing `newChat` method and any status field.

- [ ] **Step 2: Add status, response, apiSessionId columns support**

If the schema doesn't already have `status`, `response`, or `apiSessionId` fields, add them:

```js
// In workspaceChats model
static async newChat({ workspaceId, prompt, status = "processed", sessionId = null, apiSessionId = null }) {
  const { prisma } = require("../utils/prisma");
  return prisma.workspace_chats.create({
    data: { workspaceId, prompt, status, sessionId, apiSessionId },
  });
}

static async markComplete(chatId, response) {
  const { prisma } = require("../utils/prisma");
  return prisma.workspace_chats.update({
    where: { id: chatId },
    data: { response, status: "completed" },
  });
}

static async markError(chatId, error) {
  const { prisma } = require("../utils/prisma");
  return prisma.workspace_chats.update({
    where: { id: chatId },
    data: { response: error, status: "error" },
  });
}
```

- [ ] **Step 3: Check Prisma schema for required columns**

Read `server/prisma/schema.prisma` to verify `workspace_chats` has `status`, `response`, `sessionId`, `apiSessionId` columns. If missing, note that a migration is needed.

- [ ] **Step 4: Commit**

```bash
git add server/models/workspaceChats.js
git commit -m "feat: add status/response support to WorkspaceChats model"
```

---

### Task 4: Cleanup Temp Workspaces Job

**Files:**
- Create: `server/jobs/cleanup-temporary-workspaces.js`
- Modify: `server/utils/BackgroundWorkers/index.js`

- [ ] **Step 1: Create cleanup job**

```js
const prisma = require("../utils/prisma").prisma;
const { log, conclude } = require("../jobs/helpers/index.js");

(async () => {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const oldTempWorkspaces = await prisma.workspaces.findMany({
      where: {
        slug: { startsWith: "temp-" },
        createdAt: { lt: cutoff },
      },
    });

    log(`Found ${oldTempWorkspaces.length} expired temp workspaces to clean`);

    for (const ws of oldTempWorkspaces) {
      try {
        // Delete related data
        await prisma.workspace_chats.deleteMany({ where: { workspaceId: ws.id } });
        await prisma.workspace_documents.deleteMany({ where: { workspaceId: ws.id } });
        await prisma.workspace_threads.deleteMany({ where: { workspaceId: ws.id } });

        // Delete the workspace itself
        await prisma.workspaces.delete({ where: { id: ws.id } });

        log(`Cleaned workspace: ${ws.slug} (id=${ws.id})`);
      } catch (e) {
        log(`Failed to clean workspace ${ws.slug}: ${e.message}`);
      }
    }

    log(`Cleanup complete: removed ${oldTempWorkspaces.length} workspaces`);
  } catch (e) {
    console.error("cleanup-temporary-workspaces error:", e.message);
  } finally {
    conclude();
  }
})();
```

- [ ] **Step 2: Register in BackgroundWorkers**

In `server/utils/BackgroundWorkers/index.js`, add to `#alwaysRunJobs`:

```js
{
  name: "cleanup-temporary-workspaces",
  timeout: "5m",
  interval: "12hr",
},
```

- [ ] **Step 3: Commit**

```bash
git add server/jobs/cleanup-temporary-workspaces.js server/utils/BackgroundWorkers/index.js
git commit -m "feat: add cleanup-temporary-workspaces Bree job (12hr cycle)"
```

---

### Task 5: Verify & Test

- [ ] **Step 1: Start server and test chat-sync**

```bash
curl -s -X POST http://localhost:3001/api/v1/workspace/chat-sync \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <api-key>" \
  -d '{"workspaceName":"test-ws","message":"Hello"}'
```

Expected: 200 with `{ success: true, response: "...", workspaceName: "temp-test-ws" }`

- [ ] **Step 2: Test chat-async with webhook**

```bash
curl -s -X POST http://localhost:3001/api/v1/workspace/chat-async \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <api-key>" \
  -d '{"workspaceName":"test-async","message":"Hello async","webhookUrl":"https://webhook.site/test"}'
```

Expected: 202 with `{ success: true, chatId: N, status: "pending" }`

- [ ] **Step 3: Test status polling**

```bash
curl -s http://localhost:3001/api/v1/workspace/chat-async/status/<chatId>
```

Expected: `{ chatId: N, status: "pending" }` (then `"completed"` after processing)

- [ ] **Step 4: Verify cleanup job runs**

Check server logs for "Found X expired temp workspaces to clean" message.

- [ ] **Step 5: Commit final**

```bash
git add -A && git commit -m "chore: add tests and verify"
```
