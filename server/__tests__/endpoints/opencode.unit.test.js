/* eslint-env jest */
const mockOpencodeSdk = {
  createOpencodeClient: jest.fn(),
};

jest.mock("../../utils/opencodeSdkLoader", () => ({
  loadOpencodeSdk: jest.fn().mockResolvedValue(mockOpencodeSdk),
}));

jest.mock("../../utils/opencodeServerManager", () => {
  const original = jest.requireActual("../../utils/opencodeServerManager");
  return {
    ...original,
    start: jest.fn().mockResolvedValue({ url: "http://localhost:4096" }),
    stop: jest.fn().mockResolvedValue(true),
  };
});

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

jest.mock("../../utils/helpers", () => {
  const originalModule = jest.requireActual("../../utils/helpers");
  return {
    ...originalModule,
    getLLMProvider: jest.fn(),
  };
});

jest.mock("../../utils/helpers/chat/responses", () => ({
  writeResponseChunk: jest.fn(),
}));

const { getLLMProviderConfig, opencodeEndpoints } = require("../../endpoints/opencode");
const { reqBody } = require("../../utils/http");
const { getLLMProvider } = require("../../utils/helpers");
const { writeResponseChunk } = require("../../utils/helpers/chat/responses");

function createMockExpressApp() {
  const routes = { get: {}, post: {} };
  const app = {
    get: jest.fn((path, ...handlers) => {
      routes.get[path] = handlers;
    }),
    post: jest.fn((path, ...handlers) => {
      routes.post[path] = handlers;
    }),
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

describe("getLLMProviderConfig", () => {
  const OLD_ENV = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...OLD_ENV };
    delete process.env.LLM_PROVIDER;
    delete process.env.OPEN_AI_KEY;
    delete process.env.OPEN_MODEL_PREF;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_LLM_MODEL_PREF;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_MODEL_PREF;
    delete process.env.OLLAMA_BASE_PATH;
    delete process.env.OLLAMA_MODEL_PREF;
    delete process.env.LMSTUDIO_BASE_PATH;
    delete process.env.LMSTUDIO_MODEL_PREF;
    delete process.env.LOCAL_AI_API_KEY;
    delete process.env.LOCAL_AI_BASE_PATH;
    delete process.env.LOCAL_AI_MODEL_PREF;
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  test("should return default openai config when no provider is set", () => {
    const config = getLLMProviderConfig();
    expect(config).toEqual({
      provider: "openai",
      model: "gpt-4o",
      apiKey: "",
      baseUrl: "",
    });
  });

  test("should return openai config with env vars", () => {
    process.env.LLM_PROVIDER = "openai";
    process.env.OPEN_AI_KEY = "sk-test123";
    process.env.OPEN_MODEL_PREF = "gpt-4-turbo";
    const config = getLLMProviderConfig();
    expect(config).toEqual({
      provider: "openai",
      model: "gpt-4-turbo",
      apiKey: "sk-test123",
      baseUrl: "",
    });
  });

  test("should return gemini config with env vars", () => {
    process.env.LLM_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "gemini-key";
    process.env.GEMINI_LLM_MODEL_PREF = "gemini-2.0-flash-lite";
    const config = getLLMProviderConfig();
    expect(config).toEqual({
      provider: "gemini",
      model: "gemini-2.0-flash-lite",
      apiKey: "gemini-key",
      baseUrl: "",
    });
  });

  test("should use gemini default model when not set", () => {
    process.env.LLM_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "gemini-key";
    const config = getLLMProviderConfig();
    expect(config).toEqual({
      provider: "gemini",
      model: "gemini-2.0-flash-lite",
      apiKey: "gemini-key",
      baseUrl: "",
    });
  });

  test("should return anthropic config with env vars", () => {
    process.env.LLM_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.ANTHROPIC_MODEL_PREF = "claude-3-opus-20240229";
    const config = getLLMProviderConfig();
    expect(config).toEqual({
      provider: "anthropic",
      model: "claude-3-opus-20240229",
      apiKey: "sk-ant-test",
      baseUrl: "",
    });
  });

  test("should use anthropic default model when not set", () => {
    process.env.LLM_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const config = getLLMProviderConfig();
    expect(config).toEqual({
      provider: "anthropic",
      model: "claude-3-5-sonnet-20241022",
      apiKey: "sk-ant-test",
      baseUrl: "",
    });
  });

  test("should return ollama config", () => {
    process.env.LLM_PROVIDER = "ollama";
    process.env.OLLAMA_BASE_PATH = "http://localhost:11434";
    process.env.OLLAMA_MODEL_PREF = "llama3";
    const config = getLLMProviderConfig();
    expect(config).toEqual({
      provider: "ollama",
      model: "llama3",
      apiKey: "",
      baseUrl: "http://localhost:11434",
    });
  });

  test("should return lmstudio config", () => {
    process.env.LLM_PROVIDER = "lmstudio";
    process.env.LMSTUDIO_BASE_PATH = "http://localhost:1234";
    process.env.LMSTUDIO_MODEL_PREF = "local-model";
    const config = getLLMProviderConfig();
    expect(config).toEqual({
      provider: "lmstudio",
      model: "local-model",
      apiKey: "",
      baseUrl: "http://localhost:1234",
    });
  });

  test("should return localai config", () => {
    process.env.LLM_PROVIDER = "localai";
    process.env.LOCAL_AI_API_KEY = "localai-key";
    process.env.LOCAL_AI_BASE_PATH = "http://localhost:8080";
    process.env.LOCAL_AI_MODEL_PREF = "local-model";
    const config = getLLMProviderConfig();
    expect(config).toEqual({
      provider: "localai",
      model: "local-model",
      apiKey: "localai-key",
      baseUrl: "http://localhost:8080",
    });
  });

  test("should return empty strings for unknown provider", () => {
    process.env.LLM_PROVIDER = "unknown-provider";
    const config = getLLMProviderConfig();
    expect(config).toEqual({
      provider: "unknown-provider",
      model: "",
      apiKey: "",
      baseUrl: "",
    });
  });
});

describe("opencodeEndpoints - route registration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("should do nothing when app is falsy", () => {
    opencodeEndpoints(null);
    opencodeEndpoints(undefined);
  });

  test("should register GET /opencode/config with middleware array and handler", () => {
    const app = createMockExpressApp();
    opencodeEndpoints(app);
    expect(app.get).toHaveBeenCalledWith(
      "/opencode/config",
      expect.any(Array),
      expect.any(Function)
    );
  });

  test("should register POST /opencode/chat-llm with middleware array and handler", () => {
    const app = createMockExpressApp();
    opencodeEndpoints(app);
    expect(app.post).toHaveBeenCalledWith(
      "/opencode/chat-llm",
      expect.any(Array),
      expect.any(Function)
    );
  });

  test("should register POST /opencode/chat with middleware array and handler", () => {
    const app = createMockExpressApp();
    opencodeEndpoints(app);
    expect(app.post).toHaveBeenCalledWith(
      "/opencode/chat",
      expect.any(Array),
      expect.any(Function)
    );
  });
});

