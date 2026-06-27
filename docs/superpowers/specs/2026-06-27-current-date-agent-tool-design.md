# Current Date Agent Tool Design

## Objective

Reduce hallucinated answers to questions about the current date, weekday, or time by giving the agent a deterministic `get-current-datetime` tool. The tool calculates the answer at call time instead of relying on the model's training data or prompt memory.

## Scope

This change applies to agent execution, including explicit `@agent` sessions and automatic mode when native tool calling is available. Ordinary non-agent chat remains unchanged because it cannot invoke agent tools.

The web client supplies its IANA time zone. Agent entry points without browser context, including Telegram, developer APIs, scheduled jobs, and mobile clients, use the server's resolved IANA time zone.

## Tool Contract

The built-in plugin is named `get-current-datetime` and is enabled as a default agent skill. It accepts no model-provided parameters, preventing the model from substituting a guessed date or time zone.

At execution time the tool returns a compact, unambiguous result containing:

- Local calendar date in `YYYY-MM-DD` form
- Local time in 24-hour `HH:mm:ss` form
- English weekday name
- Resolved IANA time zone

For example:

```text
Current date: 2026-06-27
Current time: 14:35:20
Weekday: Saturday
Time zone: Asia/Seoul
```

The model may translate or reformat this result for the user, but it must preserve the returned date, time, and weekday.

## Time-Zone Flow

The workspace and workspace-thread web chat requests include `timeZone`, obtained from `Intl.DateTimeFormat().resolvedOptions().timeZone`.

The server validates the candidate by constructing an `Intl.DateTimeFormat` with it. A valid browser time zone is stored on the durable workspace agent invocation so the later WebSocket-based agent process receives the same value. Missing or invalid browser values resolve to the server time zone. Ephemeral agent paths use the same resolver and fall back directly because they do not have browser context.

Only the validated time-zone identifier is retained. The current date and time are never stored because a long-lived agent session can cross midnight; the tool calculates them fresh on every call.

## Agent Guidance

The workspace agent definition includes a short temporal accuracy rule whenever `get-current-datetime` is available:

1. For questions asking for today's/current date, weekday, or current time, call `get-current-datetime` before answering.
2. Never infer the current date or time from model knowledge or previous messages.
3. Preserve the date, time, and weekday returned by the tool.

The tool description and examples repeat the intended trigger in simple language so smaller models have a better chance of selecting it. This reduces but cannot completely eliminate missed tool calls on models with weak tool-use capability.

## Components

- `server/utils/agents/aibitat/plugins/current-datetime.js` owns time-zone validation, deterministic date/time formatting, and the AIbitat plugin definition.
- `server/utils/agents/aibitat/plugins/index.js` exports the plugin by symbol and slug.
- `server/utils/agents/defaults.js` enables the tool by default and adds the temporal accuracy rule.
- `frontend/src/models/workspace.js` and `frontend/src/models/workspaceThread.js` attach the browser time zone to web chat requests.
- `server/endpoints/chat.js`, `server/utils/chats/stream.js`, `server/utils/chats/agents.js`, `server/models/workspaceAgentInvocation.js`, and the agent handler carry the validated time zone into WebSocket agent execution.
- The Prisma schema and a focused migration add a nullable time-zone field to workspace agent invocations.

## Error Handling

- Missing or invalid browser time zones silently use the server time zone so chat remains available.
- If the runtime cannot resolve its configured time zone, the final fallback is `UTC`.
- Date/time formatting uses `Intl.DateTimeFormat(...).formatToParts()` rather than locale-dependent string parsing.
- The tool catches unexpected formatting errors and returns a clear tool failure message, allowing the agent to tell the user it could not determine the date instead of inventing one.

## Testing

Automated tests use an injected fixed `Date` value and verify:

- A Seoul browser at a UTC date boundary receives the correct next-day date, time, and weekday.
- A negative-offset browser receives the correct previous-day date, time, and weekday.
- Missing and invalid browser values fall back to the server time zone.
- The tool exposes no model parameters and returns the expected structured text.
- `get-current-datetime` is present in the default agent function list and the agent role requires its use for current-date, weekday, and current-time questions.
- Workspace and thread web requests send the browser time zone.
- A WebSocket workspace agent invocation persists and exposes its validated time zone to the tool.

Focused Jest suites will run first, followed by the related server and frontend test suites and lint checks available in the repository.

## Out of Scope

- Intercepting date questions and bypassing the model
- Adding current-date context to ordinary non-agent system prompts
- General date arithmetic, calendar lookup, holidays, or arbitrary city time-zone conversion
- Guaranteeing tool invocation for models that do not reliably support tool calling
