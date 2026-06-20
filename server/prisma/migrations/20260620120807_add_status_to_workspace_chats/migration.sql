-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_workspace_chats" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "workspaceId" INTEGER NOT NULL,
    "prompt" TEXT NOT NULL,
    "response" TEXT NOT NULL,
    "include" BOOLEAN NOT NULL DEFAULT true,
    "user_id" INTEGER,
    "thread_id" INTEGER,
    "api_session_id" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "feedbackScore" BOOLEAN,
    "memory_processed" BOOLEAN,
    "status" TEXT NOT NULL DEFAULT 'processed',
    CONSTRAINT "workspace_chats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_workspace_chats" ("api_session_id", "createdAt", "feedbackScore", "id", "include", "lastUpdatedAt", "memory_processed", "prompt", "response", "thread_id", "user_id", "workspaceId") SELECT "api_session_id", "createdAt", "feedbackScore", "id", "include", "lastUpdatedAt", "memory_processed", "prompt", "response", "thread_id", "user_id", "workspaceId" FROM "workspace_chats";
DROP TABLE "workspace_chats";
ALTER TABLE "new_workspace_chats" RENAME TO "workspace_chats";
CREATE INDEX "workspace_chats_thread_id_idx" ON "workspace_chats"("thread_id");
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
