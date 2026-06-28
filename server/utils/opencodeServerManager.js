const { execFile } = require("child_process");
const path = require("path");

const IMAGE = "vinnyahh/opencode-box:latest";
const CONTAINER_NAME = "opencode-server";
const HOST_PORT = 4096;
const CONTAINER_PORT = 4096;
const HOSTNAME = "0.0.0.0";
const START_TIMEOUT_MS = 15000;

let server = null;
let starting = null;
let lastConfig = null;

function formatUrlForDocker(url) {
  if (!url) return url;
  return url.replace(/:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/, "://host.docker.internal$2");
}

const { getBaseLLMProviderModel } = require("./helpers");

function getLLMProviderConfig(providerName) {
  const provider = providerName || process.env.LLM_PROVIDER || "openai";
  let apiKey = "";
  let model = "";
  let baseUrl = "";

  const providerEnvKeys = {
    openai: "OPEN_AI_KEY",
    azure: "AZURE_OPENAI_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    gemini: "GEMINI_API_KEY",
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

  const envKey = providerEnvKeys[provider];
  if (envKey) {
    apiKey = process.env[envKey] || "";
  }

  const baseUrlKey = providerBaseUrlKeys[provider];
  if (baseUrlKey) {
    baseUrl = process.env[baseUrlKey] || "";
  }

  model = getBaseLLMProviderModel({ provider }) || "";

  // Fallback defaults for models if not configured
  if (!model) {
    if (provider === "openai") model = "gpt-4o";
    else if (provider === "gemini") model = "gemini-2.0-flash-lite";
    else if (provider === "anthropic") model = "claude-3-5-sonnet-20241022";
    else if (provider === "moonshotai") model = "moonshot-v1-32k";
  }

  return { provider, model, apiKey, baseUrl };
}

function buildDockerEnv() {
  const projectRoot = path.resolve(__dirname, "..");
  const llmConfig = getLLMProviderConfig();

  const envEntries = [
    `OPENCODE_ALLOWED_ORIGINS=*`,
    `OPENCODE_PROJECT_DIR=${projectRoot}`,
    `OPENCODE_PORT=${CONTAINER_PORT}`,
    `OPENCODE_HOSTNAME=${HOSTNAME}`,
  ];

  if (process.env.OPENCODE_SERVER_PASSWORD) {
    envEntries.push(
      `OPENCODE_SERVER_PASSWORD=${process.env.OPENCODE_SERVER_PASSWORD}`
    );
  }

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

  if (llmConfig.apiKey) {
    const envKey = providerEnvKeys[llmConfig.provider];
    if (envKey) {
      envEntries.push(`${envKey}=${llmConfig.apiKey}`);
    }
    envEntries.push(`OPENAI_API_KEY=${llmConfig.apiKey}`);
  } else {
    envEntries.push(`OPENAI_API_KEY=dummy`);
  }

  if (llmConfig.baseUrl) {
    const formattedUrl = formatUrlForDocker(llmConfig.baseUrl);
    const baseUrlKey = providerBaseUrlKeys[llmConfig.provider];
    if (baseUrlKey) {
      envEntries.push(`${baseUrlKey}=${formattedUrl}`);
      if (baseUrlKey.endsWith("_BASE_PATH")) {
        envEntries.push(`${baseUrlKey.replace("_BASE_PATH", "_BASE_URL")}=${formattedUrl}`);
      } else if (baseUrlKey.endsWith("_BASE_URL")) {
        envEntries.push(`${baseUrlKey.replace("_BASE_URL", "_BASE_PATH")}=${formattedUrl}`);
      } else if (baseUrlKey.endsWith("_ENDPOINT")) {
        envEntries.push(`${baseUrlKey.replace("_ENDPOINT", "_BASE_URL")}=${formattedUrl}`);
        envEntries.push(`${baseUrlKey.replace("_ENDPOINT", "_BASE_PATH")}=${formattedUrl}`);
      }
    }
    if (llmConfig.provider === "lmstudio") {
      envEntries.push(`LMSTUDIO_BASE_URL=${formattedUrl}`);
      envEntries.push(`LM_STUDIO_BASE_URL=${formattedUrl}`);
    } else if (llmConfig.provider === "localai") {
      envEntries.push(`LOCAL_AI_BASE_URL=${formattedUrl}`);
      envEntries.push(`LOCALAI_BASE_URL=${formattedUrl}`);
    } else if (llmConfig.provider === "ollama") {
      envEntries.push(`OLLAMA_BASE_URL=${formattedUrl}`);
      envEntries.push(`OLLAMA_HOST=${formattedUrl}`);
    }
    envEntries.push(`OPENAI_BASE_URL=${formattedUrl}`);
    envEntries.push(`OPENAI_API_BASE=${formattedUrl}`);
  }

  return envEntries;
}

function execDocker(args, timeout = 10000) {
  return new Promise((resolve, reject) => {
    execFile("docker", args, { timeout }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr.trim() || err.message));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

async function ensureImage() {
  try {
    await execDocker(["image", "inspect", IMAGE]);
  } catch {
    console.log(`\x1b[33m[OpenCode Server]\x1b[0m Pulling ${IMAGE}...`);
    await execDocker(["pull", IMAGE], 120000);
  }
}

async function startContainer() {
  await execDocker(["rm", "-f", CONTAINER_NAME]).catch(() => {});

  const env = buildDockerEnv();
  const envFlags = env.flatMap((e) => ["-e", e]);

  const args = [
    "run",
    "-d",
    "--name",
    CONTAINER_NAME,
    "--restart",
    "no",
    "-p",
    `127.0.0.1:${HOST_PORT}:${CONTAINER_PORT}`,
    ...envFlags,
    "--entrypoint",
    "opencode",
    IMAGE,
    "serve",
    `--hostname=${HOSTNAME}`,
    `--port=${CONTAINER_PORT}`,
    "--cors=*",
  ];

  const containerId = await execDocker(args, 30000);
  return containerId;
}

async function waitForHealthy(timeoutMs = START_TIMEOUT_MS) {
  const startTime = Date.now();
  const http = require("http");

  while (Date.now() - startTime < timeoutMs) {
    try {
      const status = await execDocker(
        ["inspect", CONTAINER_NAME, "--format", "{{.State.Status}}"],
        3000
      );
      if (status !== "running") {
        const logs = await execDocker(["logs", CONTAINER_NAME], 3000).catch(
          () => "(no logs)"
        );
        throw new Error(
          `Container exited with status "${status}"\nContainer logs: ${logs}`
        );
      }

      const healthy = await new Promise((resolve) => {
        const req = http.get(
          `http://127.0.0.1:${HOST_PORT}/api/health`,
          (res) => {
            res.resume();
            resolve(res.statusCode !== undefined);
          }
        );
        req.on("error", () => resolve(false));
        req.setTimeout(2000, () => {
          req.destroy();
          resolve(false);
        });
      });

      if (healthy) {
        return true;
      }
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  const logs = await execDocker(["logs", CONTAINER_NAME], 3000).catch(
    () => "(no logs)"
  );
  await execDocker(["rm", "-f", CONTAINER_NAME]).catch(() => {});
  throw new Error(
    `Timed out waiting for container to become healthy.\nContainer logs: ${logs}`
  );
}

async function start() {
  const currentConfig = getLLMProviderConfig();

  if (server) {
    const configChanged =
      !lastConfig ||
      lastConfig.provider !== currentConfig.provider ||
      lastConfig.model !== currentConfig.model ||
      lastConfig.apiKey !== currentConfig.apiKey ||
      lastConfig.baseUrl !== currentConfig.baseUrl;

    if (configChanged) {
      console.log(
        "\x1b[33m[OpenCode Server]\x1b[0m LLM Configuration changed. Restarting container..."
      );
      await stop();
    } else {
      return { url: `http://127.0.0.1:${HOST_PORT}` };
    }
  }

  if (process.env.OPENCODE_DISABLE_AUTO_START === "true") {
    const externalUrl =
      process.env.OPENCODE_SERVER_URL || `http://127.0.0.1:${HOST_PORT}`;
    server = { url: externalUrl };
    lastConfig = currentConfig;
    console.log(
      `\x1b[36m[OpenCode Server]\x1b[0m Auto-start disabled — connecting to external server at ${externalUrl}`
    );
    return { url: externalUrl };
  }

  if (starting) {
    return starting;
  }

  starting = (async () => {
    try {
      try {
        await execDocker(["info", "--format", "{{.ServerVersion}}"]);
      } catch {
        console.log(
          "\x1b[33m[OpenCode Server]\x1b[0m Docker not available — skipping auto-start."
        );
        return null;
      }

      await ensureImage();
      await startContainer();
      await waitForHealthy();

      server = { url: `http://127.0.0.1:${HOST_PORT}` };
      lastConfig = currentConfig;
      console.log(
        `\x1b[36m[OpenCode Server]\x1b[0m Started — listening at ${server.url}`
      );
      return { url: server.url };
    } catch (e) {
      console.log(
        `\x1b[33m[OpenCode Server]\x1b[0m Could not start — ${e.message}`
      );
      return null;
    } finally {
      starting = null;
    }
  })();

  return starting;
}

async function stop() {
  if (starting) {
    try {
      await starting;
    } catch {
      // ignore
    }
  }

  if (!server) return;

  try {
    await execDocker(["rm", "-f", CONTAINER_NAME], 10000).catch(() => {});
    server = null;
    console.log("\x1b[36m[OpenCode Server]\x1b[0m Stopped.");
  } catch (e) {
    console.error(
      "\x1b[33m[OpenCode Server]\x1b[0m Error stopping:",
      e.message
    );
  }
}

function getStatus() {
  if (server) return { running: true, url: server.url };
  return { running: false, url: null };
}

module.exports = { start, stop, getStatus, getLLMProviderConfig, formatUrlForDocker };
