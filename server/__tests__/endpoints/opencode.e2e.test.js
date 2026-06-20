/* eslint-env jest */
const mockOpencodeSdk = {
  createOpencodeClient: jest.fn(),
};

jest.mock("../../utils/opencodeSdkLoader", () => ({
  loadOpencodeSdk: jest.fn().mockResolvedValue(mockOpencodeSdk),
}));

jest.mock("../../utils/http", () => ({
  reqBody: jest.fn(),
}));

jest.mock("../../utils/middleware/validatedRequest", () => ({
  validatedRequest: jest.fn((_req, _res, next) => next()),
}));

jest.mock("../../utils/middleware/multiUserProtected", () => ({
  flexUserRoleValid: jest.fn(() => (_, __, next) => next()),
  ROLES: { all: "*" },
}));

jest.mock("../../utils/helpers", () => ({
  getLLMProvider: jest.fn(),
}));

jest.mock("../../utils/helpers/chat/responses", () => ({
  writeResponseChunk: jest.fn(),
}));

const { opencodeEndpoints } = require("../../endpoints/opencode");
const { reqBody } = require("../../utils/http");
const { getLLMProvider } = require("../../utils/helpers");
const { writeResponseChunk } = require("../../utils/helpers/chat/responses");

function createMockExpressApp() {
  const routes = { get: {}, post: {} };
  const app = {
    get: jest.fn((path, ...handlers) => { routes.get[path] = handlers; }),
    post: jest.fn((path, ...handlers) => { routes.post[path] = handlers; }),
    routes,
  };
  return app;
}

function createMockResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
    flushHeaders: jest.fn().mockReturnThis(),
    end: jest.fn().mockReturnThis(),
    write: jest.fn().mockReturnThis(),
    on: jest.fn().mockReturnThis(),
  };
}

function getHandler(routes, method, path) {
  const handlers = routes[method][path];
  if (!handlers) return null;
  const last = handlers[handlers.length - 1];
  return typeof last === "function" ? last : null;
}

function eventsToNDJSON(events) {
  return events.map(event => {
    if (event.type === "message" && event.data?.text) {
      return `data: ${JSON.stringify({ parts: [{ type: "text", text: event.data.text }] })}\n`;
    }
    if (event.type === "info" && event.data) {
      return `data: ${JSON.stringify({ info: event.data })}\n`;
    }
    return `data: ${JSON.stringify(event)}\n`;
  }).join('');
}

function mockPromptResult(events) {
  const encoder = new TextEncoder();
  return {
    data: new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(eventsToNDJSON(events)));
        controller.close();
      }
    }),
  };
}

const OLD_ENV = { ...process.env };

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...OLD_ENV };
  delete process.env.OPENAI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  reqBody.mockImplementation(() => ({}));
});

afterAll(() => {
  process.env = OLD_ENV;
});

