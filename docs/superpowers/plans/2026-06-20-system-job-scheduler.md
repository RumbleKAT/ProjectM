# System Job Scheduler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a trusted Node.js system-job registry to `BackgroundService`, expose administrator controls and run history, and ship a disabled-by-default job that deletes chat threads inactive for 30 days.

**Architecture:** Registry definitions remain the source of truth for executable code and schedules. A focused `SystemJobScheduler` owned by `BackgroundService` synchronizes database state, manages UTC cron timers and a concurrency queue, and supervises a generic Bree child process. The existing Scheduled Jobs settings screen gains a System Jobs tab backed by administrator-only endpoints.

**Tech Stack:** Node.js CommonJS, Bree child processes, `@breejs/later`, `p-queue`, Prisma 5/SQLite, Express, Jest, React 18, React Router, Tailwind CSS, i18next.

---

## File Map

### Persistence and domain models

- Create `server/prisma/migrations/20260620090000_add_system_jobs/migration.sql`: add system-job configuration and run tables.
- Modify `server/prisma/schema.prisma`: declare `system_job_configs` and `system_job_runs`.
- Create `server/models/systemJobConfig.js`: synchronize definitions, persist enablement and timestamps, and merge registry metadata for API responses.
- Create `server/models/systemJobRun.js`: claim, transition, complete, fail, timeout, append logs, query, and recover runs.
- Modify `server/models/workspaceThread.js`: transactionally delete non-FK dependents before deleting threads.

### Registry, handler, and execution

- Create `server/systemJobs/registry.js`: validate and resolve trusted definitions.
- Create `server/systemJobs/definitions/cleanupInactiveChatThreads.js`: declare the sample job and environment-derived settings.
- Create `server/systemJobs/handlers/cleanupInactiveChatThreads.js`: find, recheck, and delete inactive threads in batches.
- Create `server/utils/BackgroundWorkers/SystemJobScheduler.js`: synchronize registry jobs, manage timers/queue/dedup, spawn workers, and supervise exits/timeouts.
- Modify `server/utils/BackgroundWorkers/index.js`: own the scheduler and expose thin toggle/trigger delegation methods.
- Create `server/jobs/run-system-job.js`: generic child-process entry point.

### API and UI

- Create `server/endpoints/systemJobs.js`: administrator-only list, toggle, trigger, history, and detail endpoints.
- Modify `server/index.js`: register the new endpoint module while preserving unrelated endpoint additions.
- Create `frontend/src/models/systemJobs.js`: system-job API client.
- Modify `frontend/src/pages/GeneralSettings/ScheduledJobs/index.jsx`: add AI Jobs/System Jobs tabs without changing AI behavior.
- Create `frontend/src/pages/GeneralSettings/ScheduledJobs/SystemJobsPanel.jsx`: system-job list and actions.
- Create `frontend/src/pages/GeneralSettings/ScheduledJobs/SystemRunHistoryPage.jsx`: run history.
- Create `frontend/src/pages/GeneralSettings/ScheduledJobs/SystemRunDetailPage.jsx`: summary, logs, and errors.
- Create `frontend/src/pages/GeneralSettings/ScheduledJobs/components/SystemJobRow.jsx`: read-only system-job row.
- Modify `frontend/src/main.jsx` and `frontend/src/utils/paths.js`: add system-run routes while preserving unrelated routes.
- Modify `frontend/src/components/SettingsSidebar/index.jsx`: allow administrators to reach Scheduled Jobs while preserving current role filtering.
- Modify `frontend/src/locales/en/common.js` and `frontend/src/locales/ko/common.js`: add tab, system-job, history, and log labels.
- Modify `server/.env.example`: document retention, cron, and concurrency settings.

### Tests

- Create `server/__tests__/systemJobs/registry.test.js`.
- Create `server/__tests__/models/systemJobConfig.test.js`.
- Create `server/__tests__/models/systemJobRun.test.js`.
- Create `server/__tests__/models/workspaceThreadDelete.test.js`.
- Create `server/__tests__/systemJobs/cleanupInactiveChatThreads.test.js`.
- Create `server/__tests__/utils/BackgroundWorkers/SystemJobScheduler.test.js`.
- Create `server/__tests__/endpoints/systemJobs.test.js`.

## Task 1: Add system-job persistence