describe("GET /opencode/config handler", () => {
  const OLD_ENV = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...OLD_ENV };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  test("should return config with hasApiKey:false when no key is set", async () => {
    process.env.LLM_PROVIDER = "openai";
    delete process.env.OPEN_AI_KEY;
    process.env.OPEN_MODEL_PREF = "gpt-4o";

    const app = createMockExpressApp();
    opencodeEndpoints(app);
    const handler = getHandler(app.routes, "get", "/opencode/config");
    const res = createMockResponse();

    await handler({}, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      provider: "openai",
      model: "gpt-4o",
      hasApiKey: false,
      baseUrl: "",
      serverUrl: "http://localhost:4096",
      sdkLoaded: true,
      selectedModel: "system-llm",
      customModel: "",
    });
  });

  test("should return config with hasApiKey:true when key is set", async () => {
    process.env.LLM_PROVIDER = "openai";
    process.env.OPEN_AI_KEY = "sk-test";
    process.env.OPEN_MODEL_PREF = "gpt-4o";

    const app = createMockExpressApp();
    opencodeEndpoints(app);
    const handler = getHandler(app.routes, "get", "/opencode/config");
    const res = createMockResponse();

    await handler({}, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      provider: "openai",
      model: "gpt-4o",
      hasApiKey: true,
      baseUrl: "",
      serverUrl: "http://localhost:4096",
      sdkLoaded: true,
      selectedModel: "system-llm",
      customModel: "",
    });
  });

  test("should handle errors gracefully", async () => {
    const app = createMockExpressApp();
    opencodeEndpoints(app);
    const handler = getHandler(app.routes, "get", "/opencode/config");
    const res = createMockResponse();
    res.json.mockImplementationOnce(() => {
      throw new Error("write error");
    });

    await handler({}, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: "write error",
    });
  });

  test("should write config successfully on POST /opencode/config", async () => {
    const app = createMockExpressApp();
    opencodeEndpoints(app);
    const handler = getHandler(app.routes, "post", "/opencode/config");
    const res = createMockResponse();
    reqBody.mockReturnValue({
      selectedModel: "custom",
      customModel: "lmstudio/gemma",
    });

    const fs = require("fs");
    jest.spyOn(fs, "existsSync").mockReturnValue(true);
    jest.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify({}));
    const writeSpy = jest.spyOn(fs, "writeFileSync").mockImplementation(() => {});

    await handler({}, res);

    expect(writeSpy).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true });

    writeSpy.mockRestore();
    fs.existsSync.mockRestore();
    fs.readFileSync.mockRestore();
  });
});

