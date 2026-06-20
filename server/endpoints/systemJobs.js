const { SystemJobConfig } = require("../models/systemJobConfig");
const { SystemJobRun } = require("../models/systemJobRun");
const { validatedRequest } = require("../utils/middleware/validatedRequest");
const { flexUserRoleValid } = require("../utils/middleware/multiUserProtected");
const { ROLES } = require("../utils/middleware/multiUserProtected");
const registry = require("../systemJobs/registry");
const {
  buildCleanupInactiveChatThreadsDefinition,
} = require("../systemJobs/definitions/cleanupInactiveChatThreads");
const { BackgroundService } = require("../utils/BackgroundWorkers");
const prisma = require("../utils/prisma");

const backgroundService = new BackgroundService();

function systemJobsEndpoints(app) {
  if (!app) return;

  const systemJobRegistry = registry.createRegistry([
    buildCleanupInactiveChatThreadsDefinition(),
  ]);

  // GET /system-jobs
  app.get(
    "/system-jobs",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (_request, response) => {
      try {
        const jobs = [];
        for (const definition of systemJobRegistry.all()) {
          const config = await SystemJobConfig.get(definition.key);
          const latestRuns = await SystemJobRun.where(
            { systemJobConfigId: config?.id },
            1,
            { queuedAt: "desc" }
          );
          const latestRun = latestRuns[0] || null;
          jobs.push({
            key: definition.key,
            name: definition.name,
            description: definition.description,
            schedule: definition.schedule,
            enabled: config ? config.enabled : false,
            lastRunAt: config?.lastRunAt,
            nextRunAt: config?.nextRunAt,
            latestRun,
          });
        }
        return response.status(200).json({ jobs });
      } catch (e) {
        console.error(e.message, e);
        response.sendStatus(500);
      }
    }
  );

  // POST /system-jobs/:key/toggle
  app.post(
    "/system-jobs/:key/toggle",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const { key } = request.params;
        const definition = systemJobRegistry.get(key);
        if (!definition) return response.sendStatus(404);

        const config = await SystemJobConfig.get(key);
        if (!config) return response.sendStatus(404);

        const updated = await SystemJobConfig.setEnabled(key, !config.enabled);
        await backgroundService.syncSystemJob(key);

        return response
          .status(200)
          .json({ success: true, enabled: updated.enabled });
      } catch (e) {
        console.error(e.message, e);
        response.sendStatus(500);
      }
    }
  );

  // POST /system-jobs/:key/trigger
  app.post(
    "/system-jobs/:key/trigger",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const { key } = request.params;
        const definition = systemJobRegistry.get(key);
        if (!definition) return response.sendStatus(404);

        const config = await SystemJobConfig.get(key);
        if (!config) return response.sendStatus(404);
        if (!config.enabled) {
          return response.status(409).json({ error: "System job is disabled" });
        }

        const run = await backgroundService.triggerSystemJob(key);
        if (!run) {
          return response.status(200).json({ success: true, skipped: true });
        }

        return response.status(200).json({ success: true, run });
      } catch (e) {
        console.error(e.message, e);
        response.sendStatus(500);
      }
    }
  );

  // GET /system-jobs/:key/runs
  app.get(
    "/system-jobs/:key/runs",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const { key } = request.params;
        const config = await SystemJobConfig.get(key);
        if (!config) return response.sendStatus(404);

        const runs = await SystemJobRun.where(
          { systemJobConfigId: config.id },
          50,
          { queuedAt: "desc" }
        );
        return response.status(200).json({ runs });
      } catch (e) {
        console.error(e.message, e);
        response.sendStatus(500);
      }
    }
  );

  // GET /system-jobs/runs/:runId
  app.get(
    "/system-jobs/runs/:runId",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const { runId } = request.params;
        const run = await SystemJobRun.get({ id: Number(runId) });
        if (!run) return response.sendStatus(404);

        const config = await prisma.system_job_configs.findUnique({
          where: { id: run.systemJobConfigId },
        });

        return response.status(200).json({ run, config });
      } catch (e) {
        console.error(e.message, e);
        response.sendStatus(500);
      }
    }
  );
}

module.exports = { systemJobsEndpoints };
