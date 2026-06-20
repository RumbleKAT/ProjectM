const { log, conclude } = require("./helpers/index.js");
const { SystemJobConfig } = require("../models/systemJobConfig");
const { SystemJobRun } = require("../models/systemJobRun");
const cleanupInactiveChatThreads = require("../systemJobs/handlers/cleanupInactiveChatThreads");

(async () => {
  const jobKey = "cleanup-inactive-chat-threads";
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
    const result = await cleanupInactiveChatThreads({
      options: {
        retentionDays: Number(process.env.INACTIVE_CHAT_RETENTION_DAYS) || 30,
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