describe("POST /opencode/chat-llm handler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    reqBody.mockImplementation(() => ({}));
  });

  test("should return 400 when prompt is empty", async () => {
    reqBody.mockReturnValue({ prompt: "" });
    const app = createMockExpressApp();
    opencodeEndpoints(app);
    const handler = getHandler(app.routes, "post", "/opencode/chat-llm");
    const res = createMockResponse();

    await handler({}, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Prompt is empty." });
  });

  test("should return 400 when prompt is whitespace only", async () => {
    reqBody.mockReturnValue({ prompt: "   " });
    const app = createMockExpressApp();
    opencodeEndpoints(app);
    const handler = getHandler(app.routes, "post", "/opencode/chat-llm");
    const res = createMockResponse();

    await handler({}, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Prompt is empty." });
  });

  test("should stream response from LLM provider", async () => {
    reqBody.mockReturnValue({ prompt: "Hello, world!" });

    const mockStream = (async function* () {
      yield { choices: [{ delta: { content: "Hello" } }] };
      yield { choices: [{ delta: { content: " world" } }] };
      yield { choices: [{ delta: { content: "!" } }] };
    })();

    const mockLLM = {
      streamGetChatCompletion: jest.fn().mockResolvedValue(mockStream),
    };
    getLLMProvider.mockReturnValue(mockLLM);

    const app = createMockExpressApp();
    opencodeEndpoints(app);
    const handler = getHandler(app.routes, "post", "/opencode/chat-llm");
    const res = createMockResponse();

    await handler({}, res);

    expect(mockLLM.streamGetChatCompletion).toHaveBeenCalledWith(
      [{ role: "user", content: "Hello, world!" }],
      { temperature: 0.7 }
    );
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-cache");
    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/event-stream");
    expect(res.setHeader).toHaveBeenCalledWith("Access-Control-Allow-Origin", "*");
    expect(res.setHeader).toHaveBeenCalledWith("Connection", "keep-alive");
    expect(res.flushHeaders).toHaveBeenCalled();
    expect(writeResponseChunk).toHaveBeenNthCalledWith(1, res, {
      type: "message",
      text: "Hello",
    });
    expect(writeResponseChunk).toHaveBeenNthCalledWith(2, res, {
      type: "message",
      text: " world",
    });
    expect(writeResponseChunk).toHaveBeenNthCalledWith(3, res, {
      type: "message",
      text: "!",
    });
    expect(res.end).toHaveBeenCalled();
  });

  test("should skip empty content chunks", async () => {
    reqBody.mockReturnValue({ prompt: "Hi" });

    const mockStream = (async function* () {
      yield { choices: [{ delta: { content: "" } }] };
      yield { choices: [{ delta: {} }] };
    })();

    const mockLLM = {
      streamGetChatCompletion: jest.fn().mockResolvedValue(mockStream),
    };
    getLLMProvider.mockReturnValue(mockLLM);

    const app = createMockExpressApp();
    opencodeEndpoints(app);
    const handler = getHandler(app.routes, "post", "/opencode/chat-llm");
    const res = createMockResponse();

    await handler({}, res);

    expect(writeResponseChunk).not.toHaveBeenCalled();
    expect(res.end).toHaveBeenCalled();
  });

  test("should handle LLM provider error", async () => {
    reqBody.mockReturnValue({ prompt: "Hello" });
    const mockLLM = {
      streamGetChatCompletion: jest.fn().mockRejectedValue(new Error("Provider error")),
    };
    getLLMProvider.mockReturnValue(mockLLM);

    const app = createMockExpressApp();
    opencodeEndpoints(app);
    const handler = getHandler(app.routes, "post", "/opencode/chat-llm");
    const res = createMockResponse();

    await handler({}, res);

    expect(writeResponseChunk).toHaveBeenCalledWith(res, {
      type: "error",
      text: "Provider error",
    });
    expect(res.end).toHaveBeenCalled();
  });
});