describe("E2E: /opencode/chat-llm (AnythingLLM provider path)", () => {
  test("full streaming flow: user prompt -> LLM provider -> SSE chunks", async () => {
    reqBody.mockReturnValue({ prompt: "What is the capital of France?" });

    const responseText = "The capital of France is Paris.";
    async function* generateStream() {
      for (const char of responseText.split(/(?<= )/)) {
        yield { choices: [{ delta: { content: char } }] };
      }
    }

    const mockLLM = {
      streamGetChatCompletion: jest.fn().mockResolvedValue(generateStream()),
    };
    getLLMProvider.mockReturnValue(mockLLM);

    const app = createMockExpressApp();
    opencodeEndpoints(app);
    const handler = getHandler(app.routes, "post", "/opencode/chat-llm");
    const res = createMockResponse();

    await handler({}, res);

    expect(mockLLM.streamGetChatCompletion).toHaveBeenCalledWith(
      [{ role: "user", content: "What is the capital of France?" }],
      { temperature: 0.7 }
    );

    const expectedChunks = responseText.split(/(?<= )/).filter(Boolean);
    expectedChunks.forEach((chunk, i) => {
      expect(writeResponseChunk).toHaveBeenNthCalledWith(i + 1, res, {
        type: "message",
        text: chunk,
      });
    });

    expect(res.end).toHaveBeenCalled();
  });

  test("handles long prompt input without truncation", async () => {
    const longPrompt = "Tell me about " + "AI ".repeat(500).trim();
    reqBody.mockReturnValue({ prompt: longPrompt });

    async function* generateStream() {
      yield { choices: [{ delta: { content: "Here is a response" } }] };
    }

    const mockLLM = {
      streamGetChatCompletion: jest.fn().mockResolvedValue(generateStream()),
    };
    getLLMProvider.mockReturnValue(mockLLM);

    const app = createMockExpressApp();
    opencodeEndpoints(app);
    const handler = getHandler(app.routes, "post", "/opencode/chat-llm");
    const res = createMockResponse();

    await handler({}, res);

    expect(mockLLM.streamGetChatCompletion).toHaveBeenCalledWith(
      [{ role: "user", content: longPrompt }],
      { temperature: 0.7 }
    );
  });

  test("recovery: provider fails on first attempt, succeeds on retry", async () => {
    reqBody.mockReturnValue({ prompt: "Hello" });

    let attempts = 0;
    const mockLLM = {
      streamGetChatCompletion: jest.fn().mockImplementation(() => {
        attempts++;
        if (attempts === 1) return Promise.reject(new Error("First attempt failed"));
        const stream = (async function* () {
          yield { choices: [{ delta: { content: "Success on retry" } }] };
        })();
        return Promise.resolve(stream);
      }),
    };
    getLLMProvider.mockReturnValue(mockLLM);

    const app = createMockExpressApp();
    opencodeEndpoints(app);
    const handler = getHandler(app.routes, "post", "/opencode/chat-llm");
    const res1 = createMockResponse();

    await handler({}, res1);

    expect(writeResponseChunk).toHaveBeenCalledWith(res1, {
      type: "error",
      text: "First attempt failed",
    });
    expect(res1.end).toHaveBeenCalled();

    const res2 = createMockResponse();
    await handler({}, res2);

    expect(writeResponseChunk).toHaveBeenCalledWith(res2, {
      type: "message",
      text: "Success on retry",
    });
    expect(res2.end).toHaveBeenCalled();
  });
});

