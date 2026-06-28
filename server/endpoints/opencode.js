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

const { getLLMProviderConfig, formatUrlForDocker } = require("../utils/opencodeServerManager");

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

        const { projectPath } = getConfigFilePaths();
        const opencodeJson = readJSONFile(projectPath) || {};

        response.status(200).json({
          success: true,
          provider: config.provider,
          model: config.model,
          hasApiKey: !!config.apiKey,
          baseUrl: config.baseUrl,
          serverUrl: process.env.OPENCODE_SERVER_URL || "http://localhost:4096",
          sdkLoaded: !!sdk,
          selectedModel: opencodeJson.selectedModel || "system-llm",
          customModel: opencodeJson.customModel || "",
        });
      } catch (e) {
        console.error(e);
        response.status(500).json({ success: false, error: e.message });
      }
    }
  );

  app.post(
    "/opencode/config",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (request, response) => {
      try {
        const { selectedModel, customModel } = reqBody(request);
        const { projectPath } = getConfigFilePaths();

        let config = readJSONFile(projectPath) || {};
        config.selectedModel = selectedModel;
        config.customModel = customModel;

        const targetDir = path.dirname(projectPath);
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }

        fs.writeFileSync(projectPath, JSON.stringify(config, null, 2), "utf-8");
        response.status(200).json({ success: true });
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
          serverUrl = process.env.OPENCODE_SERVER_URL ||
            "http://localhost:4096",
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

        if (
          serverUrl.includes("localhost") ||
          serverUrl.includes("127.0.0.1") ||
          serverUrl === "http://opencode-server:4096"
        ) {
          const { start: startOpencodeServer } = require("../utils/opencodeServerManager");
          await startOpencodeServer();
        }

        // Parse the model string to identify target provider
        let targetProvider = undefined;
        let targetModelId = undefined;

        if (model && model !== "system-llm") {
          const firstSlashIndex = model.indexOf("/");
          if (firstSlashIndex !== -1) {
            targetProvider = model.substring(0, firstSlashIndex);
            targetModelId = model.substring(firstSlashIndex + 1);
          }
        }

        // Dynamically inject AnythingLLM credentials to process.env if they are missing
        const config = getLLMProviderConfig(targetProvider);
        const providerEnvKeys = {
          openai: "OPENAI_API_KEY",
          gemini: "GEMINI_API_KEY",
          anthropic: "ANTHROPIC_API_KEY",
          azure: "AZURE_OPENAI_KEY",
          lmstudio: "LMSTUDIO_AUTH_TOKEN",
          localai: "LOCAL_AI_API_KEY",
          ollama: "OLLAMA_AUTH_TOKEN",
          togetherai: "TOGETHER_AI_API_KEY",
          fireworksai: "FIREWORKS_AI_LLM_API_KEY",
          perplexity: "PERPLEXITY_API_KEY",
          openrouter: "OPENROUTER_API_KEY",
          mistral: "MISTRAL_API_KEY",
          groq: "GROQ_API_KEY",
          textgenwebui: "TEXT_GEN_WEB_UI_API_KEY",
          cohere: "COHERE_API_KEY",
          litellm: "LITE_LLM_API_KEY",
          "generic-openai": "GENERIC_OPEN_AI_API_KEY",
          bedrock: "AWS_BEDROCK_LLM_API_KEY",
          deepseek: "DEEPSEEK_API_KEY",
          apipie: "APIPIE_LLM_API_KEY",
          novita: "NOVITA_LLM_API_KEY",
          xai: "XAI_LLM_API_KEY",
          "nvidia-nim": "NVIDIA_NIM_LLM_API_KEY",
          ppio: "PPIO_API_KEY",
          moonshotai: "MOONSHOT_AI_API_KEY",
          cometapi: "COMETAPI_LLM_API_KEY",
          zai: "ZAI_API_KEY",
          giteeai: "GITEE_AI_API_KEY",
          sambanova: "SAMBANOVA_LLM_API_KEY",
          lemonade: "LEMONADE_LLM_API_KEY",
          minimax: "MINIMAX_API_KEY",
          cerebras: "CEREBRAS_API_KEY",
        };

        const providerBaseUrlKeys = {
          azure: "AZURE_OPENAI_ENDPOINT",
          lmstudio: "LMSTUDIO_BASE_PATH",
          localai: "LOCAL_AI_BASE_PATH",
          ollama: "OLLAMA_BASE_PATH",
          koboldcpp: "KOBOLD_CPP_BASE_PATH",
          textgenwebui: "TEXT_GEN_WEB_UI_BASE_PATH",
          litellm: "LITE_LLM_BASE_PATH",
          "generic-openai": "GENERIC_OPEN_AI_BASE_PATH",
          bedrock: "AWS_BEDROCK_LLM_REGION",
          "nvidia-nim": "NVIDIA_NIM_LLM_BASE_PATH",
          foundry: "FOUNDRY_BASE_PATH",
          "docker-model-runner": "DOCKER_MODEL_RUNNER_BASE_PATH",
          privatemode: "PRIVATEMODE_LLM_BASE_PATH",
          lemonade: "LEMONADE_LLM_BASE_PATH",
        };

        if (config.apiKey) {
          const envKey = providerEnvKeys[config.provider];
          if (envKey && !process.env[envKey]) {
            process.env[envKey] = config.apiKey;
          }
          if (!process.env.OPENAI_API_KEY) {
            process.env.OPENAI_API_KEY = config.apiKey;
          }
        }

        if (config.baseUrl) {
          const baseUrlKey = providerBaseUrlKeys[config.provider];
          if (baseUrlKey && !process.env[baseUrlKey]) {
            process.env[baseUrlKey] = config.baseUrl;
          }
          if (baseUrlKey && baseUrlKey.endsWith("_BASE_PATH")) {
            const altKey = baseUrlKey.replace("_BASE_PATH", "_BASE_URL");
            if (!process.env[altKey]) process.env[altKey] = config.baseUrl;
          } else if (baseUrlKey && baseUrlKey.endsWith("_BASE_URL")) {
            const altKey = baseUrlKey.replace("_BASE_URL", "_BASE_PATH");
            if (!process.env[altKey]) process.env[altKey] = config.baseUrl;
          }
          if (config.provider === "lmstudio") {
            process.env.LMSTUDIO_BASE_URL = config.baseUrl;
            process.env.LM_STUDIO_BASE_URL = config.baseUrl;
          } else if (config.provider === "localai") {
            process.env.LOCAL_AI_BASE_URL = config.baseUrl;
            process.env.LOCALAI_BASE_URL = config.baseUrl;
          } else if (config.provider === "ollama") {
            process.env.OLLAMA_BASE_URL = config.baseUrl;
            process.env.OLLAMA_HOST = config.baseUrl;
          }
          if (!process.env.OPENAI_BASE_URL) {
            process.env.OPENAI_BASE_URL = config.baseUrl;
          }
          if (!process.env.OPENAI_API_BASE) {
            process.env.OPENAI_API_BASE = config.baseUrl;
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
        const opencodeNativeProviders = ["openai", "anthropic", "gemini", "azure", "groq", "mistral", "deepseek", "openrouter", "ollama"];

        let modelParam = null;
        if (model && model !== "system-llm") {
          const [targetProvider, ...targetModelParts] = model.split("/");
          const targetModelId = targetModelParts.join("/");
          if (targetProvider && targetModelId) {
            if (opencodeNativeProviders.includes(targetProvider)) {
              modelParam = { providerID: targetProvider, modelID: targetModelId };
            } else {
              modelParam = { providerID: "openai", modelID: "gpt-4o" };
            }
          } else {
            if (opencodeNativeProviders.includes(config.provider)) {
              modelParam = { providerID: config.provider, modelID: model };
            } else {
              modelParam = { providerID: "openai", modelID: "gpt-4o" };
            }
          }
        } else if (config.model) {
          if (opencodeNativeProviders.includes(config.provider)) {
            modelParam = { providerID: config.provider, modelID: config.model };
          } else {
            modelParam = { providerID: "openai", modelID: "gpt-4o" };
          }
        } else {
          modelParam = { providerID: "opencode", modelID: "big-pickle" };
        }

        // Send prompt and get streaming response
        const formattedBaseUrl = config.baseUrl ? formatUrlForDocker(config.baseUrl) : undefined;
        const result = await client.session.prompt({
          path: { id: session.id },
          body: {
            parts: [{ type: "text", text: prompt }],
            ...(modelParam ? { model: modelParam } : {}),
            ...(formattedBaseUrl ? { baseURL: formattedBaseUrl } : {}),
            apiKey: config.apiKey || "dummy",
          },
          parseAs: "stream",
        });

        if (result.error) {
          throw new Error(
            result.error.data?.message ||
              result.error.message ||
              "Unknown error"
          );
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

          // Process complete lines (SSE: data:...\n or NDJSON: {...}\n)
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            const data = trimmed.startsWith("data:")
              ? trimmed.slice(5).trim()
              : trimmed;

            if (!data || data === "[DONE]") continue;

            try {
              const parsed = JSON.parse(data);

              if (parsed.parts) {
                for (const part of parsed.parts) {
                  if (part.type === "text" && part.text) {
                    writeResponseChunk(response, {
                      type: "message",
                      text: part.text,
                    });
                  } else if (part.type === "tool-call") {
                    writeResponseChunk(response, {
                      type: "system",
                      text: `[Tool] ${part.toolName}(${JSON.stringify(part.args || {})})`,
                    });
                  } else if (part.type === "tool-result") {
                    writeResponseChunk(response, {
                      type: "system",
                      text: `[Tool Result] ${part.toolName} completed.`,
                    });
                  } else if (part.type === "reasoning" && part.text) {
                    writeResponseChunk(response, {
                      type: "reasoning",
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

        // Process remaining buffer after stream ends
        if (buffer.trim()) {
          const data = buffer.startsWith("data:")
            ? buffer.slice(5).trim()
            : buffer.trim();

          if (data && data !== "[DONE]") {
            try {
              const parsed = JSON.parse(data);
              if (parsed.parts) {
                for (const part of parsed.parts) {
                  if (part.type === "text" && part.text) {
                    writeResponseChunk(response, {
                      type: "message",
                      text: part.text,
                    });
                  } else if (part.type === "tool-call") {
                    writeResponseChunk(response, {
                      type: "system",
                      text: `[Tool] ${part.toolName}(${JSON.stringify(part.args || {})})`,
                    });
                  } else if (part.type === "tool-result") {
                    writeResponseChunk(response, {
                      type: "system",
                      text: `[Tool Result] ${part.toolName} completed.`,
                    });
                  } else if (part.type === "reasoning" && part.text) {
                    writeResponseChunk(response, {
                      type: "reasoning",
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
              // ignore
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
        const { apiKey, anythingllmUrl = "http://localhost:3001" } =
          reqBody(request);

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

        // Use a dedicated MCP config file instead of opencode.json
        const mcpConfigPath = path.resolve(__dirname, "../../mcp-config.json");
        const targetPath = mcpConfigPath;

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

        // Also dynamically register with the running OpenCode server
        const opencodeUrl =
          process.env.OPENCODE_SERVER_URL || "http://localhost:4096";
        let liveRegistered = false;
        try {
          const mcpRes = await fetch(`${opencodeUrl}/mcp`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: "anythingllm",
              config: {
                type: "local",
                command: ["npx", "-y", "@raqueljezweb/anythingllm-mcp-server"],
                env: {
                  ANYTHINGLLM_URL: anythingllmUrl,
                  ANYTHINGLLM_API_KEY: finalApiKey,
                },
              },
            }),
          });
          liveRegistered = mcpRes.ok;
        } catch (e) {
          console.warn("Failed to dynamically register MCP server:", e.message);
        }

        response.status(200).json({
          success: true,
          filePath: targetPath,
          config: currentConfig,
          liveRegistered,
        });
      } catch (e) {
        console.error(e);
        response.status(500).json({ success: false, error: e.message });
      }
    }
  );

  app.get(
    "/opencode/mcp-status",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (request, response) => {
      try {
        const opencodeUrl =
          process.env.OPENCODE_SERVER_URL || "http://localhost:4096";
        const res = await fetch(`${opencodeUrl}/mcp`, {
          headers: { "Content-Type": "application/json" },
        });
        if (!res.ok) {
          return response.status(res.status).json({
            success: false,
            error: `OpenCode server returned ${res.status}`,
          });
        }
        const data = await res.json();
        response.status(200).json({ success: true, mcpStatus: data });
      } catch (e) {
        response
          .status(200)
          .json({ success: false, error: e.message, mcpStatus: null });
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
