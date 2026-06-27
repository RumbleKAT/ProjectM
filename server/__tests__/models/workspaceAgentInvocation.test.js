process.env.NODE_ENV = "test";

jest.mock("../../utils/prisma", () => ({
  workspace_agent_invocations: {
    create: jest.fn(),
  },
}));

const prisma = require("../../utils/prisma");
const {
  WorkspaceAgentInvocation,
} = require("../../models/workspaceAgentInvocation");

describe("WorkspaceAgentInvocation.new", () => {
  test("persists the validated browser time zone", async () => {
    prisma.workspace_agent_invocations.create.mockResolvedValue({ id: 1 });

    await WorkspaceAgentInvocation.new({
      prompt: "@agent 오늘 날짜는?",
      workspace: { id: 7 },
      timeZone: "Asia/Seoul",
    });

    expect(prisma.workspace_agent_invocations.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ timezone: "Asia/Seoul" }),
    });
  });
});