**Files:**
- Create: `server/prisma/migrations/20260620090000_add_system_jobs/migration.sql`
- Modify: `server/prisma/schema.prisma`
- Create: `server/models/systemJobConfig.js`
- Create: `server/models/systemJobRun.js`
- Test: `server/__tests__/models/systemJobConfig.test.js`
- Test: `server/__tests__/models/systemJobRun.test.js`

- [ ] **Step 1: Write failing model tests with a mocked Prisma client**

```js
jest.mock("../../utils/prisma", () => ({
  system_job_configs: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  system_job_runs: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  $transaction: jest.fn(async (callback) => callback(require("../../utils/prisma"))),
}));

test("syncDefinitions preserves stored enablement and disables stale keys", async () => {
  prisma.system_job_configs.upsert.mockResolvedValue({
    id: 1,
    jobKey: "cleanup-inactive-chat-threads",
    enabled: false,
  });
  await SystemJobConfig.syncDefinitions([
    { key: "cleanup-inactive-chat-threads", enabledByDefault: false },
  ]);
  expect(prisma.system_job_configs.upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { jobKey: "cleanup-inactive-chat-threads" },
      create: expect.objectContaining({ enabled: false }),
      update: {},
    })
  );
  expect(prisma.system_job_configs.updateMany).toHaveBeenCalledWith({
    where: { jobKey: { notIn: ["cleanup-inactive-chat-threads"] } },
    data: { enabled: false, nextRunAt: null },
  });
});

test("claim returns null when a run is already in flight", async () => {
  prisma.system_job_runs.findFirst.mockResolvedValue({ id: 9 });
  await expect(SystemJobRun.claim(1, "manual")).resolves.toBeNull();
  expect(prisma.system_job_runs.create).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the focused tests and confirm they fail**

Run: `yarn test --runInBand server/__tests__/models/systemJobConfig.test.js server/__tests__/models/systemJobRun.test.js`

Expected: FAIL because `systemJobConfig` and `systemJobRun` do not exist.

- [ ] **Step 3: Add the migration and Prisma models**

```sql
CREATE TABLE "system_job_configs" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "jobKey" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "lastRunAt" DATETIME,
  "nextRunAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "system_job_configs_jobKey_key" ON "system_job_configs"("jobKey");

CREATE TABLE "system_job_runs" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "systemJobConfigId" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "trigger" TEXT NOT NULL,
  "result" TEXT,
  "logs" TEXT,
  "error" TEXT,
  "queuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" DATETIME,
  "completedAt" DATETIME,
  CONSTRAINT "system_job_runs_systemJobConfigId_fkey"
    FOREIGN KEY ("systemJobConfigId") REFERENCES "system_job_configs"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "system_job_runs_systemJobConfigId_queuedAt_idx"
  ON "system_job_runs"("systemJobConfigId", "queuedAt");
CREATE INDEX "system_job_runs_status_idx" ON "system_job_runs"("status");
```

Add these equivalent Prisma models:

```prisma
model system_job_configs {
  id        Int               @id @default(autoincrement())
  jobKey    String            @unique
  enabled   Boolean           @default(false)
  lastRunAt DateTime?
  nextRunAt DateTime?
  createdAt DateTime          @default(now())
  updatedAt DateTime          @default(now())
  runs      system_job_runs[]
}

