const { log, conclude } = require("./helpers/index.js");
const { SystemJobConfig } = require("../models/systemJobConfig");
const { SystemJobRun } = require("../models/systemJobRun");
const { SystemSettings } = require("../models/systemSettings");
const cleanupInactiveWorkspaces = require("../systemJobs/handlers/cleanupInactiveWorkspaces");

(async () => {
  const jobKey = "cleanup-inactive-workspaces";
  const config = await SystemJobConfig.get(jobKey);
  if (!config) {
    log("Job config not found - exiting.");
    return conclude();
  }

  let runId = process.env.SYSTEM_JOB_RUN_ID
    ? Number(process.env.SYSTEM_JOB_RUN_ID)
    : null;
  let _trigger = process.env.SYSTEM_JOB_TRIGGER || "scheduled";

  if (!runId) {
    // This is a scheduled run triggered by Bree's internal cron timer
    if (!config.enabled) {
      log("Job is disabled in database - exiting.");
      return conclude();
    }
    const run = await SystemJobRun.claim(config.id, "scheduled");
    if (!run) {
      log("Another run is already in flight - exiting.");
      return conclude();
    }
    runId = run.id;
    _trigger = "scheduled";
  }

  // Mark running
  await SystemJobRun.markRunning(runId);

  const logsBuffer = [];
  const jobLog = (msg) => {
    log(msg);
    logsBuffer.push(msg);
  };

  try {
    const retentionSetting = await SystemSettings.get({
      label: "inactive_workspace_retention_days",
    });
    const retentionDays = retentionSetting
      ? Number(retentionSetting.value)
      : Number(process.env.INACTIVE_WORKSPACE_RETENTION_DAYS) || 30;

    const result = await cleanupInactiveWorkspaces({
      options: {
        retentionDays,
        batchSize: 100,
      },
      log: jobLog,
    });

    await SystemJobRun.complete(runId, {
      result,
      logs: logsBuffer.join("\n"),
    });
  } catch (error) {
    console.error(error);
    await SystemJobRun.fail(runId, {
      error: error.message,
      result: error.result || null,
      logs: logsBuffer.join("\n"),
    });
  } finally {
    conclude();
  }
})();
