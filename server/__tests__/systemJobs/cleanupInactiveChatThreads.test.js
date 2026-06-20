jest.mock("../../utils/prisma", () => ({
  $queryRaw: jest.fn(),
  $transaction: jest.fn(),
}));

const prisma = require("../../utils/prisma");
const cleanupInactiveChatThreads = require("../../systemJobs/handlers/cleanupInactiveChatThreads");
const { createDefaultRegistry } = require("../../systemJobs/registry");

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-06-20T12:00:00.000Z");

function oldChat(daysAgo = 31) {
  return new Date(NOW.getTime() - daysAgo * DAY_MS);
}

function createTransactionClient() {
  return {
    workspace_chats: {
      aggregate: jest.fn().mockResolvedValue({
        _max: { createdAt: oldChat() },
      }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    workspace_agent_invocations: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    workspace_threads: {
      delete: jest.fn().mockResolvedValue({ id: 1 }),
    },
  };
}

function rawQuery(callNumber = 1) {
  const [strings, ...values] = prisma.$queryRaw.mock.calls[callNumber - 1];
  return { sql: strings.join("?"), values };
}

describe("cleanupInactiveChatThreads", () => {
  let tx;
  let log;

  beforeEach(() => {
    jest.clearAllMocks();
    tx = createTransactionClient();
    log = jest.fn();
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.$transaction.mockImplementation(async (callback) => callback(tx));
  });

  test("is a direct CommonJS callable and makes the default registry loadable", () => {
    expect(cleanupInactiveChatThreads).toEqual(expect.any(Function));
    expect(() => createDefaultRegistry()).not.toThrow();
    expect(
      createDefaultRegistry().get("cleanup-inactive-chat-threads").handler
    ).toContain("cleanupInactiveChatThreads.js");
  });

  test.each([
    [undefined, 30, 100],
    [{ retentionDays: 0, batchSize: Number.NaN }, 30, 100],
    [{ retentionDays: 1.5, batchSize: -4 }, 30, 100],
    [{ retentionDays: "45", batchSize: "20" }, 30, 100],
    [{ retentionDays: 45, batchSize: 20 }, 45, 20],
  ])(
    "defensively normalizes options %# and computes a deterministic cutoff",
    async (options, retentionDays, batchSize) => {
      const result = await cleanupInactiveChatThreads({
        options,
        log,
        now: NOW,
      });

      expect(result.retentionDays).toBe(retentionDays);
      expect(result.cutoff).toBe(
        new Date(NOW.getTime() - retentionDays * DAY_MS).toISOString()
      );
      const query = rawQuery();
      expect(query.values).toEqual([
        0,
        new Date(NOW.getTime() - retentionDays * DAY_MS),
        batchSize,
      ]);
    }
  );

  test("queries eligible candidates with a strict chat-created cutoff and stable cursor page", async () => {
    prisma.$queryRaw.mockResolvedValue([{ id: 12 }]);

    await cleanupInactiveChatThreads({
      options: { retentionDays: 30, batchSize: 25 },
      log,
      now: NOW,
    });

    const { sql, values } = rawQuery();
    expect(sql).toMatch(/FROM\s+workspace_threads/i);
    expect(sql).toMatch(
      /(?:INNER\s+)?JOIN\s+workspace_chats[\s\S]+thread_id[\s\S]+id/i
    );
    expect(sql).toMatch(/WHERE[\s\S]+id\s*>\s*\?/i);
    expect(sql).toMatch(/GROUP\s+BY[\s\S]+id/i);
    expect(sql).toMatch(/HAVING\s+MAX\([^)]*createdAt[^)]*\)\s*<\s*\?/i);
    expect(sql).toMatch(/ORDER\s+BY[\s\S]+id\s+ASC/i);
    expect(sql).toMatch(/LIMIT\s+\?/i);
    expect(sql).not.toMatch(/\binclude\b|\bhidden\b|lastUpdatedAt/i);
    expect(values).toEqual([0, new Date("2026-05-21T12:00:00.000Z"), 25]);
  });

  test("rechecks and deletes an old candidate in dependent-before-parent order", async () => {
    prisma.$queryRaw.mockResolvedValue([{ id: 41 }]);
    tx.workspace_chats.deleteMany.mockResolvedValue({ count: 4 });

    const result = await cleanupInactiveChatThreads({
      options: { retentionDays: 30, batchSize: 100 },
      log,
      now: NOW,
    });

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 5_000,
      timeout: 30_000,
    });
    expect(tx.workspace_chats.aggregate).toHaveBeenCalledWith({
      where: { thread_id: 41 },
      _max: { createdAt: true },
    });
    expect(tx.workspace_agent_invocations.deleteMany).toHaveBeenCalledWith({
      where: { thread_id: 41 },
    });
    expect(tx.workspace_chats.deleteMany).toHaveBeenCalledWith({
      where: { thread_id: 41 },
    });
    expect(tx.workspace_threads.delete).toHaveBeenCalledWith({
      where: { id: 41 },
    });

    const aggregateOrder =
      tx.workspace_chats.aggregate.mock.invocationCallOrder[0];
    const invocationOrder =
      tx.workspace_agent_invocations.deleteMany.mock.invocationCallOrder[0];
    const chatOrder = tx.workspace_chats.deleteMany.mock.invocationCallOrder[0];
    const threadOrder = tx.workspace_threads.delete.mock.invocationCallOrder[0];
    expect(aggregateOrder).toBeLessThan(invocationOrder);
    expect(invocationOrder).toBeLessThan(chatOrder);
    expect(chatOrder).toBeLessThan(threadOrder);
    expect(result).toEqual({
      retentionDays: 30,
      cutoff: "2026-05-21T12:00:00.000Z",
      candidateCount: 1,
      deletedThreads: 1,
      deletedChats: 4,
      skippedAfterRecheck: 0,
      failedCount: 0,
    });
  });

  test.each([
    ["no remaining messages", null],
    ["a message exactly on the boundary", new Date("2026-05-21T12:00:00.000Z")],
    ["a newer message", new Date("2026-05-22T12:00:00.000Z")],
  ])(
    "skips a candidate after recheck when it has %s",
    async (_label, newest) => {
      prisma.$queryRaw.mockResolvedValue([{ id: 9 }]);
      tx.workspace_chats.aggregate.mockResolvedValue({
        _max: { createdAt: newest },
      });

      const result = await cleanupInactiveChatThreads({ log, now: NOW });

      expect(result.skippedAfterRecheck).toBe(1);
      expect(result.deletedThreads).toBe(0);
      expect(tx.workspace_agent_invocations.deleteMany).not.toHaveBeenCalled();
      expect(tx.workspace_chats.deleteMany).not.toHaveBeenCalled();
      expect(tx.workspace_threads.delete).not.toHaveBeenCalled();
    }
  );

  test("processes more than one stable ID batch without loading all candidates", async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([{ id: 2 }, { id: 5 }])
      .mockResolvedValueOnce([{ id: 8 }, { id: 13 }])
      .mockResolvedValueOnce([{ id: 21 }]);
    tx.workspace_chats.deleteMany
      .mockResolvedValueOnce({ count: 2 })
      .mockResolvedValueOnce({ count: 3 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 4 })
      .mockResolvedValueOnce({ count: 5 });

    const result = await cleanupInactiveChatThreads({
      options: { retentionDays: 30, batchSize: 2 },
      log,
      now: NOW,
    });

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);
    expect(rawQuery(1).values[0]).toBe(0);
    expect(rawQuery(2).values[0]).toBe(5);
    expect(rawQuery(3).values[0]).toBe(13);
    expect(result).toMatchObject({
      candidateCount: 5,
      deletedThreads: 5,
      deletedChats: 15,
      skippedAfterRecheck: 0,
      failedCount: 0,
    });
  });

  test("advances the cursor across skips and failures, then throws the collected failures", async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([{ id: 10 }, { id: 20 }])
      .mockResolvedValueOnce([{ id: 30 }]);
    tx.workspace_chats.aggregate.mockImplementation(({ where }) => {
      if (where.thread_id === 10)
        return Promise.resolve({ _max: { createdAt: null } });
      return Promise.resolve({ _max: { createdAt: oldChat() } });
    });
    prisma.$transaction.mockImplementation(async (callback) => {
      const result = await callback(tx);
      if (tx.workspace_threads.delete.mock.lastCall?.[0]?.where.id === 20)
        throw new Error("thread 20 failed");
      return result;
    });

    let thrown;
    try {
      await cleanupInactiveChatThreads({
        options: { retentionDays: 30, batchSize: 2 },
        log,
        now: NOW,
      });
    } catch (error) {
      thrown = error;
    }

    expect(rawQuery(2).values[0]).toBe(20);
    expect(thrown).toBeInstanceOf(AggregateError);
    expect(thrown.errors).toHaveLength(1);
    expect(thrown.errors[0].message).toBe("thread 20 failed");
    expect(thrown.result).toEqual({
      retentionDays: 30,
      cutoff: "2026-05-21T12:00:00.000Z",
      candidateCount: 3,
      deletedThreads: 1,
      deletedChats: 1,
      skippedAfterRecheck: 1,
      failedCount: 1,
    });
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("20"),
      expect.objectContaining({ error: "thread 20 failed" })
    );
    expect(log).toHaveBeenLastCalledWith(
      expect.stringContaining("finished"),
      thrown.result
    );
  });

  test("returns and logs an exact empty summary when no candidates exist", async () => {
    const result = await cleanupInactiveChatThreads({ log, now: NOW });

    expect(result).toEqual({
      retentionDays: 30,
      cutoff: "2026-05-21T12:00:00.000Z",
      candidateCount: 0,
      deletedThreads: 0,
      deletedChats: 0,
      skippedAfterRecheck: 0,
      failedCount: 0,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(log).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("started"),
      expect.objectContaining({ retentionDays: 30 })
    );
    expect(log).toHaveBeenLastCalledWith(
      expect.stringContaining("finished"),
      result
    );
    expect(() => JSON.stringify(result)).not.toThrow();
  });
});