model system_job_runs {
  id                Int                @id @default(autoincrement())
  systemJobConfigId Int
  status            String             @default("queued")
  trigger           String
  result            String?
  logs              String?
  error             String?
  queuedAt          DateTime           @default(now())
  startedAt         DateTime?
  completedAt       DateTime?
  config            system_job_configs @relation(fields: [systemJobConfigId], references: [id], onDelete: Restrict)

  @@index([systemJobConfigId, queuedAt])
  @@index([status])
}
```

- [ ] **Step 4: Implement configuration synchronization and query methods**

```js
const SystemJobConfig = {
  async syncDefinitions(definitions) {
    const configs = [];
    for (const definition of definitions) {
      configs.push(
        await prisma.system_job_configs.upsert({
          where: { jobKey: definition.key },
          create: {
            jobKey: definition.key,
            enabled: definition.enabledByDefault === true,
          },
          update: {},
        })
      );
    }
    await prisma.system_job_configs.updateMany({
      where: { jobKey: { notIn: definitions.map(({ key }) => key) } },
      data: { enabled: false, nextRunAt: null },
    });
    return configs;
  },
  get(jobKey) {
    return prisma.system_job_configs.findUnique({ where: { jobKey } });
  },
  setEnabled(jobKey, enabled) {
    return prisma.system_job_configs.update({
      where: { jobKey },
      data: { enabled: Boolean(enabled) },
    });
  },
};
```

- [ ] **Step 5: Implement atomic-looking claim and terminal transitions**

Use a Prisma interactive transaction to check `status in ["queued", "running"]` and insert `queued` only when none exists. Implement `markRunning`, `complete`, `failIfNotTerminal`, `timeout`, `appendLogs`, `where`, `get`, and `failOrphanedRuns`. Terminal writes must use `updateMany` with a non-terminal status filter so a late worker message cannot overwrite timeout/failure.

```js
async claim(systemJobConfigId, trigger) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.system_job_runs.findFirst({
      where: {
        systemJobConfigId,
        status: { in: ["queued", "running"] },
      },
    });
    if (existing) return null;
    return tx.system_job_runs.create({
      data: { systemJobConfigId, trigger, status: "queued" },
    });
  });
}
```

- [ ] **Step 6: Generate Prisma client and rerun tests**

Run: `yarn prisma:generate && yarn test --runInBand server/__tests__/models/systemJobConfig.test.js server/__tests__/models/systemJobRun.test.js`

Expected: PASS.

- [ ] **Step 7: Commit persistence**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/20260620090000_add_system_jobs server/models/systemJobConfig.js server/models/systemJobRun.js server/__tests__/models/systemJobConfig.test.js server/__tests__/models/systemJobRun.test.js
git commit -m "feat: add system job persistence"
```

## Task 2: Build and validate the trusted registry

**Files:**
- Create: `server/systemJobs/registry.js`
- Create: `server/systemJobs/definitions/cleanupInactiveChatThreads.js`
- Test: `server/__tests__/systemJobs/registry.test.js`

- [ ] **Step 1: Write failing registry tests**

```js
const { createRegistry } = require("../../systemJobs/registry");

const valid = {
  key: "sample-job",
  name: "Sample job",
  description: "Runs a sample",
  schedule: "0 3 * * *",
  timeoutMs: 60_000,
  enabledByDefault: false,
  handler: require.resolve("../../systemJobs/handlers/cleanupInactiveChatThreads"),
};

test("resolves only registered jobs", () => {
  const registry = createRegistry([valid]);
  expect(registry.get("sample-job")).toEqual(valid);
  expect(registry.get("unknown")).toBeNull();
});

test.each([
  [[valid, valid], "Duplicate system job key"],
  [[{ ...valid, schedule: "bad" }], "Invalid cron"],
  [[{ ...valid, timeoutMs: 0 }], "Invalid timeout"],
  [[{ ...valid, handler: "/missing.js" }], "Handler not found"],
])("rejects invalid definitions", (definitions, message) => {
  expect(() => createRegistry(definitions)).toThrow(message);
});
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `yarn test --runInBand server/__tests__/systemJobs/registry.test.js`

Expected: FAIL because the registry module does not exist.

- [ ] **Step 3: Implement validation and immutable lookup**

```js
function createRegistry(definitions) {
  const jobs = new Map();
  for (const definition of definitions) {
    if (!definition?.key || jobs.has(definition.key))
      throw new Error(`Duplicate system job key: ${definition?.key}`);
    if (!cronValidate(definition.schedule).isValid())
      throw new Error(`Invalid cron for system job ${definition.key}`);
    if (!Number.isFinite(definition.timeoutMs) || definition.timeoutMs <= 0)
      throw new Error(`Invalid timeout for system job ${definition.key}`);
    if (!definition.handler || !fs.existsSync(definition.handler))
      throw new Error(`Handler not found for system job ${definition.key}`);
    jobs.set(definition.key, Object.freeze({ ...definition }));
  }
  return Object.freeze({
    all: () => [...jobs.values()],
    get: (key) => jobs.get(String(key)) || null,
  });
}
```

- [ ] **Step 4: Add the disabled cleanup definition with safe environment parsing**

```js
const retentionValue = Number(process.env.INACTIVE_CHAT_RETENTION_DAYS);
const retentionDays =
  Number.isFinite(retentionValue) && retentionValue > 0 ? retentionValue : 30;

