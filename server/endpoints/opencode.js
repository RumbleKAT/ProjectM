const { reqBody } = require("../utils/http");
const { validatedRequest } = require("../utils/middleware/validatedRequest");
const {
  flexUserRoleValid,
  ROLES,
} = require("../utils/middleware/multiUserProtected");
const { getLLMProvider } = require("../utils/helpers");
const { writeResponseChunk } = require("../utils/helpers/chat/responses");
const { ApiKey } = require("../models/apiKeys");
const { loadOpencodeSdk } = require("../utils/opencodeSdkLoader");
const os = require("os");
const fs = require("fs");
const path = require("path");

function getLLMProviderConfig() {
  const provider = process.env.LLM_PROVIDER || "openai";
  let apiKey = "";
  let model = "";
  let baseUrl = "";

  if (provider === "openai") {
    apiKey = process.env.OPEN_AI_KEY || "";
    model = process.env.OPEN_MODEL_PREF || "gpt-4o";
  } else if (provider === "gemini") {
    apiKey = process.env.GEMINI_API_KEY || "";
    model = process.env.GEMINI_LLM_MODEL_PREF || "gemini-2.0-flash-lite";
  } else if (provider === "anthropic") {
    apiKey = process.env.ANTHROPIC_API_KEY || "";
    model = process.env.ANTHROPIC_MODEL_PREF || "claude-3-5-sonnet-20241022";
  } else if (provider === "ollama") {
    baseUrl = process.env.OLLAMA_BASE_PATH || "";
    model = process.env.OLLAMA_MODEL_PREF || "";
  } else if (provider === "lmstudio") {
    baseUrl = process.env.LMSTUDIO_BASE_PATH || "";
    model = process.env.LMSTUDIO_MODEL_PREF || "";
  } else if (provider === "localai") {
    apiKey = process.env.LOCAL_AI_API_KEY || "";
    baseUrl = process.env.LOCAL_AI_BASE_PATH || "";
    model = process.env.LOCAL_AI_MODEL_PREF || "";
  }

  return { provider, model, apiKey, baseUrl };
}

function getConfigFilePaths() {
  const homeDir = os.homedir();
  const globalPath = path.join(homeDir, ".config", "opencode", "opencode.json");
  const projectPath = path.resolve(__dirname, "../../opencode.json");
  return { globalPath, projectPath };
}

function readJSONFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(content);
    }
  } catch (e) {
    console.error(`Error reading file ${filePath}:`, e);
  }
  return null;
}

