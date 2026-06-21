jest.mock("../../utils/prisma", () => ({
  $queryRaw: jest.fn(),
  $transaction: jest.fn(),
  workspaces: {
    findMany: jest.fn(),
    delete: jest.fn(),
  },
  workspace_chats: {
    findFirst: jest.fn(),
  },
}));

jest.mock("../../models/workspace", () => ({
  Workspace: {
    delete: jest.fn(),
  },
}));

jest.mock("../../models/documents", () => ({
  Document: {
    delete: jest.fn(),
  },
}));

jest.mock("../../models/vectors", () => ({
  DocumentVectors: {
    deleteForWorkspace: jest.fn(),
  },
}));

jest.mock("../../models/workspaceChats", () => ({
  WorkspaceChats: {
    delete: jest.fn(),
  },
}));

jest.mock("../../utils/helpers", () => ({
  getVectorDbClass: jest.fn().mockReturnValue({
    "delete-namespace": jest.fn(),
  }),
}));

const prisma = require("../../utils/prisma");
const cleanupInactiveWorkspaces = require("../../systemJobs/handlers/cleanupInactiveWorkspaces");
const { Workspace } = require("../../models/workspace");
const { Document } = require("../../models/documents");
const { DocumentVectors } = require("../../models/vectors");
const { WorkspaceChats } = require("../../models/workspaceChats");

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-06-21T12:00:00.000Z");

describe("cleanupInactiveWorkspaces", () => {
  let log;

  beforeEach(() => {
    jest.clearAllMocks();
    log = jest.fn();
    prisma.workspaces.findMany.mockResolvedValue([]);
  });

  test("normalizes retention and ignores active workspaces", async () => {
    const activeWs = {
      id: 1,
      slug: "active-ws",
      createdAt: new Date(NOW.getTime() - 5 * DAY_MS),
      lastUpdatedAt: new Date(NOW.getTime() - 2 * DAY_MS),
    };
    const inactiveWs = {
      id: 2,
      slug: "inactive-ws",
      createdAt: new Date(NOW.getTime() - 35 * DAY_MS),
      lastUpdatedAt: new Date(NOW.getTime() - 35 * DAY_MS),
    };

    prisma.workspaces.findMany.mockResolvedValue([activeWs, inactiveWs]);
    prisma.workspace_chats.findFirst.mockResolvedValue(null);

    const result = await cleanupInactiveWorkspaces({
      options: { retentionDays: 30 },
      log,
      now: NOW,
    });

    expect(result.candidateCount).toBe(1);
    expect(result.deletedWorkspaces).toBe(1);

    expect(WorkspaceChats.delete).toHaveBeenCalledWith({ workspaceId: 2 });
    expect(DocumentVectors.deleteForWorkspace).toHaveBeenCalledWith(2);
    expect(Document.delete).toHaveBeenCalledWith({ workspaceId: 2 });
    expect(Workspace.delete).toHaveBeenCalledWith({ id: 2 });
  });
});
