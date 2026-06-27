# Current Date Agent Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a default `get-current-datetime` agent tool that returns the actual date, time, and weekday using the browser time zone, with server-time-zone fallback.

**Architecture:** A pure helper validates IANA time zones and formats a fresh `Date` for each tool call. Web chat requests carry the browser time zone into the durable agent invocation used by the later WebSocket connection. The tool is enabled by default, and the agent role explicitly requires it for current-date, weekday, and current-time questions.

**Tech Stack:** Node.js CommonJS, AIbitat plugins, Prisma/SQLite, React, Jest 29, ESLint

---

## File Map

- Create `server/utils/agents/aibitat/plugins/current-datetime.js` for time-zone resolution, date formatting, and tool registration.
- Create `server/__tests__/utils/agents/aibitat/plugins/current-datetime.test.js` for boundary and tool-contract tests.
- Modify `server/utils/agents/aibitat/plugins/index.js` and `server/utils/agents/defaults.js` for registration and role guidance.
- Modify `server/__tests__/utils/agents/defaults.test.js` for default availability and mandatory-use coverage.
- Create `server/__tests__/models/workspaceAgentInvocation.test.js` for durable time-zone persistence.
- Create `server/__tests__/frontend/currentDateTimeZoneWiring.test.js` for web request wiring.
- Create `server/prisma/migrations/20260627120000_add_agent_invocation_timezone/migration.sql` and modify `server/prisma/schema.prisma`.
- Modify `server/models/workspaceAgentInvocation.js`, `server/endpoints/chat.js`, `server/utils/chats/stream.js`, and `server/utils/chats/agents.js` to carry validated time zones.
- Modify `frontend/src/models/workspace.js` and `frontend/src/models/workspaceThread.js` to send the browser time zone.

### Task 1: Deterministic date tool

**Files:**
- Create: `server/__tests__/utils/agents/aibitat/plugins/current-datetime.test.js`
- Create: `server/utils/agents/aibitat/plugins/current-datetime.js`

- [ ] **Step 1: Write the failing tests**

```js
const {
  currentDateTime,
  currentDateTimeParts,
  resolveTimeZone,
} = require("../../../../../utils/agents/aibitat/plugins/current-datetime");

describe("get-current-datetime", () => {
  afterEach(() => jest.useRealTimers());

  test("uses the next local day in Asia/Seoul", () => {
    expect(currentDateTimeParts({
      now: new Date("2026-06-26T15:30:00.000Z"),
      timeZone: "Asia/Seoul",
    })).toEqual({
      date: "2026-06-27",
      time: "00:30:00",
      weekday: "Saturday",
      timeZone: "Asia/Seoul",
    });
  });

  test("uses the previous local day in America/Los_Angeles", () => {
    expect(currentDateTimeParts({
      now: new Date("2026-06-27T02:00:00.000Z"),
      timeZone: "America/Los_Angeles",
    })).toEqual({
      date: "2026-06-26",
      time: "19:00:00",
      weekday: "Friday",
      timeZone: "America/Los_Angeles",
    });
  });

  test("invalid input uses the supplied server fallback", () => {
    expect(resolveTimeZone("Mars/Olympus", "Asia/Seoul")).toBe("Asia/Seoul");
  });

  test("missing input uses the server time zone", () => {
    const original = process.env.TZ;
    process.env.TZ = "Asia/Seoul";
    expect(resolveTimeZone(null)).toBe("Asia/Seoul");
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });

  test("registers a parameterless tool", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-06-26T15:30:00.000Z"));
    let tool;
    const aibitat = {
      handlerProps: { invocation: { timezone: "Asia/Seoul" }, log: jest.fn() },
      introspect: jest.fn(),
      function: (config) => { tool = config; },
    };
    currentDateTime.plugin().setup(aibitat);
    expect(tool.parameters.properties).toEqual({});
    await expect(tool.handler.call(tool, {})).resolves.toBe(
      "Current date: 2026-06-27\nCurrent time: 00:30:00\nWeekday: Saturday\nTime zone: Asia/Seoul"
    );
  });
});
```

