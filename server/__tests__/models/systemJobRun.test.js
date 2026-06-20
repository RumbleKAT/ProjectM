jest.mock("../../utils/prisma", () => ({
  system_job_runs: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  $transaction: jest.fn(),
}));

const prisma = require("../../utils/prisma");
const { SystemJobRun } = require("../../models/systemJobRun");

describe("SystemJobRun", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("claim", () => {
    test.each(["manual", "scheduled"])(
      "creates a queued %s run when none is in flight",
      async (trigger) => {
        const created = {
          id: 11,
          systemJobConfigId: 4,
          status: "queued",
          trigger,
        };
        prisma.system_job_runs.create.mockResolvedValue(created);

        await expect(SystemJobRun.claim("4", trigger)).resolves.toEqual(
          created
        );
        expect(prisma.system_job_runs.create).toHaveBeenCalledWith({
          data: {
            systemJobConfigId: 4,
            trigger,
            status: "queued",
          },
        });
        expect(prisma.$transaction).not.toHaveBeenCalled();
      }
    );

    test("returns null only for the expected in-flight unique conflict", async () => {
      const conflict = Object.assign(new Error("Unique constraint failed"), {
        code: "P2002",
      });
      const consoleSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});
      prisma.system_job_runs.create.mockRejectedValue(conflict);

      await expect(SystemJobRun.claim(1, "manual")).resolves.toBeNull();
      expect(prisma.system_job_runs.create).toHaveBeenCalledTimes(1);
      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    test("rejects an invalid trigger before opening a transaction", async () => {
      const consoleSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});

      await expect(SystemJobRun.claim(1, "api")).resolves.toBeNull();

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        "Failed to claim system job run:",
        "Invalid system job trigger: api"
      );
      consoleSpy.mockRestore();
    });

    test("propagates storage failures instead of reporting a duplicate", async () => {
      const storageError = Object.assign(new Error("database is locked"), {
        code: "P1008",
      });
      const consoleSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});
      prisma.system_job_runs.create.mockRejectedValue(storageError);

      await expect(SystemJobRun.claim(1, "manual")).rejects.toBe(storageError);

      expect(consoleSpy).toHaveBeenCalledWith(
        "Failed to claim system job run:",
        "database is locked"
      );
      consoleSpy.mockRestore();
    });
  });

  test("markRunning transitions only a queued row", async () => {
    prisma.system_job_runs.updateMany.mockResolvedValue({ count: 1 });

    await expect(SystemJobRun.markRunning("12")).resolves.toBe(true);

    expect(prisma.system_job_runs.updateMany).toHaveBeenCalledWith({
      where: { id: 12, status: "queued" },
      data: {
        status: "running",
        startedAt: expect.any(Date),
      },
    });
  });

  test("complete filters terminal rows and serializes non-string results", async () => {
    const completed = { id: 12, status: "completed" };
    prisma.system_job_runs.updateMany.mockResolvedValue({ count: 1 });
    prisma.system_job_runs.findFirst.mockResolvedValue(completed);

    await expect(
      SystemJobRun.complete(12, {
        result: { deleted: 3 },
        logs: "deleted three threads",
      })
    ).resolves.toEqual(completed);

    expect(prisma.system_job_runs.updateMany).toHaveBeenCalledWith({
      where: {
        id: 12,
        status: { in: ["queued", "running"] },
      },
      data: {
        status: "completed",
        result: JSON.stringify({ deleted: 3 }),
        logs: "deleted three threads",
        completedAt: expect.any(Date),
      },
    });
    expect(prisma.system_job_runs.findFirst).toHaveBeenCalledWith({
      where: { id: 12 },
    });
  });

  test.each([
    ["string", "finished", JSON.stringify("finished")],
    ["object", { deleted: 2 }, JSON.stringify({ deleted: 2 })],
    ["null", null, JSON.stringify(null)],
    ["undefined", undefined, null],
  ])("complete stores %s results as valid JSON", async (_, result, stored) => {
    prisma.system_job_runs.updateMany.mockResolvedValue({ count: 1 });
    prisma.system_job_runs.findFirst.mockResolvedValue({
      id: 12,
      status: "completed",
    });

    await SystemJobRun.complete(12, { result });

    expect(prisma.system_job_runs.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ result: stored }),
      })
    );
  });

  test("complete cannot overwrite an already-terminal row", async () => {
    prisma.system_job_runs.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      SystemJobRun.complete(12, { result: "late" })
    ).resolves.toBeNull();
    expect(prisma.system_job_runs.findFirst).not.toHaveBeenCalled();
  });

  test("fail filters terminal rows and persists optional payload", async () => {
    const failed = { id: 13, status: "failed" };
    prisma.system_job_runs.updateMany.mockResolvedValue({ count: 1 });
    prisma.system_job_runs.findFirst.mockResolvedValue(failed);

    await expect(
      SystemJobRun.fail(13, {
        error: "boom",
        result: ["partial"],
        logs: "stack",
      })
    ).resolves.toEqual(failed);

    expect(prisma.system_job_runs.updateMany).toHaveBeenCalledWith({
      where: {
        id: 13,
        status: { in: ["queued", "running"] },
      },
      data: {
        status: "failed",
        error: "boom",
        result: JSON.stringify(["partial"]),
        logs: "stack",
        completedAt: expect.any(Date),
      },
    });
  });

  test.each([
    ["string", "partial", JSON.stringify("partial")],
    ["object", { partial: true }, JSON.stringify({ partial: true })],
    ["null", null, JSON.stringify(null)],
    ["undefined", undefined, null],
  ])(
    "fail stores %s result payloads as valid JSON",
    async (_, result, stored) => {
      prisma.system_job_runs.updateMany.mockResolvedValue({ count: 1 });
      prisma.system_job_runs.findFirst.mockResolvedValue({
        id: 13,
        status: "failed",
      });

      await SystemJobRun.fail(13, { error: "boom", result });

      expect(prisma.system_job_runs.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ result: stored }),
        })
      );
    }
  );

  test("failIfNotTerminal uses the same guarded terminal transition", async () => {
    const failed = { id: 14, status: "failed" };
    prisma.system_job_runs.updateMany.mockResolvedValue({ count: 1 });
    prisma.system_job_runs.findFirst.mockResolvedValue(failed);

    await expect(
      SystemJobRun.failIfNotTerminal(14, "worker exited", {
        result: { partial: true },
        logs: "worker output",
      })
    ).resolves.toEqual(failed);

    expect(prisma.system_job_runs.updateMany).toHaveBeenCalledWith({
      where: {
        id: 14,
        status: { in: ["queued", "running"] },
      },
      data: {
        status: "failed",
        error: "worker exited",
        result: JSON.stringify({ partial: true }),
        logs: "worker output",
        completedAt: expect.any(Date),
      },
    });
  });

  test("timeout filters terminal rows and stores optional logs", async () => {
    const timedOut = { id: 15, status: "timed_out" };
    prisma.system_job_runs.updateMany.mockResolvedValue({ count: 1 });
    prisma.system_job_runs.findFirst.mockResolvedValue(timedOut);

    await expect(SystemJobRun.timeout(15, "last output")).resolves.toEqual(
      timedOut
    );

    expect(prisma.system_job_runs.updateMany).toHaveBeenCalledWith({
      where: {
        id: 15,
        status: { in: ["queued", "running"] },
      },
      data: {
        status: "timed_out",
        error: "Job execution timed out",
        logs: "last output",
        completedAt: expect.any(Date),
      },
    });
  });

  test("appendLogs stores the bounded text supplied by the scheduler", async () => {
    const updated = { id: 16, logs: "bounded output" };
    prisma.system_job_runs.update.mockResolvedValue(updated);

    await expect(
      SystemJobRun.appendLogs(16, "bounded output")
    ).resolves.toEqual(updated);
    expect(prisma.system_job_runs.update).toHaveBeenCalledWith({
      where: { id: 16 },
      data: { logs: "bounded output" },
    });
  });

  test("failOrphanedRuns fails queued and running rows after restart", async () => {
    prisma.system_job_runs.updateMany.mockResolvedValue({ count: 2 });

    await expect(SystemJobRun.failOrphanedRuns()).resolves.toBe(2);
    expect(prisma.system_job_runs.updateMany).toHaveBeenCalledWith({
      where: { status: { in: ["queued", "running"] } },
      data: {
        status: "failed",
        error: "Server restarted during execution",
        completedAt: expect.any(Date),
      },
    });
  });

  test("get and where use include, pagination, and ordering", async () => {
    const run = { id: 20 };
    prisma.system_job_runs.findFirst.mockResolvedValue(run);
    prisma.system_job_runs.findMany.mockResolvedValue([run]);

    await expect(
      SystemJobRun.get({ id: 20 }, { config: true })
    ).resolves.toEqual(run);
    await expect(
      SystemJobRun.where(
        { status: "failed" },
        25,
        { queuedAt: "desc" },
        { config: true },
        50
      )
    ).resolves.toEqual([run]);

    expect(prisma.system_job_runs.findFirst).toHaveBeenCalledWith({
      where: { id: 20 },
      include: { config: true },
    });
    expect(prisma.system_job_runs.findMany).toHaveBeenCalledWith({
      where: { status: "failed" },
      take: 25,
      orderBy: { queuedAt: "desc" },
      include: { config: true },
      skip: 50,
    });
  });
});
