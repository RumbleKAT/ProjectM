const client = require("prom-client");

// Initialize default metrics (CPU, Memory, event loop lag, etc.)
client.collectDefaultMetrics({ register: client.register });

// 1. HTTP Metrics
const httpDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "path", "status_code"],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
});

// 2. Database/User Metrics
const activeUsers = new client.Gauge({
  name: "active_users",
  help: "Number of active (non-suspended) users",
});

const activeWorkspaces = new client.Gauge({
  name: "active_workspaces",
  help: "Number of active workspaces",
});

const dbConnectionStatus = new client.Gauge({
  name: "db_connection_status",
  help: "Database connection status (1 = connected, 0 = disconnected)",
});

// 3. LLM Metrics
const llmCalls = new client.Counter({
  name: "llm_calls_total",
  help: "Total number of LLM calls",
  labelNames: ["provider", "model", "status"],
});

const llmDuration = new client.Histogram({
  name: "llm_call_duration_seconds",
  help: "LLM call duration in seconds",
  labelNames: ["provider", "model"],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 20, 30, 60],
});

const llmTokens = new client.Counter({
  name: "llm_tokens_total",
  help: "Total number of LLM tokens",
  labelNames: ["provider", "model", "type"],
});

// 4. System Metrics (Disk)
const diskFreeBytes = new client.Gauge({
  name: "disk_free_bytes",
  help: "Free disk space in bytes",
});

const diskTotalBytes = new client.Gauge({
  name: "disk_total_bytes",
  help: "Total disk space in bytes",
});

// HTTP middleware to observe request duration
function httpMetricsMiddleware(req, res, next) {
  if (req.path === "/api/metrics" || req.path === "/metrics") {
    return next();
  }

  const start = process.hrtime();
  res.on("finish", () => {
    const diff = process.hrtime(start);
    const duration = diff[0] + diff[1] / 1e9;
    const route = req.route ? req.baseUrl + req.route.path : req.path;

    httpDuration.observe(
      {
        method: req.method,
        path: route,
        status_code: res.statusCode,
      },
      duration
    );
  });

  next();
}

// Update dynamic metrics on scrape request
async function updateDynamicMetrics() {
  // Database status and counts
  try {
    const prisma = require("../prisma");
    await prisma.$queryRaw`SELECT 1`;
    dbConnectionStatus.set(1);

    const activeUsersCount = await prisma.users.count({
      where: { suspended: 0 },
    });
    activeUsers.set(activeUsersCount);

    const workspacesCount = await prisma.workspaces.count();
    activeWorkspaces.set(workspacesCount);
  } catch (err) {
    console.error("Failed to query DB for Prometheus metrics:", err.message);
    dbConnectionStatus.set(0);
  }

  // Disk space
  try {
    const checkDiskSpace = require("check-disk-space").default;
    const { free, size } = await checkDiskSpace("/");
    diskFreeBytes.set(free);
    diskTotalBytes.set(size);
  } catch (err) {
    console.error("Failed to query Disk for Prometheus metrics:", err.message);
  }
}

// Express handler to expose metrics
async function metricsHandler(req, res) {
  await updateDynamicMetrics();
  res.set("Content-Type", client.register.contentType);
  res.end(await client.register.metrics());
}

// Tracker for LLM metrics
function trackLLMCall({
  provider,
  model,
  duration,
  promptTokens,
  completionTokens,
  status,
}) {
  llmCalls.inc({ provider, model, status });

  if (status === "success") {
    if (duration) {
      llmDuration.observe({ provider, model }, duration);
    }
    if (promptTokens) {
      llmTokens.inc({ provider, model, type: "prompt" }, promptTokens);
    }
    if (completionTokens) {
      llmTokens.inc({ provider, model, type: "completion" }, completionTokens);
    }
  }
}

module.exports = {
  httpMetricsMiddleware,
  metricsHandler,
  trackLLMCall,
};