describe("E2E: /opencode/chat (Opencode SDK free model path)", () => {
  function makeSdkMock(sessionId = "e2e-session") {
    const events = [];
    return {
      createOpencodeClient: jest.fn().mockReturnValue({
        session: {
          create: jest.fn().mockResolvedValue({ data: { id: sessionId } }),
          prompt: jest.fn().mockImplementation(() => Promise.resolve(mockPromptResult(events))),
        },
      }),
      events,
    };
  }

  test("full flow: sends prompt to Opencode free model, receives message events", async () => {
    const { createOpencodeClient } = makeSdkMock("flow-session-1");
    mockOpencodeSdk.createOpencodeClient.mockImplementation(createOpencodeClient);

    const mockEvents = [
      { type: "message", data: { text: "Hello" } },
      { type: "message", data: { text: " from" } },
      { type: "message", data: { text: " free model" } },
      { type: "message", data: { text: "!" } },
    ];

    const mockClient = {
      session: {
        create: jest.fn().mockResolvedValue({ data: { id: "flow-session-1" } }),
        prompt: jest.fn().mockResolvedValue(mockPromptResult(mockEvents)),
      },
    };
    mockOpencodeSdk.createOpencodeClient.mockReturnValue(mockClient);

    reqBody.mockReturnValue({
      prompt: "Write a greeting",
      serverUrl: "http://localhost:4096",
    });

    const app = createMockExpressApp();
    opencodeEndpoints(app);
    const handler = getHandler(app.routes, "post", "/opencode/chat");
    const res = createMockResponse();

    await handler({}, res);

    expect(mockOpencodeSdk.createOpencodeClient).toHaveBeenCalledWith({
      baseUrl: "http://localhost:4096",
    });
    expect(mockClient.session.create).toHaveBeenCalledWith({
      body: { title: "AnythingLLM Integration Session" },
    });
    expect(mockClient.session.prompt).toHaveBeenCalledWith({
      path: { id: "flow-session-1" },
      body: {
        parts: [{ type: "text", text: "Write a greeting" }],
        model: { providerID: "openai", modelID: "gpt-4o" },
      },
      parseAs: "stream",
    });

    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/event-stream");
    expect(writeResponseChunk).toHaveBeenNthCalledWith(1, res, {
      type: "message",
      text: "Hello",
    });
    expect(writeResponseChunk).toHaveBeenNthCalledWith(4, res, {
      type: "message",
      text: "!",
    });
    expect(res.end).toHaveBeenCalled();
  });

  test("full flow: uses gemini flash free model via config mapping", async () => {
    process.env.LLM_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "test-gemini-key";
    process.env.GEMINI_LLM_MODEL_PREF = "gemini-2.0-flash-lite";

    const mockEvents = [
      { type: "message", data: { text: "Gemini flash response" } },
    ];

    const mockClient = {
      session: {
        create: jest.fn().mockResolvedValue({ data: { id: "gemini-session" } }),
        prompt: jest.fn().mockResolvedValue(mockPromptResult(mockEvents)),
      },
    };
    mockOpencodeSdk.createOpencodeClient.mockReturnValue(mockClient);

    reqBody.mockReturnValue({ prompt: "Hello from gemini" });

    const app = createMockExpressApp();
    opencodeEndpoints(app);
    const handler = getHandler(app.routes, "post", "/opencode/chat");
    const res = createMockResponse();

    await handler({}, res);

    expect(mockClient.session.prompt).toHaveBeenCalledWith({
      path: { id: "gemini-session" },
      body: {
        parts: [{ type: "text", text: "Hello from gemini" }],
        model: { providerID: "gemini", modelID: "gemini-2.0-flash-lite" },
      },
      parseAs: "stream",
    });

    expect(process.env.GEMINI_API_KEY).toBe("test-gemini-key");
  });

  test("full flow: uses claude sonnet model via config mapping", async () => {
    process.env.LLM_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "sk-ant-e2e-test";
    process.env.ANTHROPIC_MODEL_PREF = "claude-sonnet-4-20250514";

    const mockEvents = [
      { type: "message", data: { text: "Claude response" } },
    ];

    const mockClient = {
      session: {
        create: jest.fn().mockResolvedValue({ data: { id: "claude-session" } }),
        prompt: jest.fn().mockResolvedValue(mockPromptResult(mockEvents)),
      },
    };
    mockOpencodeSdk.createOpencodeClient.mockReturnValue(mockClient);

    reqBody.mockReturnValue({ prompt: "Hello from claude" });

    const app = createMockExpressApp();
    opencodeEndpoints(app);
    const handler = getHandler(app.routes, "post", "/opencode/chat");
    const res = createMockResponse();

    await handler({}, res);

    expect(mockClient.session.prompt).toHaveBeenCalledWith({
      path: { id: "claude-session" },
      body: {
        parts: [{ type: "text", text: "Hello from claude" }],
        model: { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
      },
      parseAs: "stream",
    });
  });

  test("end-to-end: config endpoint then chat with returned model", async () => {
    process.env.LLM_PROVIDER = "openai";
    process.env.OPEN_AI_KEY = "sk-e2e-key";
    process.env.OPEN_MODEL_PREF = "gpt-4o-mini";

    const mockEvents = [
      { type: "message", data: { text: "mini response" } },
    ];
    const mockClient = {
      session: {
        create: jest.fn().mockResolvedValue({ data: { id: "e2e-session" } }),
        prompt: jest.fn().mockResolvedValue(mockPromptResult(mockEvents)),
      },
    };
    mockOpencodeSdk.createOpencodeClient.mockReturnValue(mockClient);

    const app = createMockExpressApp();
    opencodeEndpoints(app);

    const configHandler = getHandler(app.routes, "get", "/opencode/config");
    const configRes = createMockResponse();
    await configHandler({}, configRes);

    expect(configRes.status).toHaveBeenCalledWith(200);
    expect(configRes.json).toHaveBeenCalledWith({
      success: true,
      provider: "openai",
      model: "gpt-4o-mini",
      hasApiKey: true,
      baseUrl: "",
      serverUrl: "http://localhost:4096",
      sdkLoaded: true,
    });

    reqBody.mockReturnValue({ prompt: "Test after config" });

    const chatHandler = getHandler(app.routes, "post", "/opencode/chat");
    const chatRes = createMockResponse();
    await chatHandler({}, chatRes);

    expect(mockClient.session.prompt).toHaveBeenCalledWith({
      path: { id: "e2e-session" },
      body: {
        parts: [{ type: "text", text: "Test after config" }],
        model: { providerID: "openai", modelID: "gpt-4o-mini" },
      },
      parseAs: "stream",
    });
  });

  test("handles mixed event types in a single stream (message + info)", async () => {
    const mockEvents = [
      { type: "info", data: { text: "Let me think about this..." } },
      { type: "message", data: { text: "Here is my solution" } },
      { type: "info", data: { path: "/tmp/test.py", content: "print('hello')" } },
      { type: "message", data: { text: "\n\nDone!" } },
    ];

    const mockClient = {
      session: {
        create: jest.fn().mockResolvedValue({ data: { id: "mixed-session" } }),
        prompt: jest.fn().mockResolvedValue(mockPromptResult(mockEvents)),
      },
    };
    mockOpencodeSdk.createOpencodeClient.mockReturnValue(mockClient);
    reqBody.mockReturnValue({ prompt: "Write a Python script" });

    const app = createMockExpressApp();
    opencodeEndpoints(app);
    const handler = getHandler(app.routes, "post", "/opencode/chat");
    const res = createMockResponse();

    await handler({}, res);

    expect(writeResponseChunk).toHaveBeenNthCalledWith(1, res, {
      type: "info",
      data: { text: "Let me think about this..." },
    });
    expect(writeResponseChunk).toHaveBeenNthCalledWith(2, res, {
      type: "message",
      text: "Here is my solution",
    });
    expect(writeResponseChunk).toHaveBeenNthCalledWith(3, res, {
      type: "info",
      data: { path: "/tmp/test.py", content: "print('hello')" },
    });
    expect(writeResponseChunk).toHaveBeenNthCalledWith(4, res, {
      type: "message",
      text: "\n\nDone!",
    });
  });

  test("handles concurrent requests with separate sessions", async () => {
    const client1 = {
      session: {
        create: jest.fn().mockResolvedValue({ data: { id: "session-alpha" } }),
        prompt: jest
          .fn()
          .mockResolvedValue(
            mockPromptResult([{ type: "message", data: { text: "Alpha response" } }])
          ),
      },
    };

    const client2 = {
      session: {
        create: jest.fn().mockResolvedValue({ data: { id: "session-beta" } }),
        prompt: jest
          .fn()
          .mockResolvedValue(
            mockPromptResult([{ type: "message", data: { text: "Beta response" } }])
          ),
      },
    };

    let callCount = 0;
    mockOpencodeSdk.createOpencodeClient.mockImplementation(() => {
      callCount++;
      return callCount === 1 ? client1 : client2;
    });

    reqBody.mockReturnValueOnce({ prompt: "Request alpha" });
    reqBody.mockReturnValueOnce({ prompt: "Request beta" });

    const app = createMockExpressApp();
    opencodeEndpoints(app);
    const handler = getHandler(app.routes, "post", "/opencode/chat");

    const [res1, res2] = await Promise.all([
      handler({}, createMockResponse()),
      handler({}, createMockResponse()),
    ]);

    expect(client1.session.create).toHaveBeenCalled();
    expect(client2.session.create).toHaveBeenCalled();
    expect(client1.session.prompt).toHaveBeenCalledWith({
      path: { id: "session-alpha" },
      body: expect.objectContaining({
        parts: [{ type: "text", text: "Request alpha" }],
      }),
      parseAs: "stream",
    });
    expect(client2.session.prompt).toHaveBeenCalledWith({
      path: { id: "session-beta" },
      body: expect.objectContaining({
        parts: [{ type: "text", text: "Request beta" }],
      }),
      parseAs: "stream",
    });
  });

  test("gracefully handles Opencode server disconnect mid-stream", async () => {
    const encoder = new TextEncoder();
    const ndjson = `data: ${JSON.stringify({ parts: [{ type: "text", text: "Partial response..." }] })}\n`;

    const mockClient = {
      session: {
        create: jest.fn().mockResolvedValue({ data: { id: "disconnect-session" } }),
        prompt: jest.fn().mockResolvedValue({
          data: new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode(ndjson));
            },
            pull(controller) {
              controller.error(new Error("Connection lost"));
            }
          }),
        }),
      },
    };
    mockOpencodeSdk.createOpencodeClient.mockReturnValue(mockClient);
    reqBody.mockReturnValue({ prompt: "Tell me a story" });

    const app = createMockExpressApp();
    opencodeEndpoints(app);
    const handler = getHandler(app.routes, "post", "/opencode/chat");
    const res = createMockResponse();

    await handler({}, res);

    expect(writeResponseChunk).toHaveBeenCalledWith(res, {
      type: "message",
      text: "Partial response...",
    });
    expect(writeResponseChunk).toHaveBeenCalledWith(res, {
      type: "error",
      text: "Connection lost",
    });
    expect(res.end).toHaveBeenCalled();
  });

  test("preserves partial output when stream errors mid-response", async () => {
    const encoder = new TextEncoder();
    const ndjson = `data: ${JSON.stringify({ parts: [{ type: "text", text: "I'll start answering but then" }] })}\n`;

    const mockClient = {
      session: {
        create: jest.fn().mockResolvedValue({ data: { id: "partial-session" } }),
        prompt: jest.fn().mockResolvedValue({
          data: new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode(ndjson));
            },
            pull(controller) {
              controller.error(new Error("Token limit exceeded"));
            }
          }),
        }),
      },
    };
    mockOpencodeSdk.createOpencodeClient.mockReturnValue(mockClient);
    reqBody.mockReturnValue({ prompt: "Fix my code" });

    const app = createMockExpressApp();
    opencodeEndpoints(app);
    const handler = getHandler(app.routes, "post", "/opencode/chat");
    const res = createMockResponse();

    await handler({}, res);

    expect(writeResponseChunk).toHaveBeenCalledWith(res, { type: "message", text: "I'll start answering but then" });
    expect(writeResponseChunk).toHaveBeenCalledWith(res, { type: "error", text: "Token limit exceeded" });
    expect(res.end).toHaveBeenCalled();
  });
});

