const path = require("path");

const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_SCHEDULE = "0 4 * * *";

function readRetentionDays(env) {
  const configured = env.INACTIVE_WORKSPACE_RETENTION_DAYS;
  if (configured === undefined) return DEFAULT_RETENTION_DAYS;

  const parsed = Number(configured);
  if (Number.isFinite(parsed) && Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }

  console.warn(
    `Invalid INACTIVE_WORKSPACE_RETENTION_DAYS value ${JSON.stringify(
      configured
    )}; using the default of ${DEFAULT_RETENTION_DAYS} days.`
  );
  return DEFAULT_RETENTION_DAYS;
}

function buildCleanupInactiveWorkspacesDefinition(env = process.env) {
  const retentionDays = readRetentionDays(env);

  return Object.freeze({
    key: "cleanup-inactive-workspaces",
    name: "Cleanup inactive workspaces",
    description: `Permanently deletes workspaces inactive for at least ${retentionDays} days.`,
    schedule: env.CLEANUP_INACTIVE_WORKSPACES_CRON || DEFAULT_SCHEDULE,
    timeoutMs: 15 * 60 * 1000,
    enabledByDefault: false,
    handler: path.resolve(
      __dirname,
      "../handlers/cleanupInactiveWorkspaces.js"
    ),
    options: Object.freeze({ retentionDays, batchSize: 100 }),
  });
}

module.exports = { buildCleanupInactiveWorkspacesDefinition };
