# System Job Scheduler Design

## Summary

Extend the existing Bree-based `BackgroundService` with a registry for developer-defined Node.js system jobs. System jobs run in isolated child processes, support cron and manual execution, persist operational state and run history, and appear in a new **System Jobs** tab on the existing Scheduled Jobs settings page.

The first registered job deletes chat threads whose most recent message is older than a configurable retention period. The retention period defaults to 30 days. Because this is destructive, the job is disabled on first registration and must be enabled by an administrator.

## Context

The server already has two related scheduling mechanisms:

- `BackgroundService` registers a small hard-coded set of Bree worker files such as generated-file cleanup.
- User-managed Scheduled Jobs persist AI prompts and schedules and run them through an ephemeral agent.

Neither mechanism is a good general developer interface for operational Node.js jobs. Adding more entries to `BackgroundService.#alwaysRunJobs` would keep expanding one service with job-specific concerns. Reusing AI Scheduled Jobs would mix user-authored prompts with trusted deployment code and would expose the wrong editing and security model.

## Goals

- Give developers a declarative registry for trusted Node.js batch jobs.
- Run registered jobs on cron schedules or manually from an administrator UI.
- Execute each job in an isolated child process with timeout and concurrency controls.
- Persist enablement state, run status, output summary, bounded logs, and errors.
- Prevent overlapping executions of the same job.
- Preserve the existing AI Scheduled Jobs behavior.
- Provide a sample job that deletes inactive chat threads safely.

## Non-goals

- Uploading or authoring JavaScript from the UI.
- Accepting commands, file paths, or handler code through an API.
- Editing a system job's name, description, cron, or timeout in the UI.
- Distributing jobs across multiple server instances.
- Deleting chat threads that have never contained a message.
- Building a general Jenkins-compatible pipeline language.

## Selected Approach

Use a dedicated System Job Registry. Registry definitions are the source of truth for identity, display metadata, schedule, timeout, and handler. Database rows contain only mutable operational state and execution history.

This keeps three boundaries explicit:

1. Trusted code defines what may execute.
2. `BackgroundService` schedules and supervises execution.
3. The API and UI expose safe operational controls without accepting executable input.

## Architecture

### Registry

`server/systemJobs/registry.js` exports validated definitions keyed by a stable identifier. A definition contains:

- `key`: stable, unique identifier
- `name`: administrator-facing name
- `description`: administrator-facing purpose
- `schedule`: five-field cron string sourced from code or an environment variable
- `timeoutMs`: positive execution timeout
- `enabledByDefault`: initial state for the first database registration
- `handler`: trusted module reference used by the generic worker

Registry validation runs during server boot. Duplicate keys, invalid cron expressions, invalid timeouts, or missing handlers fail boot with an actionable error. The API never accepts or returns executable paths.

### BackgroundService

At boot, `BackgroundService`:

1. Validates all registry definitions.
2. Marks orphaned `queued` or `running` system-job runs as failed.
3. Upserts a configuration row for every registered key while preserving an existing enabled value.
4. Disables retained database configurations whose keys no longer exist in the registry.
5. Computes the next run time and registers timers for enabled jobs.

System cron expressions use UTC, matching the existing `later.date.UTC()` behavior.

Scheduled and manual requests share the same enqueue path. A database-backed claim rejects a second `queued` or `running` run for the same job. A dedicated `PQueue` limits total system-job concurrency using `SYSTEM_JOB_MAX_CONCURRENT`, which defaults to `1`.

Disabling a job clears its future timer but does not terminate an already running process. A disabled job cannot be triggered manually until it is enabled again.

### Worker Process

`server/jobs/run-system-job.js` is a generic Bree child-process entry point. The parent sends only a registry key and run ID. The worker resolves the key against its local registry, marks the run as running, invokes the handler, and reports structured log and completion messages over IPC.

The parent supervises timeout and abnormal exit behavior. Timeout terminates the worker and records `timed_out`; handler exceptions and unexpected exits record `failed`. Successful handlers return a JSON-serializable result recorded as `completed`.

Logs are buffered and periodically persisted while the worker runs. Stored logs are capped at 200 KiB per run; truncation adds an explicit marker. This keeps the run detail useful without allowing unbounded database growth.

## Persistence

Add two Prisma models and a migration.

### `system_job_configs`

- `id`
- `jobKey` (unique)
- `enabled` (default taken from the definition on initial registration)
- `lastRunAt`
- `nextRunAt`
- `createdAt`
- `updatedAt`

### `system_job_runs`

- `id`
- `systemJobConfigId` (foreign key)
- `status`: `queued`, `running`, `completed`, `failed`, or `timed_out`
- `trigger`: `scheduled` or `manual`
- `result`: nullable serialized JSON
- `logs`: nullable text
- `error`: nullable text
- `queuedAt`
- `startedAt`
- `completedAt`

Indexes cover configuration key, configuration/run lookup, status, and newest-first history queries. Configuration rows are retained when code definitions disappear so historical runs are not lost.

## API

Add administrator-only endpoints under `/system-jobs`:

- `GET /system-jobs`: merge registry definitions with stored state and latest run
- `POST /system-jobs/:key/toggle`: enable or disable future execution
- `POST /system-jobs/:key/trigger`: enqueue a manual execution
- `GET /system-jobs/:key/runs`: list run history
- `GET /system-jobs/runs/:runId`: return run details, result, logs, and error

