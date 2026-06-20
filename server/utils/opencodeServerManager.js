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

  if (llmConfig.apiKey) {
    const envKey =
      llmConfig.provider === "openai"
        ? "OPENAI_API_KEY"
        : llmConfig.provider === "gemini"
          ? "GEMINI_API_KEY"
          : llmConfig.provider === "anthropic"
            ? "ANTHROPIC_API_KEY"
            : llmConfig.provider === "localai"
              ? "LOCAL_AI_API_KEY"
              : null;
    if (envKey) {
      envEntries.push(`${envKey}=${llmConfig.apiKey}`);
      if (envKey !== "OPENAI_API_KEY") {
        envEntries.push(`OPENAI_API_KEY=${llmConfig.apiKey}`);
      }
    }
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
  if (server) {
    return { url: `http://127.0.0.1:${HOST_PORT}` };
  }

  if (process.env.OPENCODE_DISABLE_AUTO_START === "true") {
    const externalUrl =
      process.env.OPENCODE_SERVER_URL || `http://127.0.0.1:${HOST_PORT}`;
    server = { url: externalUrl };
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

module.exports = { start, stop, getStatus };