- [ ] **Step 2: Verify RED**

```bash
PATH=/Users/songmyeongjin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH ./node_modules/.bin/jest server/__tests__/utils/agents/aibitat/plugins/current-datetime.test.js --runInBand
```

Expected: FAIL because `plugins/current-datetime.js` does not exist.

- [ ] **Step 3: Implement the helper and plugin**

```js
function isValidTimeZone(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value.trim() }).format();
    return true;
  } catch {
    return false;
  }
}

function serverTimeZone() {
  let runtimeTimeZone = null;
  try {
    runtimeTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {}
  return [process.env.TZ, runtimeTimeZone, "UTC"].find(isValidTimeZone) || "UTC";
}

function resolveTimeZone(candidate, fallback = serverTimeZone()) {
  if (isValidTimeZone(candidate)) return candidate.trim();
  if (isValidTimeZone(fallback)) return fallback.trim();
  return "UTC";
}

function currentDateTimeParts({ now = new Date(), timeZone = null } = {}) {
  const resolvedTimeZone = resolveTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: resolvedTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    weekday: "long",
  }).formatToParts(now);
  const value = (type) => parts.find((part) => part.type === type)?.value;
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    time: `${value("hour")}:${value("minute")}:${value("second")}`,
    weekday: value("weekday"),
    timeZone: resolvedTimeZone,
  };
}

const currentDateTime = {
  name: "get-current-datetime",
  startupConfig: { params: {} },
  plugin: function () {
    return {
      name: this.name,
      setup(aibitat) {
        aibitat.function({
          super: aibitat,
          name: this.name,
          description: "Get the actual current date, time, and weekday. You MUST use this before answering questions about today's date, the current date, today's weekday, the current time, or what time it is. Never guess.",
          examples: [
            { prompt: "What is today's date?", call: JSON.stringify({}) },
            { prompt: "오늘 날짜와 요일이 뭐야?", call: JSON.stringify({}) },
            { prompt: "지금 몇 시야?", call: JSON.stringify({}) },
          ],
          parameters: {
            $schema: "http://json-schema.org/draft-07/schema#",
            type: "object",
            properties: {},
            additionalProperties: false,
          },
          handler: async function () {
            try {
              const result = currentDateTimeParts({
                timeZone: this.super.handlerProps.invocation?.timezone,
              });
              this.super.introspect(
                `${this.caller}: Checking the current date and time in ${result.timeZone}.`
              );
              return `Current date: ${result.date}\nCurrent time: ${result.time}\nWeekday: ${result.weekday}\nTime zone: ${result.timeZone}`;
            } catch (error) {
              this.super.handlerProps.log(
                `get-current-datetime raised an error. ${error.message}`
              );
              return "The current date and time could not be determined. Do not guess them; tell the user the lookup failed.";
            }
          },
        });
      },
    };
  },
};

module.exports = {
  currentDateTime,
  currentDateTimeParts,
  isValidTimeZone,
  resolveTimeZone,
  serverTimeZone,
};
```

- [ ] **Step 4: Verify GREEN and commit**

Run the Step 2 command; expect 5 passing tests. Then:

```bash
git add server/utils/agents/aibitat/plugins/current-datetime.js server/__tests__/utils/agents/aibitat/plugins/current-datetime.test.js
git commit -m "feat: add deterministic current date agent tool"
```

### Task 2: Default registration and mandatory guidance

**Files:**
- Modify: `server/utils/agents/aibitat/plugins/index.js`
- Modify: `server/utils/agents/defaults.js`
- Modify: `server/__tests__/utils/agents/defaults.test.js`

- [ ] **Step 1: Add the failing behavior test**

