# System-Default Grounding Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make query-mode, low-temperature, evidence-gated RAG the one-time migrated and new-workspace default across every ordinary chat surface while preserving later administrator overrides.

**Architecture:** Add a small provider-agnostic grounding module that owns strict-query prompt rules, current-turn context selection, and the refusal decision. All chat handlers will evaluate current vector results plus trusted direct context before any history backfill or LLM call. Prisma defaults and a SQLite migration establish the safe settings, while the existing workspace update path remains writable.

**Tech Stack:** Node.js CommonJS, Jest 29, Prisma/SQLite, React settings UI

---

## File Map

- Create `server/utils/chats/grounding.js`: pure grounding policy functions and prompt suffix.
- Create `server/__tests__/utils/chats/grounding.test.js`: unit coverage for strict and opt-out behavior.
- Create `server/__tests__/prisma/defaultGroundingPolicy.test.js`: schema and real-SQLite migration coverage.
- Create `server/__tests__/utils/telegramBot/grounding.test.js`: Telegram no-context refusal regression.
- Create `server/prisma/migrations/20260620150000_default_grounding_policy/migration.sql`: overwrite existing workspace values and update SQLite column defaults.
- Modify `server/prisma/schema.prisma`: safe Prisma defaults.
- Modify `server/models/workspace.js`: safe validation and creation defaults.
- Modify `server/models/systemSettings.js`: grounded base prompt.
- Modify `server/utils/chats/index.js`: append strict rules in effective query mode.
- Modify `server/utils/chats/apiChatHandler.js`, `stream.js`, `openaiCompatible.js`, and `embed.js`: current-turn evidence gate and no query-mode history backfill.
- Modify `server/utils/telegramBot/chat/stream.js`: enforce the same gate before generation.
- Modify explicit creation/default callers in `server/endpoints/api/workspace/index.js`, `server/endpoints/telegram.js`, `server/utils/telegramBot/utils/navigation/callbacks/handleWorkspaceCreate.js`, `frontend/src/pages/WorkspaceSettings/ChatSettings/ChatModeSelection/index.jsx`, and `frontend/src/pages/Admin/DeveloperApi/index.jsx`.

### Task 1: Safe workspace defaults and one-time migration

**Files:**
- Create: `server/__tests__/prisma/defaultGroundingPolicy.test.js`
- Create: `server/prisma/migrations/20260620150000_default_grounding_policy/migration.sql`
- Modify: `server/prisma/schema.prisma:127-136`
- Modify: `server/models/workspace.js:66-101,214-229`

- [ ] **Step 1: Write the failing schema/migration test**

Create a temporary SQLite database with the current workspace columns, insert a permissive workspace, apply the migration statements, and assert both the migrated row and defaults for a newly inserted row:

