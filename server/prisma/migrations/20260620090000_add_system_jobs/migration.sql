-- CreateTable
CREATE TABLE "system_job_configs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "jobKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "lastRunAt" DATETIME,
    "nextRunAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "system_job_runs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "systemJobConfigId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "trigger" TEXT NOT NULL,
    "result" TEXT,
    "logs" TEXT,
    "error" TEXT,
    "queuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    CONSTRAINT "system_job_runs_systemJobConfigId_fkey" FOREIGN KEY ("systemJobConfigId") REFERENCES "system_job_configs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "system_job_configs_jobKey_key" ON "system_job_configs"("jobKey");

-- CreateIndex
CREATE INDEX "system_job_runs_systemJobConfigId_queuedAt_idx" ON "system_job_runs"("systemJobConfigId", "queuedAt");

-- CreateIndex
CREATE INDEX "system_job_runs_status_idx" ON "system_job_runs"("status");

-- CreateIndex (partial indexes are not expressible in Prisma schema)
CREATE UNIQUE INDEX "system_job_runs_one_in_flight_per_config"
ON "system_job_runs"("systemJobConfigId")
WHERE "status" IN ('queued', 'running');