function opencodeEndpoints(app) {
  if (!app) return;

  // Retrieve current project's default LLM config
  app.get(
    "/opencode/config",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (request, response) => {
      try {
        const config = getLLMProviderConfig();
        const sdk = await loadOpencodeSdk();
        response.status(200).json({
          success: true,
          provider: config.provider,
          model: config.model,
          hasApiKey: !!config.apiKey,
          baseUrl: config.baseUrl,
          serverUrl: "http://localhost:4096",
          sdkLoaded: !!sdk,
        });
      } catch (e) {
        console.error(e);
        response.status(500).json({ success: false, error: e.message });
      }
    }
  );

  // Chat/Run prompt using standard AnythingLLM LLM Provider
  app.post(
    "/opencode/chat-llm",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (request, response) => {
      try {
        const { prompt } = reqBody(request);
        if (!prompt || prompt.trim().length === 0) {
          return response.status(400).json({ error: "Prompt is empty." });
        }

        const llm = getLLMProvider();
        const stream = await llm.streamGetChatCompletion(
          [{ role: "user", content: prompt }],
          { temperature: 0.7 }
        );

        response.setHeader("Cache-Control", "no-cache");
        response.setHeader("Content-Type", "text/event-stream");
        response.setHeader("Access-Control-Allow-Origin", "*");
        response.setHeader("Connection", "keep-alive");
        response.flushHeaders();

        for await (const chunk of stream) {
          const content = chunk?.choices?.[0]?.delta?.content || "";
          if (content) {
            writeResponseChunk(response, {
              type: "message",
              text: content,
            });
          }
        }
        response.end();
      } catch (e) {
        console.error(e);
        writeResponseChunk(response, {
          type: "error",
          text: e.message,
        });
        response.end();
      }
    }
  );

  // Chat/Run prompt using Opencode SDK
  app.post(
    "/opencode/chat",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (request, response) => {
      try {
        const {
          prompt,
          serverUrl = "http://localhost:4096",
          model,
        } = reqBody(request);
        if (!prompt || prompt.trim().length === 0) {
          return response.status(400).json({ error: "Prompt is empty." });
        }

        const sdk = await loadOpencodeSdk();
        if (!sdk) {
          return response.status(500).json({
            error:
              "Opencode SDK is not loaded or failed to initialize on the server.",
          });
        }

        // Dynamically inject AnythingLLM credentials to process.env if they are missing
        const config = getLLMProviderConfig();
        if (config.apiKey) {
          if (config.provider === "openai" && !process.env.OPENAI_API_KEY) {
            process.env.OPENAI_API_KEY = config.apiKey;
          } else if (
            config.provider === "gemini" &&
            !process.env.GEMINI_API_KEY
          ) {
            process.env.GEMINI_API_KEY = config.apiKey;
          } else if (
            config.provider === "anthropic" &&
            !process.env.ANTHROPIC_API_KEY
          ) {
            process.env.ANTHROPIC_API_KEY = config.apiKey;
          }
        }

        // Create client
        const client = sdk.createOpencodeClient({
          baseUrl: serverUrl,
        });

        // Test connection / Create session
        let session;
        try {
          const res = await client.session.create({
            body: { title: `AnythingLLM Integration Session` },
          });
          session = res.data;
        } catch (connErr) {
          throw new Error(
            `Could not connect to OpenCode server at ${serverUrl}. Ensure the server is running (e.g. by running 'opencode serve' in your terminal). Error: ${connErr.message}`
          );
        }

        // Setup SSE response
        response.setHeader("Cache-Control", "no-cache");
        response.setHeader("Content-Type", "text/event-stream");
        response.setHeader("Access-Control-Allow-Origin", "*");
        response.setHeader("Connection", "keep-alive");
        response.flushHeaders();

        // Map model format — SDK expects {providerID, modelID} object
        let modelParam = null;
        if (model) {
          const parts = model.split("/");
          modelParam = parts.length === 2
            ? { providerID: parts[0], modelID: parts[1] }
            : { providerID: config.provider, modelID: model };
        } else if (config.model) {
          modelParam = { providerID: config.provider, modelID: config.model };
        }

        // Send prompt and get streaming response
        const result = await client.session.prompt({
          path: { id: session.id },
          body: {
            parts: [{ type: "text", text: prompt }],
            ...(modelParam ? { model: modelParam } : {}),
          },
          parseAs: "stream",
        });

        if (result.error) {
          throw new Error(result.error.data?.message || result.error.message || "Unknown error");
        }

        if (!result.data) {
          throw new Error("No response stream from OpenCode server");
        }

        // Parse the SSE/NDJSON stream and forward events
        const reader = result.data.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n");
          buffer = parts.pop() || "";

          for (const line of parts) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("event:") || trimmed.startsWith("id:")) continue;

            const data = trimmed.startsWith("data:")
              ? trimmed.slice(5).trim()
              : trimmed;

            if (!data || data === "[DONE]") continue;

            try {
              const parsed = JSON.parse(data);

              // Handle different event shapes from the response stream
              if (parsed.parts) {
                for (const part of parsed.parts) {
                  if (part.type === "text" && part.text) {
                    writeResponseChunk(response, {
                      type: "message",
                      text: part.text,
                    });
                  }
                }
              }
              if (parsed.info) {
                writeResponseChunk(response, {
                  type: "info",
                  data: parsed.info,
                });
              }
            } catch {
              // non-JSON data line — skip
            }
          }
        }
        response.end();
      } catch (e) {
        console.error(e);
        writeResponseChunk(response, {
          type: "error",
          text: e.message,
        });
        response.end();
      }
    }
  );

  // Retrieve current opencode.json config file details
  app.get(
    "/opencode/mcp",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (request, response) => {
      try {
        const { globalPath, projectPath } = getConfigFilePaths();
        const globalConfig = readJSONFile(globalPath);
        const projectConfig = readJSONFile(projectPath);
        const apiKeys = await ApiKey.where({});

        response.status(200).json({
          success: true,
          globalPath,
          globalExists: !!globalConfig,
          globalConfig,
          projectPath,
          projectExists: !!projectConfig,
          projectConfig,
          apiKeys: apiKeys.map((k) => ({
            id: k.id,
            name: k.name,
            secret: k.secret,
          })),
        });
      } catch (e) {
        console.error(e);
        response.status(500).json({ success: false, error: e.message });
      }
    }
  );

  // Write/Update opencode.json config file with MCP configuration
  app.post(
    "/opencode/mcp",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (request, response) => {
      try {
        const {
          apiKey,
          anythingllmUrl = "http://localhost:3001",
          type = "project",
        } = reqBody(request);

        let finalApiKey = apiKey;
        if (apiKey === "generate") {
          const { apiKey: createdKey, error } = await ApiKey.create(
            null,
            "OpenCode MCP Server Key"
          );
          if (error) throw new Error(`Failed to generate API Key: ${error}`);
          finalApiKey = createdKey.secret;
        }

        if (!finalApiKey) {
          return response
            .status(400)
            .json({ success: false, error: "API key is required." });
        }

        const { globalPath, projectPath } = getConfigFilePaths();
        const targetPath = type === "global" ? globalPath : projectPath;

        // Ensure directories exist
        const targetDir = path.dirname(targetPath);
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }

        // Read existing config
        let currentConfig = readJSONFile(targetPath) || {};

        // Setup mcpServers property
        if (!currentConfig.mcpServers) {
          currentConfig.mcpServers = {};
        }

        currentConfig.mcpServers.anythingllm = {
          command: "npx",
          args: ["-y", "@raqueljezweb/anythingllm-mcp-server"],
          env: {
            ANYTHINGLLM_URL: anythingllmUrl,
            ANYTHINGLLM_API_KEY: finalApiKey,
          },
        };

        // Write file back
        fs.writeFileSync(
          targetPath,
          JSON.stringify(currentConfig, null, 2),
          "utf-8"
        );

        response.status(200).json({
          success: true,
          filePath: targetPath,
          config: currentConfig,
        });
      } catch (e) {
        console.error(e);
        response.status(500).json({ success: false, error: e.message });
      }
    }
  );

  app.get(
    "/opencode/check-connection",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (request, response) => {
      try {
        const { url } = request.query;
        if (!url) {
          return response
            .status(400)
            .json({ success: false, error: "URL is required" });
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        let connected = false;

        try {
          const res = await fetch(`${url}/api/spec`, {
            signal: controller.signal,
          }).catch(() => fetch(url, { signal: controller.signal }));

          if (res.ok || res.status === 404 || res.status === 200) {
            connected = true;
          }
        } catch {
          connected = false;
        } finally {
          clearTimeout(timeoutId);
        }

        response.status(200).json({ success: true, connected });
      } catch {
        response.status(200).json({ success: true, connected: false });
      }
    }
  );
}

module.exports = { opencodeEndpoints, getLLMProviderConfig };
