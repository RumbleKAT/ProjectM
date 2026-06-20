const prisma = require("../utils/prisma");
const { log, conclude } = require("./helpers/index.js");
const { getVectorDbClass } = require("../utils/helpers");

(async () => {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const oldTempWorkspaces = await prisma.workspaces.findMany({
      where: {
        slug: { startsWith: "temp-" },
        createdAt: { lt: cutoff },
      },
    });

    log(`Found ${oldTempWorkspaces.length} expired temp workspaces to clean`);

    for (const ws of oldTempWorkspaces) {
      try {
        await prisma.workspace_chats.deleteMany({ where: { workspaceId: ws.id } });
        await prisma.workspace_documents.deleteMany({ where: { workspaceId: ws.id } });
        await prisma.workspace_threads.deleteMany({ where: { workspaceId: ws.id } });

        try {
          const VectorDb = getVectorDbClass();
          await VectorDb["delete-namespace"]({ namespace: ws.slug });
        } catch (ve) {
          log(`Failed to delete vector namespace for ${ws.slug}: ${ve.message}`);
        }

        await prisma.workspaces.delete({ where: { id: ws.id } });

        log(`Cleaned workspace: ${ws.slug} (id=${ws.id})`);
      } catch (e) {
        log(`Failed to clean workspace ${ws.slug}: ${e.message}`);
      }
    }

    log(`Cleanup complete: removed ${oldTempWorkspaces.length} workspaces`);
  } catch (e) {
    console.error("cleanup-temporary-workspaces error:", e.message);
  } finally {
    conclude();
  }
})();
