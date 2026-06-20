const fs = require("fs");
const pathMod = require("path");

class ModelCostFinder {
  static instance = null;
  static remoteUrl =
    "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
  static expiryMs = 1000 * 60 * 60 * 24 * 3; // 3 days

  constructor() {
    if (ModelCostFinder.instance) return ModelCostFinder.instance;
    ModelCostFinder.instance = this;

    this.cacheLocation = pathMod.resolve(
      process.env.STORAGE_DIR
        ? pathMod.resolve(process.env.STORAGE_DIR, "models", "costs")
        : pathMod.resolve(__dirname, `../../../storage/models/costs`)
    );
    this.cacheFilePath = pathMod.resolve(
      this.cacheLocation,
      "model-prices.json"
    );
    this.cacheFileExpiryPath = pathMod.resolve(
      this.cacheLocation,
      ".cached_at"
    );

    if (!fs.existsSync(this.cacheLocation)) {
      fs.mkdirSync(this.cacheLocation, { recursive: true });
    }

    if (this.isCacheStale || !fs.existsSync(this.cacheFilePath)) {
      this.#pullRemotePrices().catch((err) =>
        this.log("Background model prices pull failed:", err.message)
      );
    }
  }

  log(text, ...args) {
    if (process.env.NODE_ENV === "test") return;
    console.log(`\x1b[35m[ModelCostFinder]\x1b[0m ${text}`, ...args);
  }

  get isCacheStale() {
    if (!fs.existsSync(this.cacheFileExpiryPath)) return true;
    try {
      const cachedAt = fs.readFileSync(this.cacheFileExpiryPath, "utf8");
      return Date.now() - Number(cachedAt) > ModelCostFinder.expiryMs;
    } catch {
      return true;
    }
  }

  get cachedPrices() {
    if (!fs.existsSync(this.cacheFilePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(this.cacheFilePath, "utf8"));
    } catch {
      return null;
    }
  }

  async #pullRemotePrices() {
    try {
      this.log("Pulling remote model pricing map...");
      const response = await fetch(ModelCostFinder.remoteUrl);
      if (response.status !== 200) {
        throw new Error(
          "Failed to fetch remote model pricing - non 200 status code"
        );
      }

      const data = await response.json();
      await Promise.all([
        fs.promises.writeFile(
          this.cacheFilePath,
          JSON.stringify(data, null, 2)
        ),
        fs.promises.writeFile(this.cacheFileExpiryPath, Date.now().toString()),
      ]);

      this.log("Remote model prices synced and cached");
      return data;
    } catch (error) {
      this.log("Error syncing remote model prices:", error.message);
      return null;
    }
  }

  #fallbackCost(promptTokens, completionTokens, provider) {
    const localProviders = [
      "ollama",
      "localai",
      "lmstudio",
      "koboldcpp",
      "llamacpp",
      "textgenwebui",
      "ollama-agent",
    ];
    if (localProviders.includes(String(provider).toLowerCase())) {
      return 0;
    }
    // Generic fallback ($1.50 / 1M input tokens, $6.00 / 1M output tokens)
    const inputCost = 0.0000015;
    const outputCost = 0.000006;
    return promptTokens * inputCost + completionTokens * outputCost;
  }

  getCost(provider = "", model = "", promptTokens = 0, completionTokens = 0) {
    const lowerProvider = String(provider).toLowerCase();
    const localProviders = [
      "ollama",
      "localai",
      "lmstudio",
      "koboldcpp",
      "llamacpp",
      "textgenwebui",
      "ollama-agent",
    ];
    if (localProviders.includes(lowerProvider)) {
      return 0;
    }

    const data = this.cachedPrices;
    if (!data) {
      return this.#fallbackCost(promptTokens, completionTokens, provider);
    }

    // 1. Exact model name lookup
    let modelConfig = data[model];

    // 2. Try prefix provider lookup
    if (!modelConfig) {
      modelConfig =
        data[`${provider}/${model}`] || data[`${lowerProvider}/${model}`];
    }

    // 3. Try fuzzy/ends-with search
    if (!modelConfig) {
      const lowerModel = String(model).toLowerCase();
      const matchKey = Object.keys(data).find(
        (k) =>
          k.toLowerCase() === lowerModel ||
          k.toLowerCase().endsWith(`/${lowerModel}`)
      );
      if (matchKey) {
        modelConfig = data[matchKey];
      }
    }

    if (modelConfig) {
      const inputCost = parseFloat(modelConfig.input_cost_per_token || 0);
      const outputCost = parseFloat(modelConfig.output_cost_per_token || 0);
      return promptTokens * inputCost + completionTokens * outputCost;
    }

    return this.#fallbackCost(promptTokens, completionTokens, provider);
  }
}

module.exports = { MODEL_COSTS: new ModelCostFinder() };