```js
const fs = require("fs");
const os = require("os");
const path = require("path");
const { PrismaClient } = require("@prisma/client");

const schemaPath = path.resolve(__dirname, "../../prisma/schema.prisma");
const migrationPath = path.resolve(
  __dirname,
  "../../prisma/migrations/20260620150000_default_grounding_policy/migration.sql"
);

describe("default grounding workspace policy", () => {
  let directory;
  let prisma;

  beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "grounding-policy-"));
    prisma = new PrismaClient({
      datasources: { db: { url: `file:${path.join(directory, "test.db")}` } },
    });
    await prisma.$executeRawUnsafe(`CREATE TABLE "workspaces" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "name" TEXT NOT NULL,
      "slug" TEXT NOT NULL,
      "vectorTag" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "openAiTemp" REAL,
      "openAiHistory" INTEGER NOT NULL DEFAULT 20,
      "lastUpdatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "openAiPrompt" TEXT,
      "similarityThreshold" REAL DEFAULT 0.25,
      "chatProvider" TEXT,
      "chatModel" TEXT,
      "topN" INTEGER DEFAULT 4,
      "chatMode" TEXT DEFAULT 'chat',
      "pfpFilename" TEXT,
      "agentProvider" TEXT,
      "agentModel" TEXT,
      "queryRefusalResponse" TEXT,
      "vectorSearchMode" TEXT DEFAULT 'default',
      "router_id" INTEGER
    )`);
    await prisma.$executeRawUnsafe(
      `INSERT INTO "workspaces" ("name", "slug", "openAiTemp", "similarityThreshold", "chatMode") VALUES ('Old', 'old', 0.9, 0.1, 'automatic')`
    );
  });

  afterEach(async () => {
    await prisma.$disconnect();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  test("overwrites existing values and installs safe database defaults", async () => {
    const statements = fs.readFileSync(migrationPath, "utf8")
      .split(";")
      .map((sql) => sql.replace(/^--.*$/gm, "").trim())
      .filter(Boolean)
      .filter((sql) => !/^PRAGMA /i.test(sql));
    for (const statement of statements)
      await prisma.$executeRawUnsafe(statement);

    const migrated = await prisma.$queryRawUnsafe(
      `SELECT "chatMode", "openAiTemp", "similarityThreshold" FROM "workspaces" WHERE "slug" = 'old'`
    );
    expect(migrated[0]).toMatchObject({
      chatMode: "query",
      openAiTemp: 0.1,
      similarityThreshold: 0.5,
    });

    await prisma.$executeRawUnsafe(
      `INSERT INTO "workspaces" ("name", "slug") VALUES ('New', 'new')`
    );
    const created = await prisma.$queryRawUnsafe(
      `SELECT "chatMode", "openAiTemp", "similarityThreshold" FROM "workspaces" WHERE "slug" = 'new'`
    );
    expect(created[0]).toMatchObject({
      chatMode: "query",
      openAiTemp: 0.1,
      similarityThreshold: 0.5,
    });
  });

  test("Prisma schema declares the same safe defaults", () => {
    const schema = fs.readFileSync(schemaPath, "utf8");
    expect(schema).toMatch(/openAiTemp\s+Float\?\s+@default\(0\.1\)/);
    expect(schema).toMatch(/similarityThreshold\s+Float\?\s+@default\(0\.5\)/);
    expect(schema).toMatch(/chatMode\s+String\?\s+@default\("query"\)/);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
PATH=/Users/songmyeongjin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH ./node_modules/.bin/jest server/__tests__/prisma/defaultGroundingPolicy.test.js --runInBand
```

Expected: FAIL because the migration file is absent and schema defaults are still permissive.

- [ ] **Step 3: Implement the migration and model defaults**

Change the Prisma fields to:

```prisma
openAiTemp          Float?  @default(0.1)
similarityThreshold Float?  @default(0.5)
chatMode            String? @default("query")
```

Change `Workspace.validations` fallbacks to `0.1`, `0.5`, and `"query"`, and change `Workspace.new` to start with:

```js
data: {
  name: this.validations.name(name),
  chatMode: "query",
  openAiTemp: 0.1,
  similarityThreshold: 0.5,
  ...this.validateFields(additionalFields),
  slug,
},
```

Use this migration so SQLite receives the same defaults as Prisma and all existing values are overwritten once:

