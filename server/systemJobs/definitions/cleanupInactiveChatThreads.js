const path = require("path");

const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_SCHEDULE = "0 3 * * *";

function readRetentionDays(env) {
  const configured = env.INACTIVE_CHAT_RETENTION_DAYS;
  if (configured === undefined) return DEFAULT_RETENTION_DAYS;

  const parsed = Number(configured);
  if (Number.isFinite(parsed) && Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }

  console.warn(
    `Invalid INACTIVE_CHAT_RETENTION_DAYS value ${JSON.stringify(
      configured
    )}; using the default of ${DEFAULT_RETENTION_DAYS} days.`
  );
  return DEFAULT_RETENTION_DAYS;
}

function buildCleanupInactiveChatThreadsDefinition(env = process.env) {
  const retentionDays = readRetentionDays(env);

  return Object.freeze({
    key: "cleanup-inactive-chat-threads",
    name: "Cleanup inactive chat threads",
    description: `Permanently deletes chat threads inactive for at least ${retentionDays} days.`,
    schedule: env.CLEANUP_INACTIVE_CHAT_THREADS_CRON || DEFAULT_SCHEDULE,
    timeoutMs: 10 * 60 * 1000,
    enabledByDefault: true,
    handler: path.resolve(
      __dirname,
      "../handlers/cleanupInactiveChatThreads.js"
    ),
    options: Object.freeze({ retentionDays, batchSize: 100 }),
  });
}

module.exports = { buildCleanupInactiveChatThreadsDefinition };
