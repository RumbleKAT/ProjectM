const prisma = require("../../utils/prisma");
const { Workspace } = require("../../models/workspace");
const { Document } = require("../../models/documents");
const { DocumentVectors } = require("../../models/vectors");
const { WorkspaceChats } = require("../../models/workspaceChats");
const { getVectorDbClass } = require("../../utils/helpers");

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_BATCH_SIZE = 100;

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

module.exports = async function cleanupInactiveWorkspaces({
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
    deletedWorkspaces: 0,
    failedCount: 0,
  };
  const errors = [];

  writeLog(log, "info", "Inactive workspace cleanup started", {
    retentionDays,
    cutoff: result.cutoff,
    batchSize,
  });

  try {
    const VectorDb = getVectorDbClass();

    // Query all workspaces
    const workspaces = await prisma.workspaces.findMany({
      orderBy: { id: "asc" },
    });

    for (const workspace of workspaces) {
      // 1. Check workspace settings update time
      if (new Date(workspace.lastUpdatedAt).getTime() >= cutoffDate.getTime()) {
        continue;
      }
      // 2. Check workspace creation time
      if (new Date(workspace.createdAt).getTime() >= cutoffDate.getTime()) {
        continue;
      }

      // 3. Check latest chat message time
      const latestChat = await prisma.workspace_chats.findFirst({
        where: { workspaceId: workspace.id },
        orderBy: { createdAt: "desc" },
      });

      if (
        latestChat &&
        new Date(latestChat.createdAt).getTime() >= cutoffDate.getTime()
      ) {
        continue;
      }

      // If we reach here, the workspace is inactive!
      result.candidateCount += 1;
      const workspaceId = workspace.id;
      const slug = workspace.slug;

      try {
        await WorkspaceChats.delete({ workspaceId: Number(workspaceId) });
        await DocumentVectors.deleteForWorkspace(workspaceId);
        await Document.delete({ workspaceId: Number(workspaceId) });
        await Workspace.delete({ id: Number(workspaceId) });

        try {
          await VectorDb["delete-namespace"]({ namespace: slug });
        } catch (ve) {
          writeLog(
            log,
            "error",
            `Failed to delete vector namespace for workspace ${slug}`,
            { error: ve.message }
          );
        }

        result.deletedWorkspaces += 1;
        writeLog(
          log,
          "info",
          `Deleted inactive workspace ${slug} (id=${workspaceId})`
        );
      } catch (error) {
        result.failedCount += 1;
        errors.push(error);
        writeLog(
          log,
          "error",
          `Inactive workspace cleanup failed for workspace ${slug}`,
          { error: error instanceof Error ? error.message : String(error) }
        );
      }
    }
  } catch (error) {
    writeLog(log, "error", `Workspace query failed`, {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  writeLog(log, "info", "Inactive workspace cleanup finished", result);

  if (errors.length > 0) {
    const error = new AggregateError(
      errors,
      `Inactive workspace cleanup failed for ${errors.length} candidate(s)`
    );
    error.result = result;
    throw error;
  }

  return result;
};
