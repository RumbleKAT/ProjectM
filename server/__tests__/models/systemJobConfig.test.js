jest.mock("../../utils/prisma", () => ({
  system_job_configs: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  $transaction: jest.fn(),
}));

const prisma = require("../../utils/prisma");
const { SystemJobConfig } = require("../../models/systemJobConfig");

const transactionClient = {
  system_job_configs: {
    upsert: jest.fn(),
    updateMany: jest.fn(),
  },
};

describe("SystemJobConfig", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (callback) =>
      callback(transactionClient)
    );
  });

  describe("syncDefinitions", () => {
    test("creates disabled-by-default configs without overwriting stored enablement", async () => {
      const storedConfig = {
        id: 1,
        jobKey: "cleanup-inactive-chat-threads",
        enabled: true,
      };
      transactionClient.system_job_configs.upsert.mockResolvedValue(
        storedConfig
      );
      transactionClient.system_job_configs.updateMany.mockResolvedValue({
        count: 0,
      });

      await expect(
        SystemJobConfig.syncDefinitions([
          {
            key: "cleanup-inactive-chat-threads",
            enabledByDefault: false,
          },
        ])
      ).resolves.toEqual([storedConfig]);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(transactionClient.system_job_configs.upsert).toHaveBeenCalledWith({
        where: { jobKey: "cleanup-inactive-chat-threads" },
        create: {
          jobKey: "cleanup-inactive-chat-threads",
          enabled: false,
        },
        update: {},
      });
      expect(
        transactionClient.system_job_configs.updateMany
      ).toHaveBeenCalledWith({
        where: {
          jobKey: { notIn: ["cleanup-inactive-chat-threads"] },
        },
        data: { enabled: false, nextRunAt: null },
      });
      expect(prisma.system_job_configs.upsert).not.toHaveBeenCalled();
    });

    test("enables only newly created definitions explicitly enabled by default", async () => {
      transactionClient.system_job_configs.upsert.mockResolvedValue({ id: 2 });
      transactionClient.system_job_configs.updateMany.mockResolvedValue({
        count: 0,
      });

      await SystemJobConfig.syncDefinitions([
        { key: "enabled-job", enabledByDefault: true },
      ]);

      expect(transactionClient.system_job_configs.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: { jobKey: "enabled-job", enabled: true },
          update: {},
        })
      );
    });

    test("disables all configs when the definition list is empty", async () => {
      transactionClient.system_job_configs.updateMany.mockResolvedValue({
        count: 3,
      });

      await expect(SystemJobConfig.syncDefinitions([])).resolves.toEqual([]);

      expect(
        transactionClient.system_job_configs.upsert
      ).not.toHaveBeenCalled();
      expect(
        transactionClient.system_job_configs.updateMany
      ).toHaveBeenCalledWith({
        where: {},
        data: { enabled: false, nextRunAt: null },
      });
    });

    test("rejects when synchronization fails so partial state cannot be accepted", async () => {
      const syncError = new Error("database is locked");
      const consoleSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});
      transactionClient.system_job_configs.upsert.mockRejectedValue(syncError);

      await expect(
        SystemJobConfig.syncDefinitions([{ key: "cleanup" }])
      ).rejects.toBe(syncError);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(
        transactionClient.system_job_configs.updateMany
      ).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        "Failed to synchronize system job definitions:",
        "database is locked"
      );
      consoleSpy.mockRestore();
    });
  });

  test("setEnabled persists a normalized boolean", async () => {
    const updated = { jobKey: "cleanup", enabled: true };
    prisma.system_job_configs.update.mockResolvedValue(updated);

    await expect(SystemJobConfig.setEnabled("cleanup", 1)).resolves.toEqual(
      updated
    );
    expect(prisma.system_job_configs.update).toHaveBeenCalledWith({
      where: { jobKey: "cleanup" },
      data: { enabled: true },
    });
  });

  test("updateRunTimestamps updates only supplied timestamps", async () => {
    const lastRunAt = new Date("2026-06-20T01:00:00.000Z");
    const updated = { jobKey: "cleanup", lastRunAt, nextRunAt: null };
    prisma.system_job_configs.update.mockResolvedValue(updated);

    await expect(
      SystemJobConfig.updateRunTimestamps("cleanup", { lastRunAt })
    ).resolves.toEqual(updated);
    expect(prisma.system_job_configs.update).toHaveBeenCalledWith({
      where: { jobKey: "cleanup" },
      data: { lastRunAt },
    });
  });

  test("get and where use the expected query shapes", async () => {
    const config = { id: 7, jobKey: "cleanup" };
    prisma.system_job_configs.findUnique.mockResolvedValue(config);
    prisma.system_job_configs.findMany.mockResolvedValue([config]);

    await expect(SystemJobConfig.get("cleanup")).resolves.toEqual(config);
    await expect(
      SystemJobConfig.where(
        { enabled: true },
        5,
        { nextRunAt: "asc" },
        { runs: true }
      )
    ).resolves.toEqual([config]);

    expect(prisma.system_job_configs.findUnique).toHaveBeenCalledWith({
      where: { jobKey: "cleanup" },
    });
    expect(prisma.system_job_configs.findMany).toHaveBeenCalledWith({
      where: { enabled: true },
      take: 5,
      orderBy: { nextRunAt: "asc" },
      include: { runs: true },
    });
  });
});