```js
it("enables get-current-datetime and requires it for temporal questions", async () => {
  const definition = await WORKSPACE_AGENT.getDefinition(
    "openai",
    { id: 1, openAiPrompt: null },
    null
  );
  expect(definition.functions).toContain("get-current-datetime");
  expect(definition.role).toContain("MUST call get-current-datetime before answering");
  expect(definition.role).toContain("Never infer the current date, time, or weekday");
});
```

- [ ] **Step 2: Verify RED**

```bash
PATH=/Users/songmyeongjin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH ./node_modules/.bin/jest server/__tests__/utils/agents/defaults.test.js --runInBand
```

Expected: FAIL because the tool is absent.

- [ ] **Step 3: Register and guide**

Import and export `currentDateTime` in the plugin index, including `[currentDateTime.name]: currentDateTime`. Add `AgentPlugins.currentDateTime.name` to `DEFAULT_SKILLS`. Build the function array once in `WORKSPACE_AGENT.getDefinition`, then append:

```js
if (functions.includes(AgentPlugins.currentDateTime.name)) {
  role +=
    "\n\nFor any question asking for today's date, the current date, today's weekday, the current time, or what time it is, you MUST call get-current-datetime before answering. Never infer the current date, time, or weekday from model knowledge or previous messages. Preserve the date, time, and weekday returned by the tool.";
}
```

- [ ] **Step 4: Verify GREEN and commit**

Run the Task 1 and Task 2 Jest files together; expect both suites to pass. Then:

```bash
git add server/utils/agents/aibitat/plugins/index.js server/utils/agents/defaults.js server/__tests__/utils/agents/defaults.test.js
git commit -m "feat: enable current date tool for agents"
```

### Task 3: Browser time-zone delivery

**Files:**
- Create: `server/__tests__/models/workspaceAgentInvocation.test.js`
- Create: `server/__tests__/frontend/currentDateTimeZoneWiring.test.js`
- Create: `server/prisma/migrations/20260627120000_add_agent_invocation_timezone/migration.sql`
- Modify: `server/prisma/schema.prisma`
- Modify: `server/models/workspaceAgentInvocation.js`
- Modify: `frontend/src/models/workspace.js`
- Modify: `frontend/src/models/workspaceThread.js`
- Modify: `server/endpoints/chat.js`
- Modify: `server/utils/chats/stream.js`
- Modify: `server/utils/chats/agents.js`

- [ ] **Step 1: Write the failing persistence test**

```js
jest.mock("../../utils/prisma", () => ({
  workspace_agent_invocations: { create: jest.fn() },
}));
const prisma = require("../../utils/prisma");
const { WorkspaceAgentInvocation } = require("../../models/workspaceAgentInvocation");

test("persists the browser time zone", async () => {
  prisma.workspace_agent_invocations.create.mockResolvedValue({ id: 1 });
  await WorkspaceAgentInvocation.new({
    prompt: "@agent 오늘 날짜는?",
    workspace: { id: 7 },
    timeZone: "Asia/Seoul",
  });
  expect(prisma.workspace_agent_invocations.create).toHaveBeenCalledWith({
    data: expect.objectContaining({ timezone: "Asia/Seoul" }),
  });
});
```

- [ ] **Step 2: Write the failing web wiring test**

```js
const fs = require("fs");
const path = require("path");

test.each(["workspace.js", "workspaceThread.js"])(
  "%s sends browser time zone",
  (filename) => {
    const source = fs.readFileSync(
      path.resolve(__dirname, `../../../frontend/src/models/${filename}`),
      "utf8"
    );
    expect(source).toContain("Intl.DateTimeFormat().resolvedOptions().timeZone");
    expect(source).toMatch(/JSON\.stringify\(\{[\s\S]*timeZone[\s\S]*\}\)/);
  }
);
```

- [ ] **Step 3: Verify RED**

