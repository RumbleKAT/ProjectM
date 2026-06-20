const path = require("path");

const {
  createDefaultRegistry,
  createRegistry,
} = require("../../systemJobs/registry");
const {
  buildCleanupInactiveChatThreadsDefinition,
} = require("../../systemJobs/definitions/cleanupInactiveChatThreads");

const callableHandler = require.resolve("./fixtures/callableHandler.cjs");
const nonCallableHandler = require.resolve("./fixtures/nonCallableHandler.cjs");
const throwingHandler = require.resolve("./fixtures/throwingHandler.cjs");

afterEach(() => {
  jest.restoreAllMocks();
});

function validDefinition(overrides = {}) {
  return {
    key: "sample-job",
    name: "Sample job",
    description: "Runs a sample system job.",
    schedule: "0 3 * * *",
    timeoutMs: 60_000,
    enabledByDefault: false,
    handler: callableHandler,
    options: {
      retries: 2,
      labels: ["maintenance"],
      nested: { notify: true },
    },
    ...overrides,
  };
}

describe("createRegistry", () => {
  test("provides immutable lookup and listing for registered definitions", () => {
    const source = validDefinition();
    const registry = createRegistry([source]);

    expect(registry.get("sample-job")).toEqual(source);
    expect(registry.all()).toEqual([source]);
    expect(registry.get("unknown")).toBeNull();
    expect(Object.isFrozen(registry)).toBe(true);
  });

  test("defensively copies and freezes definitions and option metadata", () => {
    const source = validDefinition();
    const registry = createRegistry([source]);
    const registered = registry.get("sample-job");
    const firstListing = registry.all();

    source.name = "Changed at source";
    source.options.retries = 9;
    source.options.labels.push("mutated");
    source.options.nested.notify = false;
    firstListing.push(validDefinition({ key: "injected" }));

    expect(registered.name).toBe("Sample job");
    expect(registered.options).toEqual({
      retries: 2,
      labels: ["maintenance"],
      nested: { notify: true },
    });
    expect(Object.isFrozen(registered)).toBe(true);
    expect(Object.isFrozen(registered.options)).toBe(true);
    expect(Object.isFrozen(registered.options.labels)).toBe(true);
    expect(Object.isFrozen(registered.options.nested)).toBe(true);
    expect(registry.all()).toHaveLength(1);
  });

  test("accepts and preserves JSON-like option metadata", () => {
    const options = {
      nullable: null,
      text: "maintenance",
      count: 2,
      enabled: true,
      nested: [{ ratio: 0.5 }, false],
    };

    const registered = createRegistry([validDefinition({ options })]).get(
      "sample-job"
    );

    expect(registered.options).toEqual(options);
    expect(registered.options).not.toBe(options);
    expect(registered.options.nested).not.toBe(options.nested);
    expect(Object.isFrozen(registered.options.nested[0])).toBe(true);
  });

  test("preserves prototype-named metadata keys as safe own data properties", () => {
    const options = JSON.parse(
      '{"__proto__":{"admin":true},"constructor":"metadata","prototype":{"safe":true}}'
    );

    const registered = createRegistry([validDefinition({ options })]).get(
      "sample-job"
    );

    expect(Object.getPrototypeOf(registered.options)).toBe(Object.prototype);
    expect(
      Object.prototype.hasOwnProperty.call(registered.options, "__proto__")
    ).toBe(true);
    expect(registered.options.__proto__).toEqual({ admin: true });
    expect(registered.options.admin).toBeUndefined();
    expect(registered.options.constructor).toBe("metadata");
    expect(registered.options.prototype).toEqual({ safe: true });
  });

  test.each([
    [
      "undefined",
      () => ({ nested: { value: undefined } }),
      "options.nested.value",
    ],
    ["function", () => ({ value: () => {} }), "options.value"],
    ["symbol", () => ({ value: Symbol("metadata") }), "options.value"],
    ["bigint", () => ({ value: 1n }), "options.value"],
    ["Date", () => ({ value: new Date() }), "options.value"],
    ["Map", () => ({ value: new Map() }), "options.value"],
    ["Set", () => ({ value: new Set() }), "options.value"],
    [
      "class instance",
      () => {
        class Metadata {}
        return { value: new Metadata() };
      },
      "options.value",
    ],
    ["NaN", () => ({ value: Number.NaN }), "options.value"],
    ["positive infinity", () => ({ value: Infinity }), "options.value"],
    ["negative infinity", () => ({ value: -Infinity }), "options.value"],
    [
      "cycle",
      () => {
        const options = {};
        options.self = options;
        return options;
      },
      "options.self",
    ],
  ])(
    "rejects %s option metadata with its path",
    (_, buildOptions, optionPath) => {
      expect(() =>
        createRegistry([validDefinition({ options: buildOptions() })])
      ).toThrow(
        expect.objectContaining({
          message: expect.stringContaining(
            `Invalid options for system job sample-job at ${optionPath}`
          ),
        })
      );
    }
  );

  test("rejects symbol keys in option metadata", () => {
    const options = { valid: true };
    options[Symbol("hidden")] = "not JSON-like";

    expect(() => createRegistry([validDefinition({ options })])).toThrow(
      "Invalid options for system job sample-job at options: symbol keys are not supported"
    );
  });

  test("preserves an omitted options field", () => {
    const definition = validDefinition();
    delete definition.options;

    const registered = createRegistry([definition]).get("sample-job");

    expect(registered).not.toHaveProperty("options");
  });

  test("rejects duplicate keys with the conflicting key", () => {
    expect(() =>
      createRegistry([validDefinition(), validDefinition()])
    ).toThrow("Duplicate system job key: sample-job");
  });

  test.each([
    [
      "missing key",
      { key: undefined },
      "Invalid key for system job definition",
    ],
    ["empty key", { key: " " }, "Invalid key for system job definition"],
    [
      "missing name",
      { name: undefined },
      "Invalid name for system job sample-job",
    ],
    ["empty name", { name: " " }, "Invalid name for system job sample-job"],
    [
      "missing description",
      { description: undefined },
      "Invalid description for system job sample-job",
    ],
    [
      "empty description",
      { description: " " },
      "Invalid description for system job sample-job",
    ],
  ])("rejects a %s", (_, overrides, message) => {
    expect(() => createRegistry([validDefinition(overrides)])).toThrow(message);
  });

  test.each(["bad", "0 3 * *", "0 3 * * * *"])(
    "rejects invalid or non-five-field cron %p",
    (schedule) => {
      expect(() => createRegistry([validDefinition({ schedule })])).toThrow(
        "Invalid cron for system job sample-job"
      );
    }
  );

  test.each([0, -1, 1.5, Number.NaN])(
    "rejects invalid timeout %p",
    (timeoutMs) => {
      expect(() => createRegistry([validDefinition({ timeoutMs })])).toThrow(
        "Invalid timeout for system job sample-job"
      );
    }
  );

  test.each([undefined, 0, "false", null])(
    "rejects nonboolean enabledByDefault %p",
    (enabledByDefault) => {
      expect(() =>
        createRegistry([validDefinition({ enabledByDefault })])
      ).toThrow("Invalid enabledByDefault for system job sample-job");
    }
  );

  test("rejects a relative handler path", () => {
    expect(() =>
      createRegistry([validDefinition({ handler: "./handler.js" })])
    ).toThrow("Handler must be an absolute path for system job sample-job");
  });

  test("rejects an absolute handler path that does not exist", () => {
    const missingHandler = path.join(__dirname, "missing-handler.js");

    expect(() =>
      createRegistry([validDefinition({ handler: missingHandler })])
    ).toThrow("Handler not found for system job sample-job");
  });

  test("rejects a handler path that is a directory", () => {
    expect(() =>
      createRegistry([validDefinition({ handler: __dirname })])
    ).toThrow("Handler must be a regular file for system job sample-job");
  });

  test("rejects a handler module with an object/default export", () => {
    expect(() =>
      createRegistry([validDefinition({ handler: nonCallableHandler })])
    ).toThrow("Handler must export a function for system job sample-job");
  });

  test("reports and preserves the cause when a handler throws while loading", () => {
    let thrown;

    try {
      createRegistry([validDefinition({ handler: throwingHandler })]);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown.message).toContain(
      "Handler is not loadable for system job sample-job: fixture load failure"
    );
    expect(thrown.cause).toBeInstanceOf(Error);
    expect(thrown.cause.message).toBe("fixture load failure");
  });

  test("exports a lazy default-registry factory", () => {
    expect(createDefaultRegistry).toEqual(expect.any(Function));
  });

  test("importing the registry does not build env config or load the cleanup handler", () => {
    const buildDefinition = jest.fn(() => {
      throw new Error("definition evaluated during import");
    });
    jest.doMock(
      "../../systemJobs/definitions/cleanupInactiveChatThreads",
      () => ({
        buildCleanupInactiveChatThreadsDefinition: buildDefinition,
      })
    );
    jest.doMock(
      "../../systemJobs/handlers/cleanupInactiveChatThreads",
      () => {
        throw new Error("cleanup handler loaded during import");
      },
      { virtual: true }
    );

    try {
      expect(() => {
        jest.isolateModules(() => require("../../systemJobs/registry"));
      }).not.toThrow();
      expect(buildDefinition).not.toHaveBeenCalled();
    } finally {
      jest.dontMock("../../systemJobs/definitions/cleanupInactiveChatThreads");
      jest.dontMock("../../systemJobs/handlers/cleanupInactiveChatThreads");
    }
  });
});