```sql
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_workspaces" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "vectorTag" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "openAiTemp" REAL DEFAULT 0.1,
  "openAiHistory" INTEGER NOT NULL DEFAULT 20,
  "lastUpdatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "openAiPrompt" TEXT,
  "similarityThreshold" REAL DEFAULT 0.5,
  "chatProvider" TEXT,
  "chatModel" TEXT,
  "topN" INTEGER DEFAULT 4,
  "chatMode" TEXT DEFAULT 'query',
  "pfpFilename" TEXT,
  "agentProvider" TEXT,
  "agentModel" TEXT,
  "queryRefusalResponse" TEXT,
  "vectorSearchMode" TEXT DEFAULT 'default',
  "router_id" INTEGER
);
INSERT INTO "new_workspaces" (
  "id", "name", "slug", "vectorTag", "createdAt", "openAiTemp",
  "openAiHistory", "lastUpdatedAt", "openAiPrompt", "similarityThreshold",
  "chatProvider", "chatModel", "topN", "chatMode", "pfpFilename",
  "agentProvider", "agentModel", "queryRefusalResponse",
  "vectorSearchMode", "router_id"
)
SELECT
  "id", "name", "slug", "vectorTag", "createdAt", 0.1,
  "openAiHistory", "lastUpdatedAt", "openAiPrompt", 0.5,
  "chatProvider", "chatModel", "topN", 'query', "pfpFilename",
  "agentProvider", "agentModel", "queryRefusalResponse",
  "vectorSearchMode", "router_id"
FROM "workspaces";
DROP TABLE "workspaces";
ALTER TABLE "new_workspaces" RENAME TO "workspaces";
CREATE UNIQUE INDEX "workspaces_slug_key" ON "workspaces"("slug");
UPDATE "workspaces"
SET "chatMode" = 'query',
    "openAiTemp" = 0.1,
    "similarityThreshold" = 0.5;
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the Step 2 command. Expected: 2 tests pass.

- [ ] **Step 5: Generate Prisma client and commit**

```bash
PATH=/Users/songmyeongjin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH ./server/node_modules/.bin/prisma generate --schema server/prisma/schema.prisma
git add server/prisma/schema.prisma server/prisma/migrations/20260620150000_default_grounding_policy/migration.sql server/models/workspace.js server/__tests__/prisma/defaultGroundingPolicy.test.js
git commit -m "feat: migrate workspaces to grounded defaults"
```

### Task 2: Pure grounding policy and strict prompt

**Files:**
- Create: `server/__tests__/utils/chats/grounding.test.js`
- Create: `server/utils/chats/grounding.js`
- Modify: `server/models/systemSettings.js:39-43`
- Modify: `server/utils/chats/index.js:84-108`

- [ ] **Step 1: Write failing policy tests**

```js
const {
  buildGroundingContext,
  appendGroundingInstructions,
} = require("../../../utils/chats/grounding");