module.exports = Object.freeze({
  key: "cleanup-inactive-chat-threads",
  name: "Cleanup inactive chat threads",
  description: `Deletes threads whose newest message is older than ${retentionDays} days.`,
  schedule: process.env.CLEANUP_INACTIVE_CHAT_THREADS_CRON || "0 3 * * *",
  timeoutMs: 10 * 60 * 1000,
  enabledByDefault: false,
  handler: require.resolve("../handlers/cleanupInactiveChatThreads"),
  options: { retentionDays, batchSize: 100 },
});
```

- [ ] **Step 5: Rerun tests and commit**

Run: `yarn test --runInBand server/__tests__/systemJobs/registry.test.js`

Expected: PASS.

```bash
git add server/systemJobs/registry.js server/systemJobs/definitions/cleanupInactiveChatThreads.js server/__tests__/systemJobs/registry.test.js
git commit -m "feat: add trusted system job registry"
```

## Task 3: Make thread deletion relationally safe

**Files:**
- Modify: `server/models/workspaceThread.js`
- Test: `server/__tests__/models/workspaceThreadDelete.test.js`

- [ ] **Step 1: Write a failing deletion test**

Mock `workspace_threads.findMany`, `$transaction`, and the three dependent models. Assert the method resolves thread IDs from the clause and deletes dependents before threads.

```js
test("delete removes non-FK dependents in one transaction", async () => {
  prisma.workspace_threads.findMany.mockResolvedValue([{ id: 3 }, { id: 4 }]);
  prisma.workspace_agent_invocations.deleteMany.mockResolvedValue({ count: 1 });
  prisma.workspace_chats.deleteMany.mockResolvedValue({ count: 6 });
  prisma.workspace_threads.deleteMany.mockResolvedValue({ count: 2 });

  await expect(WorkspaceThread.delete({ slug: { in: ["a", "b"] } })).resolves.toBe(true);
  expect(prisma.workspace_agent_invocations.deleteMany).toHaveBeenCalledWith({
    where: { thread_id: { in: [3, 4] } },
  });
  expect(prisma.workspace_chats.deleteMany).toHaveBeenCalledWith({
    where: { thread_id: { in: [3, 4] } },
  });
  expect(prisma.workspace_threads.deleteMany).toHaveBeenCalledWith({
    where: { id: { in: [3, 4] } },
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `yarn test --runInBand server/__tests__/models/workspaceThreadDelete.test.js`

Expected: FAIL because current deletion only removes `workspace_threads`.

- [ ] **Step 3: Implement transactional dependent cleanup**

```js
delete: async function (clause = {}) {
  try {
    const threads = await prisma.workspace_threads.findMany({
      where: clause,
      select: { id: true },
    });
    const ids = threads.map(({ id }) => id);
    if (ids.length === 0) return true;
    await prisma.$transaction([
      prisma.workspace_agent_invocations.deleteMany({
        where: { thread_id: { in: ids } },
      }),
      prisma.workspace_chats.deleteMany({ where: { thread_id: { in: ids } } }),
      prisma.workspace_threads.deleteMany({ where: { id: { in: ids } } }),
    ]);
    return true;
  } catch (error) {
    console.error(error.message);
    return false;
  }
},
```

- [ ] **Step 4: Rerun the test and commit**

Run: `yarn test --runInBand server/__tests__/models/workspaceThreadDelete.test.js`

Expected: PASS.

```bash
git add server/models/workspaceThread.js server/__tests__/models/workspaceThreadDelete.test.js
git commit -m "fix: remove thread dependent records"
```

## Task 4: Implement inactive-thread cleanup

**Files:**
- Create: `server/systemJobs/handlers/cleanupInactiveChatThreads.js`
- Test: `server/__tests__/systemJobs/cleanupInactiveChatThreads.test.js`

- [ ] **Step 1: Write failing eligibility and deletion tests**

Mock Prisma `$queryRaw`, `$transaction`, and dependent deletes. Cover old, boundary, recent, empty, reactivated, multi-batch, and partial-failure cases.

```js
test("deletes only a thread still inactive inside the transaction", async () => {
  prisma.$queryRaw.mockResolvedValueOnce([{ id: 7 }]).mockResolvedValueOnce([]);
  tx.workspace_chats.aggregate.mockResolvedValue({
    _max: { createdAt: new Date("2026-04-01T00:00:00Z") },
  });
  tx.workspace_chats.deleteMany.mockResolvedValue({ count: 4 });

  const result = await cleanupInactiveChatThreads({
    options: { retentionDays: 30, batchSize: 100 },
    now: new Date("2026-06-20T00:00:00Z"),
    log: jest.fn(),
  });

  expect(result.deletedThreads).toBe(1);
  expect(result.deletedChats).toBe(4);
  expect(tx.workspace_threads.deleteMany).toHaveBeenCalledWith({ where: { id: 7 } });
});

test("skips a candidate that received a message after selection", async () => {
  tx.workspace_chats.aggregate.mockResolvedValue({
    _max: { createdAt: new Date("2026-06-19T00:00:00Z") },
  });
  const result = await cleanupInactiveChatThreads(testContext);
  expect(result.skippedAfterRecheck).toBe(1);
  expect(tx.workspace_threads.deleteMany).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `yarn test --runInBand server/__tests__/systemJobs/cleanupInactiveChatThreads.test.js`

Expected: FAIL because the handler does not exist.

- [ ] **Step 3: Implement cutoff calculation, paged candidates, and transactional recheck**

Use a parameterized Prisma tagged-template query equivalent to:

```sql
SELECT wt.id
FROM workspace_threads wt
JOIN workspace_chats wc ON wc.thread_id = wt.id
WHERE wt.id > $cursor
GROUP BY wt.id
HAVING MAX(wc.createdAt) < $cutoff
ORDER BY wt.id ASC
LIMIT $batchSize
```

For each ID, run an interactive transaction that aggregates the latest message, skips when absent/new, deletes agent invocations and chats, then deletes the thread. Return the exact summary fields from the design. When failures exist, throw an `AggregateError` and attach the partial summary as `error.result`.

```js
const error = new AggregateError(failures, `${failures.length} thread deletions failed`);
error.result = summary;
throw error;
```

- [ ] **Step 4: Rerun handler and thread-deletion tests**

Run: `yarn test --runInBand server/__tests__/systemJobs/cleanupInactiveChatThreads.test.js server/__tests__/models/workspaceThreadDelete.test.js`

Expected: PASS.

- [ ] **Step 5: Commit the cleanup job**

```bash
git add server/systemJobs/handlers/cleanupInactiveChatThreads.js server/__tests__/systemJobs/cleanupInactiveChatThreads.test.js
git commit -m "feat: clean up inactive chat threads"
```

## Task 5: Add the system-job scheduler and child runner

**Files:**
- Create: `server/utils/BackgroundWorkers/SystemJobScheduler.js`
- Modify: `server/utils/BackgroundWorkers/index.js`
- Create: `server/jobs/run-system-job.js`
- Test: `server/__tests__/utils/BackgroundWorkers/SystemJobScheduler.test.js`

- [ ] **Step 1: Write failing scheduler tests using dependency injection**

Construct the scheduler with injected registry, models, timer factory, queue, and `spawnWorker` so no real process is needed. Cover boot synchronization, first-registration disabled state, toggle/timer behavior, disabled trigger rejection, duplicate skip, worker success, timeout, non-zero exit, log cap, and orphan recovery.

```js
test("boot syncs definitions, recovers runs, and schedules only enabled jobs", async () => {
  configModel.syncDefinitions.mockResolvedValue([
    { id: 1, jobKey: "enabled", enabled: true },
    { id: 2, jobKey: "disabled", enabled: false },
  ]);
  await scheduler.boot();
  expect(runModel.failOrphanedRuns).toHaveBeenCalled();
  expect(timerFactory).toHaveBeenCalledTimes(1);
  expect(timerFactory).toHaveBeenCalledWith("0 3 * * *", expect.any(Function));
});

test("trigger skips when claim reports an in-flight run", async () => {
  runModel.claim.mockResolvedValue(null);
  await expect(scheduler.enqueue("enabled", "manual")).resolves.toBeNull();
  expect(queue.add).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the scheduler test and confirm failure**

Run: `yarn test --runInBand server/__tests__/utils/BackgroundWorkers/SystemJobScheduler.test.js`

Expected: FAIL because `SystemJobScheduler` does not exist.

- [ ] **Step 3: Implement scheduler lifecycle**

The class owns a timer map, worker map, and `PQueue`. Public methods are `boot()`, `stop()`, `sync(jobKey)`, `enqueue(jobKey, trigger)`, and `list()`. Timer callbacks call `enqueue(key, "scheduled")`. Manual endpoints call `enqueue(key, "manual")`.

```js
async enqueue(jobKey, trigger) {
  const definition = this.registry.get(jobKey);
  if (!definition) throw new SystemJobError("NOT_FOUND", "System job not found");
  const config = await this.configModel.get(jobKey);
  if (!config?.enabled)
    throw new SystemJobError("DISABLED", "System job is disabled");
  const run = await this.runModel.claim(config.id, trigger);
  if (!run) return null;
  this.queue.add(() => this.#runWorker(definition, config, run));
  return run;
}
```

The worker supervisor sends `{ jobKey, runId }`, consumes `{ type: "log" }`, `{ type: "complete" }`, and `{ type: "failed" }` messages, flushes bounded logs, and uses a timeout to terminate the child. Exactly one terminal model transition may win.

- [ ] **Step 4: Implement the generic child runner**

```js
process.on("message", async ({ jobKey, runId }) => {
  const definition = registry.get(jobKey);
  if (!definition) return conclude(1);
  await SystemJobRun.markRunning(runId);
  const log = (message) => process.send?.({ type: "log", message: String(message) });
  try {
    const handler = require(definition.handler);
    const result = await handler({ options: definition.options || {}, log });
    process.send?.({ type: "complete", result });
    conclude(0);
  } catch (error) {
    process.send?.({
      type: "failed",
      error: error.message,
      result: error.result || null,
    });
    conclude(1);
  }
});
```

- [ ] **Step 5: Integrate it into `BackgroundService`**

Instantiate `SystemJobScheduler` after Bree exists so it can reuse `spawnWorker`. Call `await systemJobScheduler.boot()` from `BackgroundService.boot()` and `await systemJobScheduler.stop()` from `stop()`. Add thin public methods `listSystemJobs`, `syncSystemJob`, and `enqueueSystemJob` for endpoint use. Do not alter the current AI Scheduled Jobs maps, queues, or public methods.

- [ ] **Step 6: Run scheduler plus existing relevant tests**

Run: `yarn test --runInBand server/__tests__/utils/BackgroundWorkers/SystemJobScheduler.test.js server/__tests__/systemJobs/registry.test.js server/__tests__/models/systemJobRun.test.js`

Expected: PASS.

- [ ] **Step 7: Commit scheduler execution**

```bash
git add server/utils/BackgroundWorkers/SystemJobScheduler.js server/utils/BackgroundWorkers/index.js server/jobs/run-system-job.js server/__tests__/utils/BackgroundWorkers/SystemJobScheduler.test.js
git commit -m "feat: execute registered system jobs"
```

## Task 6: Add administrator system-job APIs

**Files:**
- Create: `server/endpoints/systemJobs.js`
- Modify: `server/index.js`
- Test: `server/__tests__/endpoints/systemJobs.test.js`

- [ ] **Step 1: Write failing endpoint tests with a mock Express app**

Mock `validatedRequest`, `flexUserRoleValid`, `SystemJobConfig`, `SystemJobRun`, registry, and `BackgroundService`. Capture route handlers as existing endpoint tests do.

```js
test("POST trigger returns skipped for an in-flight run", async () => {
  backgroundService.enqueueSystemJob.mockResolvedValue(null);
  await route("post", "/system-jobs/:key/trigger")(
    { params: { key: "cleanup-inactive-chat-threads" } },
    response
  );
  expect(response.status).toHaveBeenCalledWith(200);
  expect(response.json).toHaveBeenCalledWith({
    success: true,
    skipped: true,
    error: null,
  });
});

test("POST trigger maps disabled jobs to 409", async () => {
  backgroundService.enqueueSystemJob.mockRejectedValue(
    Object.assign(new Error("System job is disabled"), { code: "DISABLED" })
  );
  await route("post", "/system-jobs/:key/trigger")(request, response);
  expect(response.status).toHaveBeenCalledWith(409);
});
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `yarn test --runInBand server/__tests__/endpoints/systemJobs.test.js`

Expected: FAIL because the endpoint module does not exist.

- [ ] **Step 3: Implement endpoints and authorization**

Every route uses:

```js
[validatedRequest, flexUserRoleValid([ROLES.admin])]
```

Implement the five routes from the design. `GET /system-jobs` merges registry definitions, config rows, and latest runs. `toggle` persists the inverse enabled value then calls `backgroundService.syncSystemJob(key)`. `trigger` maps `NOT_FOUND` to 404, `DISABLED` to 409, and duplicate claims to `{ skipped: true }`.

- [ ] **Step 4: Register endpoints without overwriting unrelated `server/index.js` edits**

Add only the import and call:

```js
const { systemJobEndpoints } = require("./endpoints/systemJobs");
// ...
systemJobEndpoints(apiRouter);
```

- [ ] **Step 5: Run endpoint and scheduler tests**

Run: `yarn test --runInBand server/__tests__/endpoints/systemJobs.test.js server/__tests__/utils/BackgroundWorkers/SystemJobScheduler.test.js`

Expected: PASS.

- [ ] **Step 6: Commit API changes**

Stage only the new endpoint/test and the two `server/index.js` hunks; do not stage unrelated local changes.

```bash
git add server/endpoints/systemJobs.js server/__tests__/endpoints/systemJobs.test.js
git add -p server/index.js
git commit -m "feat: expose system job administration API"
```

## Task 7: Add the System Jobs tab and run views

**Files:**
- Create: `frontend/src/models/systemJobs.js`
- Modify: `frontend/src/pages/GeneralSettings/ScheduledJobs/index.jsx`
- Create: `frontend/src/pages/GeneralSettings/ScheduledJobs/SystemJobsPanel.jsx`
- Create: `frontend/src/pages/GeneralSettings/ScheduledJobs/SystemRunHistoryPage.jsx`
- Create: `frontend/src/pages/GeneralSettings/ScheduledJobs/SystemRunDetailPage.jsx`
- Create: `frontend/src/pages/GeneralSettings/ScheduledJobs/components/SystemJobRow.jsx`
- Modify: `frontend/src/main.jsx`
- Modify: `frontend/src/utils/paths.js`
- Modify: `frontend/src/components/SettingsSidebar/index.jsx`
- Modify: `frontend/src/locales/en/common.js`
- Modify: `frontend/src/locales/ko/common.js`

- [ ] **Step 1: Add the API model**

```js
const SystemJobs = {
  list: () => request("/system-jobs", { jobs: [] }),
  toggle: (key) => request(`/system-jobs/${encodeURIComponent(key)}/toggle`, { method: "POST" }),
  trigger: (key) => request(`/system-jobs/${encodeURIComponent(key)}/trigger`, { method: "POST" }),
  runs: (key) => request(`/system-jobs/${encodeURIComponent(key)}/runs`, { runs: [] }),
  getRun: (runId) => request(`/system-jobs/runs/${runId}`, { run: null, job: null }),
};
```

Implement `request` locally using `API_BASE`, `baseHeaders()`, response status checks, and a fallback payload so disabled-trigger errors reach the toast instead of being swallowed.

- [ ] **Step 2: Add tab state without disturbing the AI panel**

Extract the current AI list body only if needed to keep `index.jsx` readable. Use URL search state so refresh preserves the selected tab:

```jsx
const [searchParams, setSearchParams] = useSearchParams();
const activeTab = searchParams.get("tab") === "system" ? "system" : "ai";

<TabButton active={activeTab === "ai"} onClick={() => setSearchParams({ tab: "ai" })}>
  {t("scheduledJobs.tabs.ai")}
</TabButton>
<TabButton active={activeTab === "system"} onClick={() => setSearchParams({ tab: "system" })}>
  {t("scheduledJobs.tabs.system")}
</TabButton>
{activeTab === "ai" ? <AIJobsPanel /> : <SystemJobsPanel />}
```

The New Job and notification buttons remain visible only on the AI tab.

- [ ] **Step 3: Implement the read-only system-job table**

`SystemJobsPanel` polls every five seconds using the existing `usePolling`. `SystemJobRow` navigates to history and exposes only run-now and enabled switch actions. Disable run-now while disabled or while latest status is queued/running.

```jsx
const inFlight = ["queued", "running"].includes(job.latestRun?.status);
<button disabled={!job.enabled || inFlight} onClick={stop(() => onTrigger(job.key))}>
  <Play className="h-4 w-4" />
</button>
```

- [ ] **Step 4: Implement history and detail pages**

Reuse `StatusBadge` and the existing layout spacing. History shows trigger, status, queued/started time, duration, and error. Detail parses structured `result`, renders it as formatted JSON, renders logs in a bounded `<pre>`, and highlights errors. Do not render AI prompt, thoughts, tool calls, generated-file actions, or Continue in Chat.

- [ ] **Step 5: Add paths, routes, navigation visibility, and translations**

```js
systemJobRuns: (jobKey) =>
  `/settings/scheduled-jobs/system/${encodeURIComponent(jobKey)}/runs`,
systemJobRunDetail: (jobKey, runId) =>
  `/settings/scheduled-jobs/system/${encodeURIComponent(jobKey)}/runs/${runId}`,
```

Add matching lazy routes before `:id` AI routes so `system` is not captured as an AI job ID. Use `AdminRoute` for the settings page and system-run routes. Preserve the current AI routes. Update the sidebar item to `roles: ["admin"]` instead of hiding it whenever a user exists. Query `System.isMultiUserMode()` when the page loads; hide the AI tab in multi-user mode and force `activeTab` to `system` rather than broadening the AI Scheduled Jobs backend authorization.

Add complete English and Korean labels for tabs, table headings, disabled/in-flight messages, trigger type, logs, result, and empty states.

- [ ] **Step 6: Run frontend lint and build**

Run: `cd frontend && yarn lint:check && yarn build`

Expected: both commands exit 0 and Vite emits the production bundle.

- [ ] **Step 7: Commit UI changes**

Stage all new UI files and only the scheduler-related hunks in already modified shared files.

```bash
git add frontend/src/models/systemJobs.js frontend/src/pages/GeneralSettings/ScheduledJobs/SystemJobsPanel.jsx frontend/src/pages/GeneralSettings/ScheduledJobs/SystemRunHistoryPage.jsx frontend/src/pages/GeneralSettings/ScheduledJobs/SystemRunDetailPage.jsx frontend/src/pages/GeneralSettings/ScheduledJobs/components/SystemJobRow.jsx frontend/src/locales/en/common.js frontend/src/locales/ko/common.js
git add -p frontend/src/pages/GeneralSettings/ScheduledJobs/index.jsx frontend/src/main.jsx frontend/src/utils/paths.js frontend/src/components/SettingsSidebar/index.jsx
git commit -m "feat: add system jobs administration UI"
```

## Task 8: Document configuration and perform end-to-end verification

**Files:**
- Modify: `server/.env.example`

- [ ] **Step 1: Document environment variables**

```dotenv
# Maximum number of trusted system jobs executing at once.
SYSTEM_JOB_MAX_CONCURRENT=1

# Inactive chat cleanup is registered disabled and must be enabled in Settings.
# Cron schedules use UTC.
CLEANUP_INACTIVE_CHAT_THREADS_CRON="0 3 * * *"
INACTIVE_CHAT_RETENTION_DAYS=30
```

- [ ] **Step 2: Run all focused backend tests**

Run:

```bash
yarn test --runInBand \
  server/__tests__/models/systemJobConfig.test.js \
  server/__tests__/models/systemJobRun.test.js \
  server/__tests__/models/workspaceThreadDelete.test.js \
  server/__tests__/systemJobs/registry.test.js \
  server/__tests__/systemJobs/cleanupInactiveChatThreads.test.js \
  server/__tests__/utils/BackgroundWorkers/SystemJobScheduler.test.js \
  server/__tests__/endpoints/systemJobs.test.js
```

Expected: all focused suites pass.

- [ ] **Step 3: Run repository checks**

Run:

```bash
cd server && yarn lint:check
cd ../frontend && yarn lint:check && yarn build
cd .. && yarn translations:verify
git diff --check
```

Expected: all commands exit 0. If the translation verifier requires all locales to contain the new keys, add the English fallback values to the other locale files using the repository translation-normalization script, then rerun verification.

- [ ] **Step 4: Apply the migration to a disposable database and smoke-test the API**

Use a temporary copy of the SQLite database or a fresh test database. Run Prisma migration deployment, start the server, and verify:

```text
GET  /api/system-jobs                                      -> cleanup job, enabled=false
POST /api/system-jobs/cleanup-inactive-chat-threads/trigger -> 409 while disabled
POST /api/system-jobs/cleanup-inactive-chat-threads/toggle  -> enabled=true
POST /api/system-jobs/cleanup-inactive-chat-threads/trigger -> success=true
GET  /api/system-jobs/cleanup-inactive-chat-threads/runs    -> completed/failed run with logs
```

Use seeded test threads on both sides of the 30-day cutoff and confirm only the old thread and its dependent rows are deleted.

- [ ] **Step 5: Verify the UI in the browser**

Open `/settings/scheduled-jobs?tab=system` and confirm:

- AI Jobs remains unchanged.
- System Jobs lists the cleanup job as disabled.
- Enabling updates next-run time.
- Run now becomes available after enabling and is disabled while in flight.
- History and detail show trigger, duration, result, logs, and errors.
- Name, description, schedule, timeout, edit, create, and delete are not mutable for system jobs.

- [ ] **Step 6: Commit documentation and any verification fixes**

```bash
git add server/.env.example
git commit -m "docs: document system job configuration"
```

Do not stage or commit unrelated pre-existing workspace changes.
