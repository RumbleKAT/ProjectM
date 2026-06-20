const fs = require("fs");
const path = require("path");
const cronValidate = require("cron-validate").default;
const {
  buildCleanupInactiveChatThreadsDefinition,
} = require("./definitions/cleanupInactiveChatThreads");

function isNonemptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function invalidOptions(definitionKey, optionPath, reason) {
  throw new Error(
    `Invalid options for system job ${definitionKey} at ${optionPath}: ${reason}`
  );
}

function cloneOptions(
  value,
  definitionKey,
  optionPath = "options",
  parents = new WeakSet()
) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      invalidOptions(definitionKey, optionPath, "numbers must be finite");
    }
    return value;
  }
  if (typeof value !== "object") {
    invalidOptions(
      definitionKey,
      optionPath,
      `${typeof value} values are not supported`
    );
  }
  if (parents.has(value)) {
    invalidOptions(
      definitionKey,
      optionPath,
      "cyclic values are not supported"
    );
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    invalidOptions(definitionKey, optionPath, "symbol keys are not supported");
  }

  parents.add(value);
  if (Array.isArray(value)) {
    const copy = [];
    for (let index = 0; index < value.length; index += 1) {
      copy.push(
        cloneOptions(
          value[index],
          definitionKey,
          `${optionPath}[${index}]`,
          parents
        )
      );
    }
    parents.delete(value);
    return Object.freeze(copy);
  }

  if (Object.getPrototypeOf(value) !== Object.prototype) {
    parents.delete(value);
    invalidOptions(definitionKey, optionPath, "expected a plain object");
  }

  const copy = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    Object.defineProperty(copy, key, {
      value: cloneOptions(
        nestedValue,
        definitionKey,
        `${optionPath}.${key}`,
        parents
      ),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  parents.delete(value);
  return Object.freeze(copy);
}

function handlerLoadError(definitionKey, cause) {
  const message = cause instanceof Error ? cause.message : String(cause);
  return new Error(
    `Handler is not loadable for system job ${definitionKey}: ${message}`,
    { cause }
  );
}

function validateDefinition(definition, registeredKeys) {
  if (!definition || !isNonemptyString(definition.key)) {
    throw new Error(
      "Invalid key for system job definition: expected a nonempty string"
    );
  }
  if (registeredKeys.has(definition.key)) {
    throw new Error(`Duplicate system job key: ${definition.key}`);
  }
  if (!isNonemptyString(definition.name)) {
    throw new Error(`Invalid name for system job ${definition.key}`);
  }
  if (!isNonemptyString(definition.description)) {
    throw new Error(`Invalid description for system job ${definition.key}`);
  }

  const cronFields =
    typeof definition.schedule === "string"
      ? definition.schedule.trim().split(/\s+/)
      : [];
  let validCron = false;
  if (cronFields.length === 5) {
    try {
      validCron = cronValidate(definition.schedule).isValid();
    } catch {
      validCron = false;
    }
  }
  if (!validCron) {
    throw new Error(`Invalid cron for system job ${definition.key}`);
  }

  if (
    !Number.isFinite(definition.timeoutMs) ||
    !Number.isInteger(definition.timeoutMs) ||
    definition.timeoutMs <= 0
  ) {
    throw new Error(`Invalid timeout for system job ${definition.key}`);
  }
  if (typeof definition.enabledByDefault !== "boolean") {
    throw new Error(
      `Invalid enabledByDefault for system job ${definition.key}`
    );
  }
  if (
    !isNonemptyString(definition.handler) ||
    !path.isAbsolute(definition.handler)
  ) {
    throw new Error(
      `Handler must be an absolute path for system job ${definition.key}`
    );
  }
  if (!fs.existsSync(definition.handler)) {
    throw new Error(`Handler not found for system job ${definition.key}`);
  }

  let handlerStats;
  try {
    handlerStats = fs.statSync(definition.handler);
  } catch (error) {
    throw handlerLoadError(definition.key, error);
  }
  if (!handlerStats.isFile()) {
    throw new Error(
      `Handler must be a regular file for system job ${definition.key}`
    );
  }

  let resolvedHandler;
  try {
    resolvedHandler = require.resolve(definition.handler);
  } catch (error) {
    throw handlerLoadError(definition.key, error);
  }

  let handler;
  try {
    handler = require(resolvedHandler);
  } catch (error) {
    throw handlerLoadError(definition.key, error);
  }
  if (typeof handler !== "function") {
    throw new Error(
      `Handler must export a function for system job ${definition.key}`
    );
  }
}

/**
 * Builds an immutable registry from trusted, in-code job definitions.
 * Executable handler paths are never sourced from request data by this module.
 *
 * @param {Array<object>} definitions
 * @returns {{all: () => Array<object>, get: (key: string) => object|null}}
 */
function createRegistry(definitions) {
  if (!Array.isArray(definitions)) {
    throw new Error("System job definitions must be an array");
  }

  const jobs = new Map();
  for (const definition of definitions) {
    validateDefinition(definition, jobs);
    const registered = {
      key: definition.key,
      name: definition.name,
      description: definition.description,
      schedule: definition.schedule,
      timeoutMs: definition.timeoutMs,
      enabledByDefault: definition.enabledByDefault,
      handler: definition.handler,
    };
    if (definition.options !== undefined) {
      registered.options = cloneOptions(definition.options, definition.key);
    }
    jobs.set(registered.key, Object.freeze(registered));
  }

  return Object.freeze({
    all: () => [...jobs.values()],
    get: (key) => jobs.get(key) || null,
  });
}

function createDefaultRegistry() {
  return createRegistry([buildCleanupInactiveChatThreadsDefinition()]);
}

module.exports = { createDefaultRegistry, createRegistry };
