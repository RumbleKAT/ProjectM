const prisma = require("../utils/prisma");

const SystemJobConfig = {
  syncDefinitions: async function (definitions = []) {
    try {
      return await prisma.$transaction(async (tx) => {
        const configs = [];
        const jobKeys = [];

        for (const definition of definitions) {
          jobKeys.push(definition.key);
          configs.push(
            await tx.system_job_configs.upsert({
              where: { jobKey: definition.key },
              create: {
                jobKey: definition.key,
                enabled: definition.enabledByDefault === true,
              },
              update: {},
            })
          );
        }

        await tx.system_job_configs.updateMany({
          where: jobKeys.length > 0 ? { jobKey: { notIn: jobKeys } } : {},
          data: { enabled: false, nextRunAt: null },
        });

        return configs;
      });
    } catch (error) {
      console.error(
        "Failed to synchronize system job definitions:",
        error.message
      );
      throw error;
    }
  },

  get: async function (jobKey) {
    try {
      const config = await prisma.system_job_configs.findUnique({
        where: { jobKey: String(jobKey) },
      });
      return config || null;
    } catch (error) {
      console.error("Failed to get system job config:", error.message);
      return null;
    }
  },

  where: async function (
    clause = {},
    limit = null,
    orderBy = null,
    include = {}
  ) {
    try {
      return await prisma.system_job_configs.findMany({
        where: clause,
        ...(limit !== null ? { take: limit } : {}),
        ...(orderBy !== null
          ? { orderBy }
          : { orderBy: { createdAt: "desc" } }),
        ...(include && Object.keys(include).length > 0 ? { include } : {}),
      });
    } catch (error) {
      console.error("Failed to query system job configs:", error.message);
      return [];
    }
  },

  setEnabled: async function (jobKey, enabled) {
    try {
      return await prisma.system_job_configs.update({
        where: { jobKey: String(jobKey) },
        data: { enabled: Boolean(enabled) },
      });
    } catch (error) {
      console.error("Failed to update system job enablement:", error.message);
      return null;
    }
  },

  updateRunTimestamps: async function (jobKey, { lastRunAt, nextRunAt } = {}) {
    try {
      const data = {};
      if (lastRunAt !== undefined) data.lastRunAt = lastRunAt;
      if (nextRunAt !== undefined) data.nextRunAt = nextRunAt;
      if (Object.keys(data).length === 0) return await this.get(jobKey);

      return await prisma.system_job_configs.update({
        where: { jobKey: String(jobKey) },
        data,
      });
    } catch (error) {
      console.error(
        "Failed to update system job run timestamps:",
        error.message
      );
      return null;
    }
  },
};

module.exports = { SystemJobConfig };
