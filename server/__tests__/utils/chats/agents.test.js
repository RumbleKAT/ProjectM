process.env.NODE_ENV = "test";

jest.mock("../../../models/workspaceAgentInvocation", () => ({
  WorkspaceAgentInvocation: {
    parseAgents: jest.fn(() => ["@agent"]),
    new: jest.fn(),
  },
}));
jest.mock("../../../models/workspace", () => ({
  Workspace: {
    supportsNativeToolCalling: jest.fn(),
  },
}));
jest.mock("../../../utils/helpers/chat/responses", () => ({
  writeResponseChunk: jest.fn(),
}));

const {
  WorkspaceAgentInvocation,
} = require("../../../models/workspaceAgentInvocation");
const { grepAgents } = require("../../../utils/chats/agents");

describe("grepAgents time zone", () => {
  const originalTimeZone = process.env.TZ;

  beforeEach(() => {
    jest.clearAllMocks();
    WorkspaceAgentInvocation.parseAgents.mockReturnValue(["@agent"]);
    WorkspaceAgentInvocation.new.mockResolvedValue({
      invocation: { uuid: "invocation-uuid" },
    });
  });

  afterEach(() => {
    if (originalTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimeZone;
  });

  test("passes a valid browser time zone to the durable invocation", async () => {
    await grepAgents({
      uuid: "response-uuid",
      response: {},
      message: "@agent 오늘 날짜는?",
      workspace: { id: 7, chatMode: "chat" },
      timeZone: "Asia/Seoul",
    });

    expect(WorkspaceAgentInvocation.new).toHaveBeenCalledWith(
      expect.objectContaining({ timeZone: "Asia/Seoul" })
    );
  });

  test("replaces an invalid browser time zone with the server time zone", async () => {
    process.env.TZ = "Asia/Seoul";

    await grepAgents({
      uuid: "response-uuid",
      response: {},
      message: "@agent 지금 몇 시야?",
      workspace: { id: 7, chatMode: "chat" },
      timeZone: "Mars/Olympus",
    });

    expect(WorkspaceAgentInvocation.new).toHaveBeenCalledWith(
      expect.objectContaining({ timeZone: "Asia/Seoul" })
    );
  });
});
