const prisma = require("../utils/prisma");

function serializeResult(result) {
  if (result === undefined) return null;
  return JSON.stringify(result) ?? null;
}

function optionalPayload(payload = {}) {
  const data = {};
  if (Object.prototype.hasOwnProperty.call(payload, "result"))
    data.result = serializeResult(payload.result);
  if (Object.prototype.hasOwnProperty.call(payload, "logs"))
    data.logs = payload.logs == null ? null : String(payload.logs);
  return data;
}

const SystemJobRun = {
  statuses: {
    queued: "queued",
    running: "running",
    completed: "completed",
    failed: "failed",
    timed_out: "timed_out",
  },

  nonTerminalStatuses: ["queued", "running"],

  /**
   * Atomically claim a queued run. The migration-enforced partial unique index
   * `system_job_runs_one_in_flight_per_config` arbitrates concurrent inserts.
   * A null result means an in-flight run already exists (or the trigger is
   * invalid); other database failures reject.
   */
  claim: async function (systemJobConfigId, trigger) {
    if (!["scheduled", "manual"].includes(trigger)) {
      console.error(
        "Failed to claim system job run:",
        `Invalid system job trigger: ${trigger}`
      );
      return null;
    }

    try {
      return await prisma.system_job_runs.create({
        data: {
          systemJobConfigId: Number(systemJobConfigId),
          trigger,
          status: this.statuses.queued,
        },
      });
    } catch (error) {
      if (error?.code === "P2002") return null;
      console.error("Failed to claim system job run:", error.message);
      throw error;
    }
  },

  markRunning: async function (id) {
    try {
      const result = await prisma.system_job_runs.updateMany({
        where: { id: Number(id), status: this.statuses.queued },
        data: {
          status: this.statuses.running,
          startedAt: new Date(),
        },
      });
      return result.count > 0;
    } catch (error) {
      console.error("Failed to start system job run:", error.message);
      return false;
    }
  },

  complete: async function (id, { result, logs } = {}) {
    try {
      const update = await prisma.system_job_runs.updateMany({
        where: {
          id: Number(id),
          status: { in: this.nonTerminalStatuses },
        },
        data: {
          status: this.statuses.completed,
          result: serializeResult(result),
          ...(logs !== undefined
            ? { logs: logs == null ? null : String(logs) }
            : {}),
          completedAt: new Date(),
        },
      });
      if (update.count === 0) return null;
      return await this.get({ id: Number(id) });
    } catch (error) {
      console.error("Failed to complete system job run:", error.message);
      return null;
    }
  },

  fail: async function (id, { error: errorMessage, ...payload } = {}) {
    try {
      const update = await prisma.system_job_runs.updateMany({
        where: {
          id: Number(id),
          status: { in: this.nonTerminalStatuses },
        },
        data: {
          status: this.statuses.failed,
          error: String(errorMessage || "Unknown error"),
          ...optionalPayload(payload),
          completedAt: new Date(),
        },
      });
      if (update.count === 0) return null;
      return await this.get({ id: Number(id) });
    } catch (error) {
      console.error("Failed to fail system job run:", error.message);
      return null;
    }
  },

  failIfNotTerminal: async function (id, errorMessage, payload = {}) {
    try {
      const update = await prisma.system_job_runs.updateMany({
        where: {
          id: Number(id),
          status: { in: this.nonTerminalStatuses },
        },
        data: {
          status: this.statuses.failed,
          error: String(errorMessage || "Worker exited unexpectedly"),
          ...optionalPayload(payload),
          completedAt: new Date(),
        },
      });
      if (update.count === 0) return null;
      return await this.get({ id: Number(id) });
    } catch (error) {
      console.error(
        "Failed to conditionally fail system job run:",
        error.message
      );
      return null;
    }
  },

  timeout: async function (id, logs) {
    try {
      const update = await prisma.system_job_runs.updateMany({
        where: {
          id: Number(id),
          status: { in: this.nonTerminalStatuses },
        },
        data: {
          status: this.statuses.timed_out,
          error: "Job execution timed out",
          ...(logs !== undefined
            ? { logs: logs == null ? null : String(logs) }
            : {}),
          completedAt: new Date(),
        },
      });
      if (update.count === 0) return null;
      return await this.get({ id: Number(id) });
    } catch (error) {
      console.error("Failed to time out system job run:", error.message);
      return null;
    }
  },

  appendLogs: async function (id, logs) {
    try {
      return await prisma.system_job_runs.update({
        where: { id: Number(id) },
        data: { logs: logs == null ? "" : String(logs) },
      });
    } catch (error) {
      console.error("Failed to append system job run logs:", error.message);
      return null;
    }
  },

  get: async function (clause = {}, include = {}) {
    try {
      const run = await prisma.system_job_runs.findFirst({
        where: clause,
        ...(include && Object.keys(include).length > 0 ? { include } : {}),
      });
      return run || null;
    } catch (error) {
      console.error("Failed to get system job run:", error.message);
      return null;
    }
  },

  where: async function (
    clause = {},
    limit = null,
    orderBy = null,
    include = {},
    offset = 0
  ) {
    try {
      return await prisma.system_job_runs.findMany({
        where: clause,
        ...(limit !== null ? { take: limit } : {}),
        ...(orderBy !== null ? { orderBy } : { orderBy: { queuedAt: "desc" } }),
        ...(include && Object.keys(include).length > 0 ? { include } : {}),
        ...(offset !== null ? { skip: offset } : {}),
      });
    } catch (error) {
      console.error("Failed to query system job runs:", error.message);
      return [];
    }
  },

  failOrphanedRuns: async function () {
    try {
      const result = await prisma.system_job_runs.updateMany({
        where: { status: { in: this.nonTerminalStatuses } },
        data: {
          status: this.statuses.failed,
          error: "Server restarted during execution",
          completedAt: new Date(),
        },
      });
      return result.count;
    } catch (error) {
      console.error("Failed to fail orphaned system job runs:", error.message);
      return 0;
    }
  },
};

module.exports = { SystemJobRun };
