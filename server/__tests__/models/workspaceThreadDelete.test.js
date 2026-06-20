jest.mock("../../utils/prisma", () => ({
  workspace_threads: {
    findMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  workspace_agent_invocations: {
    deleteMany: jest.fn(),
  },
  workspace_chats: {
    deleteMany: jest.fn(),
  },
  workspace_parsed_files: {
    deleteMany: jest.fn(),
  },
  $transaction: jest.fn(),
}));

const prisma = require("../../utils/prisma");
const { WorkspaceThread } = require("../../models/workspaceThread");

const transactionClient = {
  workspace_threads: {
    findMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  workspace_agent_invocations: {
    deleteMany: jest.fn(),
  },
  workspace_chats: {
    deleteMany: jest.fn(),
  },
  workspace_parsed_files: {
    deleteMany: jest.fn(),
  },
};

describe("WorkspaceThread.delete", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (callback) =>
      callback(transactionClient)
    );
    transactionClient.workspace_threads.findMany.mockResolvedValue([]);
    transactionClient.workspace_agent_invocations.deleteMany.mockResolvedValue({
      count: 0,
    });
    transactionClient.workspace_chats.deleteMany.mockResolvedValue({
      count: 0,
    });
    transactionClient.workspace_threads.deleteMany.mockResolvedValue({
      count: 0,
    });
  });

  test.each([
    ["an omitted clause", () => WorkspaceThread.delete()],
    ["an empty clause", () => WorkspaceThread.delete({})],
  ])("rejects %s before starting a transaction", async (_label, remove) => {
    const consoleSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await expect(remove()).resolves.toBe(false);

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith(
      "WorkspaceThread.delete requires a non-empty clause"
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  test.each([
    ["one thread", [{ id: 41 }], [41]],
    ["multiple threads", [{ id: 41 }, { id: 73 }], [41, 73]],
  ])(
    "deletes dependent records in transaction order for %s",
    async (_label, matchedThreads, threadIds) => {
      const clause = {
        workspace_id: 8,
        slug: { in: ["first", "second"] },
      };
      transactionClient.workspace_threads.findMany.mockResolvedValue(
        matchedThreads
      );

      await expect(WorkspaceThread.delete(clause)).resolves.toBe(true);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        maxWait: 5_000,
        timeout: 30_000,
      });
      expect(transactionClient.workspace_threads.findMany).toHaveBeenCalledWith(
        {
          where: clause,
          select: { id: true },
        }
      );
      expect(
        transactionClient.workspace_agent_invocations.deleteMany
      ).toHaveBeenCalledWith({
        where: { thread_id: { in: threadIds } },
      });
      expect(transactionClient.workspace_chats.deleteMany).toHaveBeenCalledWith(
        {
          where: { thread_id: { in: threadIds } },
        }
      );
      expect(
        transactionClient.workspace_threads.deleteMany
      ).toHaveBeenCalledWith({
        where: { id: { in: threadIds } },
      });

      const lookupOrder =
        transactionClient.workspace_threads.findMany.mock
          .invocationCallOrder[0];
      const invocationOrder =
        transactionClient.workspace_agent_invocations.deleteMany.mock
          .invocationCallOrder[0];
      const chatOrder =
        transactionClient.workspace_chats.deleteMany.mock
          .invocationCallOrder[0];
      const threadOrder =
        transactionClient.workspace_threads.deleteMany.mock
          .invocationCallOrder[0];
      expect(lookupOrder).toBeLessThan(invocationOrder);
      expect(invocationOrder).toBeLessThan(chatOrder);
      expect(chatOrder).toBeLessThan(threadOrder);

      expect(prisma.workspace_threads.findMany).not.toHaveBeenCalled();
      expect(prisma.workspace_threads.deleteMany).not.toHaveBeenCalled();
      expect(
        prisma.workspace_agent_invocations.deleteMany
      ).not.toHaveBeenCalled();
      expect(prisma.workspace_chats.deleteMany).not.toHaveBeenCalled();
      expect(
        transactionClient.workspace_parsed_files.deleteMany
      ).not.toHaveBeenCalled();
      expect(prisma.workspace_parsed_files.deleteMany).not.toHaveBeenCalled();
    }
  );

  test("returns true without issuing deletes when no threads match", async () => {
    const clause = { id: { in: [999, 1000] } };

    await expect(WorkspaceThread.delete(clause)).resolves.toBe(true);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(transactionClient.workspace_threads.findMany).toHaveBeenCalledWith({
      where: clause,
      select: { id: true },
    });
    expect(
      transactionClient.workspace_agent_invocations.deleteMany
    ).not.toHaveBeenCalled();
    expect(transactionClient.workspace_chats.deleteMany).not.toHaveBeenCalled();
    expect(
      transactionClient.workspace_threads.deleteMany
    ).not.toHaveBeenCalled();
  });

  test("chunks large bulk deletes while preserving global table order", async () => {
    const matchedThreads = Array.from({ length: 805 }, (_, index) => ({
      id: index + 1,
    }));
    transactionClient.workspace_threads.findMany.mockResolvedValue(
      matchedThreads
    );

    await expect(WorkspaceThread.delete({ workspace_id: 8 })).resolves.toBe(
      true
    );

    const expectedChunks = [
      matchedThreads.slice(0, 400).map(({ id }) => id),
      matchedThreads.slice(400, 800).map(({ id }) => id),
      matchedThreads.slice(800).map(({ id }) => id),
    ];
    for (const [index, ids] of expectedChunks.entries()) {
      expect(
        transactionClient.workspace_agent_invocations.deleteMany
      ).toHaveBeenNthCalledWith(index + 1, {
        where: { thread_id: { in: ids } },
      });
      expect(
        transactionClient.workspace_chats.deleteMany
      ).toHaveBeenNthCalledWith(index + 1, {
        where: { thread_id: { in: ids } },
      });
      expect(
        transactionClient.workspace_threads.deleteMany
      ).toHaveBeenNthCalledWith(index + 1, {
        where: { id: { in: ids } },
      });
    }

    const invocationOrders =
      transactionClient.workspace_agent_invocations.deleteMany.mock
        .invocationCallOrder;
    const chatOrders =
      transactionClient.workspace_chats.deleteMany.mock.invocationCallOrder;
    const threadOrders =
      transactionClient.workspace_threads.deleteMany.mock.invocationCallOrder;
    expect(Math.max(...invocationOrders)).toBeLessThan(Math.min(...chatOrders));
    expect(Math.max(...chatOrders)).toBeLessThan(Math.min(...threadOrders));
  });

  test.each([
    ["lookup", transactionClient.workspace_threads.findMany],
    [
      "invocation deletion",
      transactionClient.workspace_agent_invocations.deleteMany,
    ],
    ["chat deletion", transactionClient.workspace_chats.deleteMany],
    ["thread deletion", transactionClient.workspace_threads.deleteMany],
  ])("returns false and logs once when %s fails", async (_label, operation) => {
    const consoleSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});
    transactionClient.workspace_threads.findMany.mockResolvedValue([
      { id: 41 },
    ]);
    operation.mockRejectedValue(new Error("database failure"));

    await expect(WorkspaceThread.delete({ id: 41 })).resolves.toBe(false);

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith("database failure");
    consoleSpy.mockRestore();
  });

  test("returns false and logs once when starting the transaction fails", async () => {
    const consoleSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});
    prisma.$transaction.mockRejectedValue(new Error("transaction unavailable"));

    await expect(WorkspaceThread.delete({ id: 41 })).resolves.toBe(false);

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith("transaction unavailable");
    expect(transactionClient.workspace_threads.findMany).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
