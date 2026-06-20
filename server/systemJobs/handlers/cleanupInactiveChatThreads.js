const prisma = require("../../utils/prisma");

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_BATCH_SIZE = 100;
const TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 30_000 };

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function writeLog(log, level, message, details) {
  if (typeof log === "function") {
    log(message, details);
    return;
  }

  if (typeof log?.[level] === "function") {
    log[level](message, details);
    return;
  }

  if (typeof log?.info === "function") log.info(message, details);
}

function currentDate(now) {
  const value = typeof now === "function" ? now() : now;
  return value === undefined ? new Date() : new Date(value);
}

module.exports = async function cleanupInactiveChatThreads({
  options,
  log,
  now,
} = {}) {
  const retentionDays = positiveInteger(
    options?.retentionDays,
    DEFAULT_RETENTION_DAYS
  );
  const batchSize = positiveInteger(options?.batchSize, DEFAULT_BATCH_SIZE);
  const cutoffDate = new Date(
    currentDate(now).getTime() - retentionDays * DAY_MS
  );
  const result = {
    retentionDays,
    cutoff: cutoffDate.toISOString(),
    candidateCount: 0,
    deletedThreads: 0,
    deletedChats: 0,
    skippedAfterRecheck: 0,
    failedCount: 0,
  };
  const errors = [];

  writeLog(log, "info", "Inactive chat thread cleanup started", {
    retentionDays,
    cutoff: result.cutoff,
    batchSize,
  });

  let cursor = 0;
  while (true) {
    const candidates = await prisma.$queryRaw`
      SELECT wt.id
      FROM workspace_threads AS wt
      INNER JOIN workspace_chats AS wc ON wc.thread_id = wt.id
      WHERE wt.id > ${cursor}
      GROUP BY wt.id
      HAVING MAX(wc.createdAt) < ${cutoffDate}
      ORDER BY wt.id ASC
      LIMIT ${batchSize}
    `;

    if (candidates.length === 0) break;

    for (const candidate of candidates) {
      const threadId = candidate.id;
      result.candidateCount += 1;

      try {
        const deletion = await prisma.$transaction(async (tx) => {
          const latestChat = await tx.workspace_chats.aggregate({
            where: { thread_id: threadId },
            _max: { createdAt: true },
          });
          const newestCreatedAt = latestChat._max.createdAt;
          if (
            newestCreatedAt === null ||
            newestCreatedAt === undefined ||
            new Date(newestCreatedAt).getTime() >= cutoffDate.getTime()
          ) {
            return { skipped: true, deletedChats: 0 };
          }

          await tx.workspace_agent_invocations.deleteMany({
            where: { thread_id: threadId },
          });
          const deletedChats = await tx.workspace_chats.deleteMany({
            where: { thread_id: threadId },
          });
          await tx.workspace_threads.delete({ where: { id: threadId } });

          return { skipped: false, deletedChats: deletedChats.count };
        }, TRANSACTION_OPTIONS);

        if (deletion.skipped) {
          result.skippedAfterRecheck += 1;
        } else {
          result.deletedThreads += 1;
          result.deletedChats += Number(deletion.deletedChats);
        }
      } catch (error) {
        result.failedCount += 1;
        errors.push(error);
        writeLog(
          log,
          "error",
          `Inactive chat thread cleanup failed for thread ${threadId}`,
          { error: error instanceof Error ? error.message : String(error) }
        );
      }
    }

    cursor = candidates[candidates.length - 1].id;
    if (candidates.length < batchSize) break;
  }

  writeLog(log, "info", "Inactive chat thread cleanup finished", result);

  if (errors.length > 0) {
    const error = new AggregateError(
      errors,
      `Inactive chat thread cleanup failed for ${errors.length} candidate(s)`
    );
    error.result = result;
    throw error;
  }

  return result;
};