describe("E2E: Configuration integration", () => {
  test("getLLMProviderConfig reflects AnythingLLM env changes and is consumed by both endpoints", async () => {
    process.env.LLM_PROVIDER = "openai";
    process.env.OPEN_AI_KEY = "sk-integration-key";
    process.env.OPEN_MODEL_PREF = "gpt-4-turbo";

    const mockEvents = [
      { type: "message", data: { text: "ok" } },
    ];
    const mockClient = {
      session: {
        create: jest.fn().mockResolvedValue({ data: { id: "integration-session" } }),
        prompt: jest.fn().mockResolvedValue(mockPromptResult(mockEvents)),
      },
    };
    mockOpencodeSdk.createOpencodeClient.mockReturnValue(mockClient);

    const app = createMockExpressApp();
    opencodeEndpoints(app);

    const configHandler = getHandler(app.routes, "get", "/opencode/config");
    const configRes = createMockResponse();
    await configHandler({}, configRes);

    expect(configRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "openai",
        model: "gpt-4-turbo",
        hasApiKey: true,
      })
    );

    reqBody.mockReturnValue({ prompt: "integration test" });

    const chatHandler = getHandler(app.routes, "post", "/opencode/chat");
    const chatRes = createMockResponse();
    await chatHandler({}, chatRes);

    expect(mockClient.session.prompt).toHaveBeenCalledWith({
      path: { id: "integration-session" },
      body: expect.objectContaining({
        model: { providerID: "openai", modelID: "gpt-4-turbo" },
      }),
      parseAs: "stream",
    });
  });
});

