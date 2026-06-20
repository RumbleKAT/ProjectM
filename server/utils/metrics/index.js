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

// 2. Database Metrics
const dbQueryDuration = new client.Histogram({
  name: "db_query_duration_seconds",
  help: "Database query duration in seconds",
  labelNames: ["query"],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
});

const dbPoolSize = new client.Gauge({
  name: "db_pool_size",
  help: "Database connection pool size",
});

const dbFileSizeBytes = new client.Gauge({
  name: "db_file_size_bytes",
  help: "Database file size in bytes",
});

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

const activeThreads = new client.Gauge({
  name: "active_threads",
  help: "Total number of active workspace threads",
});

const documentCount = new client.Gauge({
  name: "document_count",
  help: "Total number of documents",
});

const vectorCount = new client.Gauge({
  name: "vector_count",
  help: "Total number of document vectors",
});

const chatMessageCount = new client.Gauge({
  name: "chat_message_count",
  help: "Total number of chat messages",
});

const apiKeyCount = new client.Gauge({
  name: "api_key_count",
  help: "Total number of active developer API keys",
});

const scheduledJobRunsCount = new client.Gauge({
  name: "scheduled_job_runs_count",
  help: "Total number of scheduled job runs by status",
  labelNames: ["status"],
});

const systemJobRunsCount = new client.Gauge({
  name: "system_job_runs_count",
  help: "Total number of system job runs by status",
  labelNames: ["status"],
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

// 5. Budget Metrics
const llmBudgetLimit = new client.Gauge({
  name: "llm_budget_limit",
  help: "LLM monthly budget limit in USD",
});

const llmBudgetCurrent = new client.Gauge({
  name: "llm_budget_current",
  help: "LLM monthly budget current usage in USD",
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

async function timedDbQuery(label, queryFn) {
  const start = process.hrtime();
  try {
    const result = await queryFn();
    const diff = process.hrtime(start);
    dbQueryDuration.observe({ query: label }, diff[0] + diff[1] / 1e9);
    return result;
  } catch (err) {
    const diff = process.hrtime(start);
    dbQueryDuration.observe({ query: label }, diff[0] + diff[1] / 1e9);
    throw err;
  }
}

// Update dynamic metrics on scrape request
async function updateDynamicMetrics() {
  // Database status and counts
  try {
    const prisma = require("../prisma");
    const fs = require("fs");
    const path = require("path");

    await timedDbQuery("ping", () => prisma.$queryRaw`SELECT 1`);
    dbConnectionStatus.set(1);

    try {
      const dbPath = path.resolve(__dirname, "../../storage/anythingllm.db");
      const stats = fs.statSync(dbPath);
      dbFileSizeBytes.set(stats.size);
    } catch {}

    try {
      const prismaClient = prisma;
      dbPoolSize.set(
        prismaClient._engineConfig
          ? prismaClient._engineConfig.maxConnections || 1
          : 1
      );
    } catch {}

    const activeUsersCount = await timedDbQuery("count_users", () =>
      prisma.users.count({ where: { suspended: 0 } })
    );
    activeUsers.set(activeUsersCount);

    const workspacesCount = await timedDbQuery("count_workspaces", () =>
      prisma.workspaces.count()
    );
    activeWorkspaces.set(workspacesCount);

    const threadsCount = await timedDbQuery("count_threads", () =>
      prisma.workspace_threads.count()
    );
    activeThreads.set(threadsCount);

    const docsCount = await timedDbQuery("count_documents", () =>
      prisma.workspace_documents.count()
    );
    documentCount.set(docsCount);

    const vectorsCount = await timedDbQuery("count_vectors", () =>
      prisma.document_vectors.count()
    );
    vectorCount.set(vectorsCount);

    const chatsCount = await timedDbQuery("count_chats", () =>
      prisma.workspace_chats.count()
    );
    chatMessageCount.set(chatsCount);

    const apiKeysCount = await timedDbQuery("count_api_keys", () =>
      prisma.api_keys.count()
    );
    apiKeyCount.set(apiKeysCount);

    const jobStatuses = [
      "queued",
      "running",
      "completed",
      "failed",
      "timed_out",
    ];
    for (const status of jobStatuses) {
      const scheduledCount = await timedDbQuery("count_scheduled_jobs", () =>
        prisma.scheduled_job_runs.count({ where: { status } })
      );
      scheduledJobRunsCount.set({ status }, scheduledCount);

      const systemCount = await timedDbQuery("count_system_jobs", () =>
        prisma.system_job_runs.count({ where: { status } })
      );
      systemJobRunsCount.set({ status }, systemCount);
    }
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

  // Budget
  try {
    const { BudgetManager } = require("./budget");
    const { limit, current } = await BudgetManager.getSettings();
    llmBudgetLimit.set(limit);
    llmBudgetCurrent.set(current);
  } catch (err) {
    console.error(
      "Failed to query Budget for Prometheus metrics:",
      err.message
    );
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

    try {
      const { BudgetManager } = require("./budget");
      BudgetManager.recordCallCost(
        provider,
        model,
        promptTokens,
        completionTokens
      ).catch((err) =>
        console.error("Failed to record call cost:", err.message)
      );
    } catch (err) {
      console.error("Failed to record cost in trackLLMCall:", err.message);
    }
  }
}

module.exports = {
  httpMetricsMiddleware,
  metricsHandler,
  trackLLMCall,
};
