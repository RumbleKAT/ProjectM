const fs = require("fs");
const os = require("os");
const path = require("path");
const { PrismaClient } = require("@prisma/client");

jest.setTimeout(30_000);

const schemaPath = path.resolve(__dirname, "../../prisma/schema.prisma");
const migrationPath = path.resolve(
  __dirname,
  "../../prisma/migrations/20260620091000_add_thread_cleanup_indexes/migration.sql"
);

async function createThreadTables(prisma) {
  await prisma.$executeRawUnsafe(
    'CREATE TABLE "workspace_threads" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT)'
  );
  await prisma.$executeRawUnsafe(
    'CREATE TABLE "workspace_agent_invocations" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "thread_id" INTEGER)'
  );
  await prisma.$executeRawUnsafe(
    'CREATE TABLE "workspace_chats" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "thread_id" INTEGER)'
  );
  await prisma.$executeRawUnsafe(
    'CREATE TABLE "workspace_parsed_files" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "threadId" INTEGER, CONSTRAINT "workspace_parsed_files_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "workspace_threads" ("id") ON DELETE CASCADE ON UPDATE CASCADE)'
  );
}

async function applyIndexMigration(prisma) {
  expect(fs.existsSync(migrationPath)).toBe(true);
  const migration = fs.readFileSync(migrationPath, "utf8");
  const statements = migration
    .split(";")
    .map((statement) => statement.replace(/^--.*$/gm, "").trim())
    .filter(Boolean);

  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement);
  }
}

async function rowCount(prisma, table) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS count FROM "${table}"`
  );
  return Number(rows[0].count);
}

function modelDefinition(schema, modelName) {
  const match = schema.match(
    new RegExp(`model ${modelName} \\{([\\s\\S]*?)\\n\\}`)
  );
  expect(match).not.toBeNull();
  return match[1];
}

describe("workspace thread cleanup schema and migration", () => {
  let tempDirectory;
  let prisma;
  let WorkspaceThread;

  beforeEach(async () => {
    tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "workspace-thread-cleanup-")
    );
    const databasePath = path.join(tempDirectory, "test.db");
    prisma = new PrismaClient({
      datasources: { db: { url: `file:${databasePath}` } },
    });
    await prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON");
    await createThreadTables(prisma);

    jest.resetModules();
    jest.doMock("../../utils/prisma", () => prisma);
    ({ WorkspaceThread } = require("../../models/workspaceThread"));
  });

  afterEach(async () => {
    await prisma.$disconnect();
    jest.dontMock("../../utils/prisma");
    jest.resetModules();
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  test("schema and migration define all thread cleanup indexes", async () => {
    const schema = fs.readFileSync(schemaPath, "utf8");
    expect(modelDefinition(schema, "workspace_chats")).toMatch(
      /@@index\(\[thread_id\]\)/
    );
    expect(modelDefinition(schema, "workspace_agent_invocations")).toMatch(
      /@@index\(\[thread_id\]\)/
    );
    expect(modelDefinition(schema, "workspace_parsed_files")).toMatch(
      /@@index\(\[threadId\]\)/
    );

    await applyIndexMigration(prisma);

    const expectations = [
      ["workspace_chats", "workspace_chats_thread_id_idx", "thread_id"],
      [
        "workspace_agent_invocations",
        "workspace_agent_invocations_thread_id_idx",
        "thread_id",
      ],
      [
        "workspace_parsed_files",
        "workspace_parsed_files_threadId_idx",
        "threadId",
      ],
    ];
    for (const [table, indexName, column] of expectations) {
      const indexes = await prisma.$queryRawUnsafe(
        `PRAGMA index_list("${table}")`
      );
      expect(indexes.map(({ name }) => name)).toContain(indexName);
      const indexColumns = await prisma.$queryRawUnsafe(
        `PRAGMA index_info("${indexName}")`
      );
      expect(indexColumns.map(({ name }) => name)).toEqual([column]);
    }
  });

  test("real SQLite deletion cascades parsed files", async () => {
    await prisma.$executeRawUnsafe(
      'INSERT INTO "workspace_threads" ("id") VALUES (41)'
    );
    await prisma.$executeRawUnsafe(
      'INSERT INTO "workspace_agent_invocations" ("thread_id") VALUES (41)'
    );
    await prisma.$executeRawUnsafe(
      'INSERT INTO "workspace_chats" ("thread_id") VALUES (41)'
    );
    await prisma.$executeRawUnsafe(
      'INSERT INTO "workspace_parsed_files" ("threadId") VALUES (41)'
    );

    await expect(WorkspaceThread.delete({ id: 41 })).resolves.toBe(true);

    await expect(rowCount(prisma, "workspace_threads")).resolves.toBe(0);
    await expect(rowCount(prisma, "workspace_agent_invocations")).resolves.toBe(
      0
    );
    await expect(rowCount(prisma, "workspace_chats")).resolves.toBe(0);
    await expect(rowCount(prisma, "workspace_parsed_files")).resolves.toBe(0);
  });

  test("real SQLite transaction rolls back earlier dependent deletes", async () => {
    const consoleSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});
    await prisma.$executeRawUnsafe(
      'INSERT INTO "workspace_threads" ("id") VALUES (41)'
    );
    await prisma.$executeRawUnsafe(
      'INSERT INTO "workspace_agent_invocations" ("thread_id") VALUES (41)'
    );
    await prisma.$executeRawUnsafe(
      'INSERT INTO "workspace_chats" ("thread_id") VALUES (41)'
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER "block_chat_deletion" BEFORE DELETE ON "workspace_chats" BEGIN SELECT RAISE(ABORT, \'blocked chat deletion\'); END'
    );

    await expect(WorkspaceThread.delete({ id: 41 })).resolves.toBe(false);

    await expect(rowCount(prisma, "workspace_threads")).resolves.toBe(1);
    await expect(rowCount(prisma, "workspace_agent_invocations")).resolves.toBe(
      1
    );
    await expect(rowCount(prisma, "workspace_chats")).resolves.toBe(1);
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    consoleSpy.mockRestore();
  });
});