describe("POST /opencode/chat handler", () => {
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

  test("should return 400 when prompt is empty", async () => {
    reqBody.mockReturnValue({ prompt: "" });
    const app = createMockExpressApp();
    opencodeEndpoints(app);
    const handler = getHandler(app.routes, "post", "/opencode/chat");
    const res = createMockResponse();

    await handler({}, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Prompt is empty." });
  });

  test("should inject OPENAI_API_KEY into process.env when missing", async () => {
    process.env.LLM_PROVIDER = "openai";
    process.env.OPEN_AI_KEY = "sk-from-llm-config";
    delete process.env.OPENAI_API_KEY;

    const mockClient = {
      session: {
        create: jest.fn().mockResolvedValue({ data: { id: "session-123" } }),
        prompt: jest.fn().mockResolvedValue(mockPromptResult([])),
      },
    };
    mockOpencodeSdk.createOpencodeClient.mockReturnValue(mockClient);
    reqBody.mockReturnValue({ prompt: "Hello", model: "openai/gpt-4o" });

    const app = createMockExpressApp();
    opencodeEndpoints(app);
    const handler = getHandler(app.routes, "post", "/opencode/chat");
    const res = createMockResponse();

    await handler({}, res);

    expect(process.env.OPENAI_API_KEY).toBe("sk-from-llm-config");
  });

  test("should not overwrite existing process.env keys", async () => {
    process.env.LLM_PROVIDER = "openai";
    process.env.OPEN_AI_KEY = "sk-from-llm-config";
    process.env.OPENAI_API_KEY = "sk-existing";

    const mockClient = {
      session: {
        create: jest.fn().mockResolvedValue({ data: { id: "session-123" } }),
        prompt: jest.fn().mockResolvedValue(mockPromptResult([])),
      },
    };
    mockOpencodeSdk.createOpencodeClient.mockReturnValue(mockClient);
    reqBody.mockReturnValue({ prompt: "Hello" });

    const app = createMockExpressApp();
    opencodeEndpoints(app);
    const handler = getHandler(app.routes, "post", "/opencode/chat");
    const res = createMockResponse();

    await handler({}, res);

    expect(process.env.OPENAI_API_KEY).toBe("sk-existing");
  });

  test("should resolve system-llm to system provider and model", async () => {
    process.env.LLM_PROVIDER = "openai";
    process.env.OPEN_AI_KEY = "sk-from-llm-config";
    process.env.OPEN_MODEL_PREF = "gpt-4o-system";

    const mockClient = {
      session: {
        create: jest.fn().mockResolvedValue({ data: { id: "session-123" } }),
        prompt: jest.fn().mockResolvedValue(mockPromptResult([])),
      },
    };
    mockOpencodeSdk.createOpencodeClient.mockReturnValue(mockClient);
    reqBody.mockReturnValue({ prompt: "Hello", model: "system-llm" });

    const app = createMockExpressApp();
    opencodeEndpoints(app);
    const handler = getHandler(app.routes, "post", "/opencode/chat");
    const res = createMockResponse();

    await handler({}, res);

    expect(mockClient.session.prompt).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          model: { providerID: "openai", modelID: "gpt-4o-system" },
        }),
      })
    );
  });

  test("should resolve system-llm to lmstudio provider and model", async () => {
    process.env.LLM_PROVIDER = "lmstudio";
    process.env.LMSTUDIO_AUTH_TOKEN = "lmstudio-token";
    process.env.LMSTUDIO_BASE_PATH = "http://localhost:1234/v1";
    process.env.LMSTUDIO_MODEL_PREF = "gemma";

    const mockClient = {
      session: {
        create: jest.fn().mockResolvedValue({ data: { id: "session-123" } }),
        prompt: jest.fn().mockResolvedValue(mockPromptResult([])),
      },
    };
    mockOpencodeSdk.createOpencodeClient.mockReturnValue(mockClient);
    reqBody.mockReturnValue({ prompt: "Hello", model: "system-llm" });

    const app = createMockExpressApp();
    opencodeEndpoints(app);
    const handler = getHandler(app.routes, "post", "/opencode/chat");
    const res = createMockResponse();

    await handler({}, res);

    expect(mockClient.session.prompt).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          model: { providerID: "openai", modelID: "gpt-4o" },
          baseURL: "http://host.docker.internal:1234/v1",
          apiKey: "lmstudio-token",
        }),
      })
    );
  });

  test("should resolve custom model with multiple slashes correctly", async () => {
    process.env.LMSTUDIO_AUTH_TOKEN = "lmstudio-token";
    process.env.LMSTUDIO_BASE_PATH = "http://localhost:1234/v1";

    const mockClient = {
      session: {
        create: jest.fn().mockResolvedValue({ data: { id: "session-123" } }),
        prompt: jest.fn().mockResolvedValue(mockPromptResult([])),
      },
    };
    mockOpencodeSdk.createOpencodeClient.mockReturnValue(mockClient);
    reqBody.mockReturnValue({ prompt: "Hello", model: "lmstudio/google/gemma-4-12b-qat" });

    const app = createMockExpressApp();
    opencodeEndpoints(app);
    const handler = getHandler(app.routes, "post", "/opencode/chat");
    const res = createMockResponse();

    await handler({}, res);

    expect(mockClient.session.prompt).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          model: { providerID: "openai", modelID: "gpt-4o" },
          baseURL: "http://host.docker.internal:1234/v1",
          apiKey: "lmstudio-token",
        }),
      })
    );
  });

  test("should create Opencode client with custom serverUrl", async () => {
    const mockClient = {
      session: {
        create: jest.fn().mockResolvedValue({ data: { id: "session-123" } }),
        prompt: jest.fn().mockResolvedValue(mockPromptResult([])),
      },
    };
    mockOpencodeSdk.createOpencodeClient.mockReturnValue(mockClient);
    reqBody.mockReturnValue({ prompt: "Hello", serverUrl: "http://custom:4096", model: "openai/gpt-4o" });

    const app = createMockExpressApp();
    opencodeEndpoints(app);
    const handler = getHandler(app.routes, "post", "/opencode/chat");
    const res = createMockResponse();

    await handler({}, res);

    expect(mockOpencodeSdk.createOpencodeClient).toHaveBeenCalledWith({
      baseUrl: "http://custom:4096",
    });
  });

  test("should use default serverUrl when not specified", async () => {
    const mockClient = {
      session: {
        create: jest.fn().mockResolvedValue({ data: { id: "session-123" } }),
        prompt: jest.fn().mockResolvedValue(mockPromptResult([])),
      },
    };
    mockOpencodeSdk.createOpencodeClient.mockReturnValue(mockClient);
    reqBody.mockReturnValue({ prompt: "Hello" });

    const app = createMockExpressApp();
    opencodeEndpoints(app);
    const handler = getHandler(app.routes, "post", "/opencode/chat");
    const res = createMockResponse();

    await handler({}, res);

    expect(mockOpencodeSdk.createOpencodeClient).toHaveBeenCalledWith({
      baseUrl: "http://localhost:4096",
    });
  });

  test("should create session and stream prompt with model", async () => {
    const mockEvents = [
      { type: "message", data: { text: "Hello" } },
      { type: "message", data: { text: " world" } },
    ];

    const mockClient = {
      session: {
        create: jest.fn().mockResolvedValue({ data: { id: "session-abc" } }),
        prompt: jest.fn().mockResolvedValue(mockPromptResult(mockEvents)),
      },
    };
    mockOpencodeSdk.createOpencodeClient.mockReturnValue(mockClient);
    reqBody.mockReturnValue({ prompt: "Hi there", model: "anthropic/claude-3-opus" });

    const app = createMockExpressApp();
    opencodeEndpoints(app);
    const handler = getHandler(app.routes, "post", "/opencode/chat");
    const res = createMockResponse();

    await handler({}, res);

    expect(mockClient.session.create).toHaveBeenCalledWith({
      body: { title: "AnythingLLM Integration Session" },
    });
    expect(mockClient.session.prompt).toHaveBeenCalledWith({
      path: { id: "session-abc" },
      body: { parts: [{ type: "text", text: "Hi there" }], model: { providerID: "anthropic", modelID: "claude-3-opus" }, apiKey: "dummy" },
      parseAs: "stream",
    });
    expect(writeResponseChunk).toHaveBeenNthCalledWith(1, res, { type: "message", text: "Hello" });
    expect(writeResponseChunk).toHaveBeenNthCalledWith(2, res, { type: "message", text: " world" });
    expect(res.end).toHaveBeenCalled();
  });

  test("should forward message and info events from stream", async () => {
    const mockEvents = [
      { type: "message", data: { text: "response" } },
      { type: "info", data: { path: "test.js", content: "abc" } },
      { type: "info", data: { text: "thinking..." } },
      { type: "info", data: { foo: "bar" } },
    ];

    const mockClient = {
      session: {
        create: jest.fn().mockResolvedValue({ data: { id: "session-xyz" } }),
        prompt: jest.fn().mockResolvedValue(mockPromptResult(mockEvents)),
      },
    };
    mockOpencodeSdk.createOpencodeClient.mockReturnValue(mockClient);
    reqBody.mockReturnValue({ prompt: "Refactor this" });

    const app = createMockExpressApp();
    opencodeEndpoints(app);
    const handler = getHandler(app.routes, "post", "/opencode/chat");
    const res = createMockResponse();

    await handler({}, res);

    expect(writeResponseChunk).toHaveBeenCalledWith(res, { type: "message", text: "response" });
    expect(writeResponseChunk).toHaveBeenCalledWith(res, { type: "info", data: { path: "test.js", content: "abc" } });
    expect(writeResponseChunk).toHaveBeenCalledWith(res, { type: "info", data: { text: "thinking..." } });
    expect(writeResponseChunk).toHaveBeenCalledWith(res, { type: "info", data: { foo: "bar" } });
  });

  test("should map openai model with provider prefix", async () => {
    process.env.LLM_PROVIDER = "openai";
    process.env.OPEN_MODEL_PREF = "gpt-4o";

    const mockClient = {
      session: {
        create: jest.fn().mockResolvedValue({ data: { id: "session-1" } }),
        prompt: jest.fn().mockResolvedValue(mockPromptResult([])),
      },
    };
    mockOpencodeSdk.createOpencodeClient.mockReturnValue(mockClient);
    reqBody.mockReturnValue({ prompt: "Hello" });

    const app = createMockExpressApp();
    opencodeEndpoints(app);
    const handler = getHandler(app.routes, "post", "/opencode/chat");
    const res = createMockResponse();

    await handler({}, res);

    expect(mockClient.session.prompt).toHaveBeenCalledWith({
      path: { id: "session-1" },
      body: { parts: [{ type: "text", text: "Hello" }], model: { providerID: "openai", modelID: "gpt-4o" }, apiKey: "dummy" },
      parseAs: "stream",
    });
  });

  test("should map gemini model with provider prefix", async () => {
    process.env.LLM_PROVIDER = "gemini";
    process.env.GEMINI_LLM_MODEL_PREF = "gemini-2.0-flash";

    const mockClient = {
      session: {
        create: jest.fn().mockResolvedValue({ data: { id: "session-1" } }),
        prompt: jest.fn().mockResolvedValue(mockPromptResult([])),
      },
    };
    mockOpencodeSdk.createOpencodeClient.mockReturnValue(mockClient);
    reqBody.mockReturnValue({ prompt: "Hello" });

    const app = createMockExpressApp();
    opencodeEndpoints(app);
    const handler = getHandler(app.routes, "post", "/opencode/chat");
    const res = createMockResponse();

    await handler({}, res);

    expect(mockClient.session.prompt).toHaveBeenCalledWith({
      path: { id: "session-1" },
      body: { parts: [{ type: "text", text: "Hello" }], model: { providerID: "gemini", modelID: "gemini-2.0-flash" }, apiKey: "dummy" },
      parseAs: "stream",
    });
  });

  test("should map anthropic model with provider prefix", async () => {
    process.env.LLM_PROVIDER = "anthropic";
    process.env.ANTHROPIC_MODEL_PREF = "claude-sonnet-4-20250514";

    const mockClient = {
      session: {
        create: jest.fn().mockResolvedValue({ data: { id: "session-1" } }),
        prompt: jest.fn().mockResolvedValue(mockPromptResult([])),
      },
    };
    mockOpencodeSdk.createOpencodeClient.mockReturnValue(mockClient);
    reqBody.mockReturnValue({ prompt: "Hello" });

    const app = createMockExpressApp();
    opencodeEndpoints(app);
    const handler = getHandler(app.routes, "post", "/opencode/chat");
    const res = createMockResponse();

    await handler({}, res);

    expect(mockClient.session.prompt).toHaveBeenCalledWith({
      path: { id: "session-1" },
      body: { parts: [{ type: "text", text: "Hello" }], model: { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" }, apiKey: "dummy" },
      parseAs: "stream",
    });
  });

  test("should use raw model name for non-mapped providers (ollama)", async () => {
    process.env.LLM_PROVIDER = "ollama";
    process.env.OLLAMA_MODEL_PREF = "llama3";

    const mockClient = {
      session: {
        create: jest.fn().mockResolvedValue({ data: { id: "session-1" } }),
        prompt: jest.fn().mockResolvedValue(mockPromptResult([])),
      },
    };
    mockOpencodeSdk.createOpencodeClient.mockReturnValue(mockClient);
    reqBody.mockReturnValue({ prompt: "Hello" });

    const app = createMockExpressApp();
    opencodeEndpoints(app);
    const handler = getHandler(app.routes, "post", "/opencode/chat");
    const res = createMockResponse();

    await handler({}, res);

    expect(mockClient.session.prompt).toHaveBeenCalledWith({
      path: { id: "session-1" },
      body: { parts: [{ type: "text", text: "Hello" }], model: { providerID: "ollama", modelID: "llama3" }, apiKey: "dummy" },
      parseAs: "stream",
    });
  });

  test("should use default openai/gpt-4o model mapping when no provider is explicitly configured", async () => {
    delete process.env.LLM_PROVIDER;
    delete process.env.OPEN_MODEL_PREF;

    const mockClient = {
      session: {
        create: jest.fn().mockResolvedValue({ data: { id: "session-1" } }),
        prompt: jest.fn().mockResolvedValue(mockPromptResult([])),
      },
    };
    mockOpencodeSdk.createOpencodeClient.mockReturnValue(mockClient);
    reqBody.mockReturnValue({ prompt: "Hello" });

    const app = createMockExpressApp();
    opencodeEndpoints(app);
    const handler = getHandler(app.routes, "post", "/opencode/chat");
    const res = createMockResponse();

    await handler({}, res);

    expect(mockClient.session.prompt).toHaveBeenCalledWith({
      path: { id: "session-1" },
      body: { parts: [{ type: "text", text: "Hello" }], model: { providerID: "openai", modelID: "gpt-4o" }, apiKey: "dummy" },
      parseAs: "stream",
    });
  });

  test("should handle connection error to Opencode server", async () => {
    const mockClient = {
      session: {
        create: jest.fn().mockRejectedValue(new Error("Connection refused")),
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
      text: expect.stringContaining("Could not connect to OpenCode server"),
    });
    expect(res.end).toHaveBeenCalled();
  });

  test("should handle streaming error gracefully", async () => {
    const mockClient = {
      session: {
        create: jest.fn().mockResolvedValue({ data: { id: "session-1" } }),
        prompt: jest.fn().mockResolvedValue({
          data: new ReadableStream({
            start(controller) {
              controller.error(new Error("Stream interrupted"));
            }
          }),
        }),
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
      text: "Stream interrupted",
    });
    expect(res.end).toHaveBeenCalled();
  });

  test("should return 500 when Opencode SDK is not loaded", () => {
    jest.isolateModules(() => {
      jest.resetModules();
      jest.mock("../../utils/opencodeSdkLoader", () => ({
        loadOpencodeSdk: jest.fn().mockResolvedValue(null),
      }));
      jest.mock("../../utils/http", () => ({ reqBody: jest.fn() }));
      jest.mock("../../utils/middleware/validatedRequest", () => ({
        validatedRequest: jest.fn((_req, _res, next) => next()),
      }));
      jest.mock("../../utils/middleware/multiUserProtected", () => ({
        flexUserRoleValid: jest.fn(() => (_, __, next) => next()),
        ROLES: { all: "*" },
      }));
      jest.mock("../../utils/helpers", () => ({ getLLMProvider: jest.fn() }));
      jest.mock("../../utils/helpers/chat/responses", () => ({ writeResponseChunk: jest.fn() }));

      const { opencodeEndpoints: endpoints } = require("../../endpoints/opencode");
      const { reqBody: rb } = require("../../utils/http");
      rb.mockReturnValue({ prompt: "test" });

      const app = createMockExpressApp();
      endpoints(app);
      const handler = getHandler(app.routes, "post", "/opencode/chat");
      const res = createMockResponse();

      return handler({}, res).then(() => {
        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({
          error: "Opencode SDK is not loaded or failed to initialize on the server.",
        });
      });
    });
  });
});