describe("E2E: Error boundaries", () => {
  test("malformed request body does not crash the server", async () => {
    reqBody.mockImplementation(() => {
      throw new Error("Cannot read properties of undefined");
    });

    const app = createMockExpressApp();
    opencodeEndpoints(app);

    const handler = getHandler(app.routes, "post", "/opencode/chat-llm");
    const res = createMockResponse();

    await handler({}, res);

    expect(writeResponseChunk).toHaveBeenCalledWith(res, {
      type: "error",
      text: "Cannot read properties of undefined",
    });
    expect(res.end).toHaveBeenCalled();
  });

  test("SDK method throws on session creation", async () => {
    const mockClient = {
      session: {
        create: jest.fn().mockRejectedValue(new Error("ECONNREFUSED ::1:4096")),
      },
    };
    mockOpencodeSdk.createOpencodeClient.mockReturnValue(mockClient);
    reqBody.mockReturnValue({ prompt: "Hello" });

    const app = createMockExpressApp();
    opencodeEndpoints(app);
    const handler = getHandler(app.routes, "post", "/opencode/chat");
    const res = createMockResponse();

    await handler({}, res);

    expect(writeResponseChunk).toHaveBeenCalledWith(res, {
      type: "error",
      text: expect.stringContaining("ECONNREFUSED"),
    });
    expect(res.end).toHaveBeenCalled();
  });

  test("server responds to invalid request body gracefully", async () => {
    reqBody.mockReturnValue(undefined);

    const app = createMockExpressApp();
    opencodeEndpoints(app);

    const chatHandler = getHandler(app.routes, "post", "/opencode/chat");
    const res = createMockResponse();
    await chatHandler({}, res);

    expect(writeResponseChunk).toHaveBeenCalledWith(res, {
      type: "error",
      text: expect.stringContaining("Cannot destructure property"),
    });
    expect(res.end).toHaveBeenCalled();
  });
});