```bash
PATH=/Users/songmyeongjin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH ./node_modules/.bin/jest server/__tests__/models/workspaceAgentInvocation.test.js server/__tests__/frontend/currentDateTimeZoneWiring.test.js --runInBand
```

Expected: persistence and source-wiring assertions fail.

- [ ] **Step 4: Add storage and request plumbing**

Add `timezone String?` to the Prisma model and create:

```sql
ALTER TABLE "workspace_agent_invocations" ADD COLUMN "timezone" TEXT;
```

Accept `timeZone = null` in `WorkspaceAgentInvocation.new` and store `timezone: timeZone`.

Both frontend stream methods compute:

```js
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
```

and send `JSON.stringify({ message, attachments, timeZone })`.

Both chat routes accept `timeZone = null` and pass `{ timeZone }` as a final argument to `streamChatWithWorkspace`. That function accepts `requestContext = {}` and passes `timeZone: requestContext.timeZone` to `grepAgents`. At the agent trust boundary, persist:

```js
const { resolveTimeZone } = require("../agents/aibitat/plugins/current-datetime");

timeZone: resolveTimeZone(timeZone),
```

- [ ] **Step 5: Generate Prisma, verify GREEN, and commit**

```bash
PATH=/Users/songmyeongjin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH ./server/node_modules/.bin/prisma generate --schema server/prisma/schema.prisma
PATH=/Users/songmyeongjin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH ./node_modules/.bin/jest server/__tests__/models/workspaceAgentInvocation.test.js server/__tests__/frontend/currentDateTimeZoneWiring.test.js server/__tests__/utils/agents/aibitat/plugins/current-datetime.test.js --runInBand
git add frontend/src/models/workspace.js frontend/src/models/workspaceThread.js server/endpoints/chat.js server/utils/chats/stream.js server/utils/chats/agents.js server/models/workspaceAgentInvocation.js server/prisma/schema.prisma server/prisma/migrations/20260627120000_add_agent_invocation_timezone/migration.sql server/__tests__/models/workspaceAgentInvocation.test.js server/__tests__/frontend/currentDateTimeZoneWiring.test.js
git commit -m "feat: pass browser timezone to date tool"
```

Expected: Prisma generation succeeds and all focused tests pass.

### Task 4: Full verification

**Files:**
- Verify all files changed by Tasks 1-3.

- [ ] **Step 1: Run all focused Jest suites**

```bash
PATH=/Users/songmyeongjin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH ./node_modules/.bin/jest server/__tests__/utils/agents/defaults.test.js server/__tests__/utils/agents/aibitat/plugins/current-datetime.test.js server/__tests__/models/workspaceAgentInvocation.test.js server/__tests__/frontend/currentDateTimeZoneWiring.test.js --runInBand
```

Expected: all suites pass without warnings.

- [ ] **Step 2: Run focused lint checks**

```bash
PATH=/Users/songmyeongjin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH ./server/node_modules/.bin/eslint server/utils/agents/aibitat/plugins/current-datetime.js server/utils/agents/aibitat/plugins/index.js server/utils/agents/defaults.js server/models/workspaceAgentInvocation.js server/endpoints/chat.js server/utils/chats/stream.js server/utils/chats/agents.js server/__tests__/utils/agents/aibitat/plugins/current-datetime.test.js server/__tests__/utils/agents/defaults.test.js server/__tests__/models/workspaceAgentInvocation.test.js server/__tests__/frontend/currentDateTimeZoneWiring.test.js
PATH=/Users/songmyeongjin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH ./frontend/node_modules/.bin/eslint frontend/src/models/workspace.js frontend/src/models/workspaceThread.js
```

Expected: both commands exit 0.

- [ ] **Step 3: Build and inspect**

```bash
PATH=/Users/songmyeongjin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npm --prefix frontend run build
git diff --check HEAD~3..HEAD
git status --short
```

Expected: the frontend build succeeds, the diff has no whitespace errors, and only the user's pre-existing model-price cache changes remain unstaged.