describe("grounding policy", () => {
  test("query mode refuses without current-turn or direct context", () => {
    expect(buildGroundingContext({
      chatMode: "query",
      directContextTexts: [],
      searchContextTexts: [],
      backfilledContextTexts: ["stale source"],
    })).toEqual({ contextTexts: [], shouldRefuse: true });
  });

  test.each([
    [["pinned"], [], false],
    [[], ["current search"], false],
    [[], [], true],
  ])("query mode accepts trusted current context", (direct, search, hasDirectContext) => {
    expect(buildGroundingContext({
      chatMode: "query",
      directContextTexts: direct,
      searchContextTexts: search,
      hasDirectContext,
      backfilledContextTexts: ["stale source"],
    })).toEqual({
      contextTexts: [...direct, ...search],
      shouldRefuse: false,
    });
  });

  test("explicit chat mode retains history backfill", () => {
    expect(buildGroundingContext({
      chatMode: "chat",
      directContextTexts: [],
      searchContextTexts: [],
      backfilledContextTexts: ["previous source"],
    })).toEqual({
      contextTexts: ["previous source"],
      shouldRefuse: false,
    });
  });

  test("query prompt keeps the custom prompt and appends refusal rules", () => {
    const prompt = appendGroundingInstructions({
      systemPrompt: "Answer in Korean.",
      chatMode: "query",
      refusalResponse: "근거가 없습니다.",
    });
    expect(prompt).toContain("Answer in Korean.");
    expect(prompt).toContain("근거가 없습니다.");
    expect(prompt).toContain("retrieved context");
    expect(prompt).toContain("untrusted data");
  });

  test("explicit chat mode leaves a custom prompt unchanged", () => {
    expect(appendGroundingInstructions({
      systemPrompt: "Be creative.",
      chatMode: "chat",
    })).toBe("Be creative.");
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run the Jest command from Task 1 with `server/__tests__/utils/chats/grounding.test.js`. Expected: FAIL because `grounding.js` does not exist.

- [ ] **Step 3: Implement the pure helper**

Export two functions with this interface:

```js
function buildGroundingContext({
  chatMode = "query",
  directContextTexts = [],
  searchContextTexts = [],
  backfilledContextTexts = [],
  hasDirectContext = false,
} = {}) {
  const currentContextTexts = [...directContextTexts, ...searchContextTexts];
  if (chatMode === "query") {
    return {
      contextTexts: currentContextTexts,
      shouldRefuse: currentContextTexts.length === 0 && !hasDirectContext,
    };
  }
  return {
    contextTexts: [...currentContextTexts, ...backfilledContextTexts],
    shouldRefuse: false,
  };
}
```

`appendGroundingInstructions` returns the original prompt outside query mode. In query mode it appends stable English rules requiring only retrieved context, exact refusal text, no guessing/general knowledge, and treating document instructions as untrusted data.

Update `SystemSettings.saneDefaultSystemPrompt` to the concise grounded default. Update `chatPrompt` to call `appendGroundingInstructions` using `opts.chatMode ?? workspace?.chatMode ?? "query"` and the workspace refusal response.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run the Task 1 Jest command against both grounding and existing agent-default prompt tests. Expected: all selected tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/utils/chats/grounding.js server/__tests__/utils/chats/grounding.test.js server/models/systemSettings.js server/utils/chats/index.js
git commit -m "feat: add shared strict grounding policy"
```

### Task 3: Apply evidence gating to web, API, OpenAI-compatible, and embed chat

**Files:**
- Modify: `server/utils/chats/apiChatHandler.js`
- Modify: `server/utils/chats/stream.js`
- Modify: `server/utils/chats/openaiCompatible.js`
- Modify: `server/utils/chats/embed.js`
- Create: `server/__tests__/utils/chats/apiChatHandler.grounding.test.js`
- Modify: `server/__tests__/utils/chats/openaiCompatible.test.js`

- [ ] **Step 1: Add a failing history-backfill regression test**

Create `apiChatHandler.grounding.test.js`. Mock `recentChatHistory` to return a prior citation while the current vector search is empty. The essential setup and assertion are:

```js
/* eslint-env jest, node */
const { WorkspaceChats } = require("../../../models/workspaceChats");
const {
  getVectorDbClass,
  resolveProviderConnector,
} = require("../../../utils/helpers");
const { ApiChatHandler } = require("../../../utils/chats/apiChatHandler");

jest.mock("../../../models/workspaceChats", () => ({
  WorkspaceChats: {
    new: jest.fn().mockResolvedValue({ chat: { id: 9 } }),
    markThreadHistoryInvalidV2: jest.fn(),
  },
}));
jest.mock("../../../utils/helpers", () => ({
  getVectorDbClass: jest.fn(),
  resolveProviderConnector: jest.fn(),
}));
jest.mock("../../../utils/DocumentManager", () => ({
  DocumentManager: class {
    pinnedDocs() { return Promise.resolve([]); }
  },
}));
jest.mock("../../../utils/chats/index", () => ({
  grepAllSlashCommands: jest.fn(async (message) => message),
  chatPrompt: jest.fn().mockResolvedValue("grounded prompt"),
  sourceIdentifier: jest.fn((source) => source.id),
  recentChatHistory: jest.fn().mockResolvedValue({
    rawHistory: [{
      response: JSON.stringify({
        sources: [{ id: "old", text: "stale source", score: 0.9 }],
      }),
    }],
    chatHistory: [],
  }),
}));
jest.mock("../../../utils/agents/ephemeral", () => ({
  EphemeralAgentHandler: { isAgentInvocation: jest.fn().mockResolvedValue(false) },
  EphemeralEventListener: jest.fn(),
}));
jest.mock("../../../models/telemetry", () => ({
  Telemetry: { sendTelemetry: jest.fn() },
}));

test("query mode refuses when only a previous-turn source exists", async () => {
  const completion = jest.fn().mockResolvedValue({
    textResponse: "hallucinated",
    metrics: {},
  });
  resolveProviderConnector.mockResolvedValue({
    connector: {
      promptWindowLimit: jest.fn().mockReturnValue(4096),
      compressMessages: jest.fn().mockResolvedValue([]),
      getChatCompletion: completion,
      defaultTemp: 0.7,
    },
  });
  getVectorDbClass.mockReturnValue({
    hasNamespace: jest.fn().mockResolvedValue(true),
    namespaceCount: jest.fn().mockResolvedValue(1),
    performSimilaritySearch: jest.fn().mockResolvedValue({
      contextTexts: [], sources: [], message: null,
    }),
  });

  const result = await ApiChatHandler.chatSync({
    workspace: {
      id: 1,
      slug: "grounded",
      chatMode: "query",
      queryRefusalResponse: "근거가 없습니다.",
    },
    message: "unrelated question",
  });

  expect(result.textResponse).toBe("근거가 없습니다.");
  expect(result.sources).toEqual([]);
  expect(completion).not.toHaveBeenCalled();
  expect(WorkspaceChats.new).toHaveBeenCalledWith(
    expect.objectContaining({ include: false })
  );
});
```

Also extend `openaiCompatible.test.js` with a query-mode current-source case that asserts generation still occurs.

- [ ] **Step 2: Run the handler test and verify RED**

Run:

```bash
PATH=/Users/songmyeongjin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH ./node_modules/.bin/jest server/__tests__/utils/chats/apiChatHandler.grounding.test.js --runInBand
```

Expected: FAIL because the previous citation is backfilled and the completion mock is called.

- [ ] **Step 3: Integrate the helper consistently**

In every handler, preserve three separate arrays until the decision is made:

```js
const directContextTexts = [...pinnedOrAttachmentContextTexts];
const searchContextTexts = vectorSearchResults.contextTexts;
const backfilledContextTexts = filledSources.contextTexts.filter(
  (text) => !searchContextTexts.includes(text)
);
const grounding = buildGroundingContext({
  chatMode,
  directContextTexts,
  searchContextTexts,
  backfilledContextTexts,
  hasDirectContext: attachments.length > 0,
});
contextTexts = grounding.contextTexts;
```

Return the existing path-specific refusal response when `grounding.shouldRefuse` is true. Pass `{ prompt, rawHistory, chatMode }` to `chatPrompt`. Query mode must never feed `backfilledContextTexts` into the model. Chat and automatic modes keep current backfill behavior. For OpenAI-compatible calls with a caller-supplied system prompt, pass that prompt through `appendGroundingInstructions` so the override cannot remove query-mode grounding rules.

For `apiChatHandler.chatAsync`, remove `mode || "chat"`; pass `mode` through so `chatSync` resolves the workspace default. Change handler fallbacks from `"automatic"` to `"query"` only where no workspace mode exists.

- [ ] **Step 4: Run focused and related chat tests**

```bash
PATH=/Users/songmyeongjin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH ./node_modules/.bin/jest server/__tests__/utils/chats server/__tests__/utils/helpers/convertTo.test.js --runInBand
```

Expected: all selected suites pass.

- [ ] **Step 5: Commit**

```bash
git add server/utils/chats/apiChatHandler.js server/utils/chats/stream.js server/utils/chats/openaiCompatible.js server/utils/chats/embed.js server/__tests__/utils/chats/apiChatHandler.grounding.test.js server/__tests__/utils/chats/openaiCompatible.test.js
git commit -m "feat: enforce current-turn evidence across chat APIs"
```

### Task 4: Enforce query refusal in Telegram

**Files:**
- Create: `server/__tests__/utils/telegramBot/grounding.test.js`
- Modify: `server/utils/telegramBot/chat/stream.js:42-151`

- [ ] **Step 1: Write the failing Telegram regression test**

Create the test with empty pinned documents and an empty successful vector search:

```js
/* eslint-env jest, node */
jest.mock("../../../models/workspaceChats", () => ({
  WorkspaceChats: { new: jest.fn().mockResolvedValue({}) },
}));
jest.mock("../../../utils/helpers", () => ({
  getVectorDbClass: jest.fn(),
  resolveProviderConnector: jest.fn(),
}));
jest.mock("../../../utils/DocumentManager", () => ({
  DocumentManager: class {
    pinnedDocs() { return Promise.resolve([]); }
  },
}));
jest.mock("../../../utils/agents", () => ({
  AgentHandler: { isAgentInvocation: jest.fn().mockResolvedValue(false) },
}));
jest.mock("../../../utils/chats", () => ({
  sourceIdentifier: jest.fn((source) => source.id),
  recentChatHistory: jest.fn().mockResolvedValue({
    rawHistory: [], chatHistory: [],
  }),
  chatPrompt: jest.fn().mockResolvedValue("grounded prompt"),
}));

const { WorkspaceChats } = require("../../../models/workspaceChats");
const {
  getVectorDbClass,
  resolveProviderConnector,
} = require("../../../utils/helpers");
const { streamResponse } = require("../../../utils/telegramBot/chat/stream");

test("Telegram query mode refuses before model generation", async () => {
  const connector = {
    promptWindowLimit: jest.fn().mockReturnValue(4096),
    compressMessages: jest.fn().mockResolvedValue([]),
    getChatCompletion: jest.fn(),
    streamGetChatCompletion: jest.fn(),
  };
  resolveProviderConnector.mockResolvedValue({ connector });
  getVectorDbClass.mockReturnValue({
    namespaceCount: jest.fn().mockResolvedValue(1),
    performSimilaritySearch: jest.fn().mockResolvedValue({
      contextTexts: [], sources: [], message: null,
    }),
  });
  const bot = {
    sendChatAction: jest.fn().mockResolvedValue(),
    sendMessage: jest.fn().mockResolvedValue({ message_id: 1 }),
  };

  await streamResponse({
    ctx: { bot, log: jest.fn() },
    chatId: 10,
    workspace: {
      id: 1,
      slug: "grounded",
      chatMode: "query",
      queryRefusalResponse: "근거가 없습니다.",
    },
    message: "모르는 사실",
  });

  expect(bot.sendMessage).toHaveBeenCalledWith(10, "근거가 없습니다.");
  expect(connector.compressMessages).not.toHaveBeenCalled();
  expect(connector.getChatCompletion).not.toHaveBeenCalled();
  expect(connector.streamGetChatCompletion).not.toHaveBeenCalled();
  expect(WorkspaceChats.new).toHaveBeenCalledWith(
    expect.objectContaining({
      include: false,
      response: expect.objectContaining({ sources: [] }),
    })
  );
});
```

- [ ] **Step 2: Run the test and verify RED**

```bash
PATH=/Users/songmyeongjin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH ./node_modules/.bin/jest server/__tests__/utils/telegramBot/grounding.test.js --runInBand
```

Expected: FAIL because Telegram currently proceeds to prompt compression and completion.

- [ ] **Step 3: Add the Telegram gate**

Default `chatMode` to `"query"`. After pinned/current search collection, call `buildGroundingContext`. On refusal:

```js
const refusal =
  workspace.queryRefusalResponse ??
  "There is no relevant information in this workspace to answer your query.";
clearInterval(typingInterval);
await ctx.bot.sendMessage(chatId, refusal);
await WorkspaceChats.new({
  workspaceId: workspace.id,
  prompt: message,
  response: {
    text: refusal,
    sources: [],
    type: chatMode,
    metrics: {},
    attachments,
  },
  threadId: thread?.id || null,
  include: false,
});
return;
```

Pass `chatMode` to `chatPrompt`. Do not history-backfill in query mode.

- [ ] **Step 4: Run the Telegram and grounding tests**

Run the Step 2 command plus `server/__tests__/utils/chats/grounding.test.js`. Expected: all selected tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/utils/telegramBot/chat/stream.js server/__tests__/utils/telegramBot/grounding.test.js
git commit -m "fix: enforce grounded query mode in Telegram"
```

### Task 5: Align explicit creation callers and administrator defaults

**Files:**
- Modify: `server/endpoints/api/workspace/index.js`
- Modify: `server/endpoints/telegram.js`
- Modify: `server/utils/telegramBot/utils/navigation/callbacks/handleWorkspaceCreate.js`
- Modify: `server/utils/telegramBot/utils/commands/handlers/handleStatus.js`
- Modify: `frontend/src/pages/WorkspaceSettings/ChatSettings/ChatModeSelection/index.jsx`
- Modify: `frontend/src/pages/Admin/DeveloperApi/index.jsx`

- [ ] **Step 1: Add source-level default assertions to the policy test**

Add these assertions to `defaultGroundingPolicy.test.js`. They protect system-default entry points without mounting the full React application:

```js
test("ordinary workspace entry points do not inject permissive defaults", () => {
  const root = path.resolve(__dirname, "../../..");
  const files = [
    "server/endpoints/api/workspace/index.js",
    "server/endpoints/telegram.js",
    "server/utils/telegramBot/utils/navigation/callbacks/handleWorkspaceCreate.js",
    "server/utils/telegramBot/utils/commands/handlers/handleStatus.js",
    "frontend/src/pages/WorkspaceSettings/ChatSettings/ChatModeSelection/index.jsx",
    "frontend/src/pages/Admin/DeveloperApi/index.jsx",
  ];
  const source = files
    .map((file) => fs.readFileSync(path.join(root, file), "utf8"))
    .join("\n");

  expect(source).not.toMatch(/chatMode:\s*["']automatic["']/);
  expect(source).not.toMatch(/mode\s*\|\|\s*["']chat["']/);
  expect(source).not.toMatch(/chatMode\s*\|\|\s*["']chat["']/);
  expect(source).not.toMatch(/preset\.mode\s*\|\|\s*["']chat["']/);
});
```

- [ ] **Step 2: Run and verify RED**

Run `defaultGroundingPolicy.test.js`. Expected: FAIL and list the remaining permissive fallbacks.

- [ ] **Step 3: Align callers without locking settings**

- Remove explicit `chatMode: "automatic"` from Telegram workspace creation calls so `Workspace.new` owns the default.
- Change sync/async API calls to pass `mode` unchanged rather than substituting `"chat"`.
- Change the developer API and workspace settings UI fallback to `"query"`.
- Change Telegram status display fallback to `"query"`.
- Do not change `Workspace.update`; this preserves administrator overrides.
- Leave scheduled jobs explicitly automatic because they are agent workflows, not ordinary user RAG chat.

- [ ] **Step 4: Run focused tests, lint changed files, and build frontend**

```bash
PATH=/Users/songmyeongjin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH ./node_modules/.bin/jest server/__tests__/prisma/defaultGroundingPolicy.test.js --runInBand
PATH=/Users/songmyeongjin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH ./server/node_modules/.bin/eslint server/models/workspace.js server/models/systemSettings.js server/utils/chats/grounding.js server/utils/chats/index.js server/utils/chats/apiChatHandler.js server/utils/chats/stream.js server/utils/chats/openaiCompatible.js server/utils/chats/embed.js server/utils/telegramBot/chat/stream.js server/endpoints/api/workspace/index.js server/endpoints/telegram.js
PATH=/Users/songmyeongjin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npm --prefix frontend run build
```

Expected: tests pass, ESLint reports no errors, frontend build exits 0.

- [ ] **Step 5: Run the complete server test suite and migration validation**

```bash
PATH=/Users/songmyeongjin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH ./node_modules/.bin/jest server/__tests__ --runInBand
PATH=/Users/songmyeongjin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH ./server/node_modules/.bin/prisma validate --schema server/prisma/schema.prisma
git diff --check
```

Expected: zero failed tests, Prisma schema valid, and no whitespace errors.

- [ ] **Step 6: Commit final alignment**

```bash
git add server/endpoints/api/workspace/index.js server/endpoints/telegram.js server/utils/telegramBot/utils/navigation/callbacks/handleWorkspaceCreate.js server/utils/telegramBot/utils/commands/handlers/handleStatus.js frontend/src/pages/WorkspaceSettings/ChatSettings/ChatModeSelection/index.jsx frontend/src/pages/Admin/DeveloperApi/index.jsx server/__tests__/prisma/defaultGroundingPolicy.test.js
git commit -m "feat: default all chat entry points to query mode"
```

## Final Review Checklist

- Existing workspaces are overwritten once to query/0.1/0.5.
- New workspaces receive the same defaults through SQLite, Prisma, and `Workspace.new`.
- Administrators can still select chat/automatic and other numeric values afterward.
- Query mode refuses before LLM invocation when current trusted context is empty.
- Query mode never treats previous-turn citations as current evidence.
- Telegram follows the same refusal policy.
- Custom prompts remain present and receive the grounding suffix only in query mode.
- Unrelated dirty-worktree files are neither staged nor modified.