describe("cleanup inactive chat threads definition", () => {
  test("uses safe defaults without warning when retention is absent", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

    const definition = buildCleanupInactiveChatThreadsDefinition({});

    expect(definition).toEqual({
      key: "cleanup-inactive-chat-threads",
      name: "Cleanup inactive chat threads",
      description: expect.stringContaining("30 days"),
      schedule: "0 3 * * *",
      timeoutMs: 10 * 60 * 1000,
      enabledByDefault: false,
      handler: path.resolve(
        __dirname,
        "../../systemJobs/handlers/cleanupInactiveChatThreads.js"
      ),
      options: { retentionDays: 30, batchSize: 100 },
    });
    expect(path.isAbsolute(definition.handler)).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  test("reads valid retention and cron overrides when each definition is built", () => {
    const first = buildCleanupInactiveChatThreadsDefinition({
      INACTIVE_CHAT_RETENTION_DAYS: "45",
      CLEANUP_INACTIVE_CHAT_THREADS_CRON: "15 4 * * 1",
    });
    const second = buildCleanupInactiveChatThreadsDefinition({
      INACTIVE_CHAT_RETENTION_DAYS: "60",
      CLEANUP_INACTIVE_CHAT_THREADS_CRON: "30 5 * * 2",
    });

    expect(first.options.retentionDays).toBe(45);
    expect(first.description).toContain("45 days");
    expect(first.schedule).toBe("15 4 * * 1");
    expect(second.options.retentionDays).toBe(60);
    expect(second.schedule).toBe("30 5 * * 2");
  });

  test.each([
    ["nonnumeric", "many"],
    ["empty", ""],
    ["NaN", "NaN"],
    ["infinite", "Infinity"],
    ["fractional", "2.5"],
    ["zero", "0"],
    ["negative", "-3"],
  ])(
    "falls back and warns once for an explicitly invalid %s retention",
    (_, value) => {
      const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

      const definition = buildCleanupInactiveChatThreadsDefinition({
        INACTIVE_CHAT_RETENTION_DAYS: value,
      });

      expect(definition.options.retentionDays).toBe(30);
      expect(definition.description).toContain("30 days");
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("INACTIVE_CHAT_RETENTION_DAYS")
      );
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("30"));
    }
  );

  test("rejects an invalid cron override when the definition enters a registry", () => {
    const definition = buildCleanupInactiveChatThreadsDefinition({
      CLEANUP_INACTIVE_CHAT_THREADS_CRON: "not-a-cron",
    });

    expect(() => createRegistry([definition])).toThrow(
      "Invalid cron for system job cleanup-inactive-chat-threads"
    );
  });
});