Unknown keys return 404. Duplicate trigger requests return a successful response with `skipped: true`, matching the current AI Scheduled Jobs interaction. Disabled jobs reject manual triggers with a clear 409 response.

## Administrator UI

Keep the existing Scheduled Jobs navigation item and page. Add two tabs:

- **AI Jobs**: the existing screen and behavior
- **System Jobs**: registered code jobs

The System Jobs table reuses the visual language of the existing table and shows name, schedule, latest status, last run, next run, and actions. Available actions are enable/disable and run now. Definitions are read-only and cannot be created, edited, or deleted.

Selecting a row opens its run history. Selecting a run shows status, trigger type, timing, result summary, logs, and error. Existing status badge and layout components should be reused where practical without coupling AI-only prompt and tool-call details to system runs.

## Inactive Chat Cleanup Job

### Definition

- Key: `cleanup-inactive-chat-threads`
- Default schedule: `0 3 * * *` (03:00 UTC daily)
- Schedule override: `CLEANUP_INACTIVE_CHAT_THREADS_CRON`
- Retention: `INACTIVE_CHAT_RETENTION_DAYS`, default `30`
- Timeout: 10 minutes
- Initial state: disabled

Invalid or non-positive retention values fall back to 30 and emit a warning at boot.

### Eligibility

A thread is eligible when:

- it has at least one `workspace_chats` row, and
- `MAX(workspace_chats.createdAt)` is strictly older than the cutoff.

`workspace_threads.lastUpdatedAt` is not used. Threads without messages are excluded. Hidden or excluded messages still count as activity because they are messages in the thread.

### Deletion Flow

Candidates are selected in ascending thread-ID batches of 100. For every candidate, a transaction:

1. Re-reads the newest message timestamp.
2. Skips the thread if it has no message or now falls on or after the cutoff.
3. Deletes related `workspace_agent_invocations` rows.
4. Deletes related `workspace_chats` rows.
5. Deletes the `workspace_threads` row.

`workspace_parsed_files` metadata is removed by its existing foreign-key cascade. Files generated by deleted chats become unreferenced and are removed by the existing `cleanup-generated-files` job.

The handler returns:

- retention days and cutoff
- candidate count
- deleted thread count
- deleted chat count
- skipped-after-recheck count
- failed count

Individual deletion failures are logged and processing continues. If any candidate fails, the handler throws a final aggregate error carrying the partial summary in a `result` property. The worker persists that result with the failure, so a partially successful run is visible rather than silently reported as completed.

### Shared Thread Deletion Safety

Refactor `WorkspaceThread.delete()` to use the same transactional dependent-row cleanup. Existing manual, bulk, and API thread-deletion paths already call this model method, so this prevents orphaned chats and agent invocations outside the scheduled job as well. The method keeps its current clause-based interface and boolean result contract.

## Failure and Recovery Behavior

- A handler exception records `failed` with its message and bounded logs.
- Exceeding the definition timeout terminates the process and records `timed_out`.
- A non-zero or unexpected worker exit records `failed`.
- Server boot changes abandoned `queued` and `running` rows to `failed` with a restart explanation.
- Timer registration errors are logged with the job key and fail boot rather than leaving a silently unscheduled job.
- A manual or scheduled duplicate does not create a second in-flight run.
- A process failure never disables the job automatically; administrators use history and logs to decide whether to disable it.

## Testing Strategy

Implementation follows test-driven development.

### Registry tests

- accepts a valid definition
- rejects duplicate keys, invalid cron, invalid timeout, and missing handlers
- resolves definitions only by known key

### Cleanup model and handler tests

- uses the 30-day default and honors the environment override
- includes a thread whose latest message is strictly older than the cutoff
- excludes a thread on the cutoff, a recently active thread, and an empty thread
- rechecks activity inside the deletion transaction
- deletes chats, agent invocations, and the thread
- preserves a candidate that becomes active before deletion
- processes more than one batch
- reports partial failures and continues remaining candidates
- verifies manual `WorkspaceThread.delete()` uses dependent cleanup

### Scheduler and worker tests

- boot synchronizes definitions while preserving enabled state
- a first registration uses `enabledByDefault: false`
- toggle registers or clears a timer
- manual and scheduled triggers share one enqueue path
- duplicate in-flight execution is skipped
- global concurrency is respected
- success, handler failure, timeout, abnormal exit, and orphan recovery persist correct states
- logs are persisted and truncated at the configured bound

### API tests

- rejects non-administrators
- lists merged definition and operational state
- toggles a known job
- rejects unknown and disabled triggers
- returns skipped for a duplicate trigger
- lists and retrieves run history

### UI tests

- switches between AI Jobs and System Jobs tabs
- preserves the existing AI Jobs behavior
- renders system definitions as read-only
- enables/disables and manually triggers a system job
- disables run-now while disabled or in flight
- renders history, result, logs, and errors

## Acceptance Criteria

- A developer can add a new trusted Node.js job by adding one definition and one handler without adding job-specific code to `BackgroundService`.
- An administrator can see, enable, disable, trigger, and inspect system jobs from the Scheduled Jobs screen.
- System jobs run in isolated child processes with deduplication, concurrency limits, timeout, persistent results, and logs.
- The cleanup sample deletes only threads with at least one message whose newest message is older than the configured retention cutoff.
- The retention default is 30 days and can be overridden by environment variable.
- The destructive cleanup job is disabled on first deployment.
- Existing AI Scheduled Jobs and fixed background workers continue to behave as before.
