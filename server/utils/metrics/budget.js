const { SystemSettings } = require("../../models/systemSettings");
const { MODEL_COSTS } = require("./costFinder");

const BudgetManager = {
  getSettings: async function () {
    const limitSetting = await SystemSettings.get({
      label: "llm_budget_limit",
    });
    const currentSetting = await SystemSettings.get({
      label: "llm_budget_current",
    });
    const lastResetSetting = await SystemSettings.get({
      label: "llm_budget_last_reset",
    });

    const limit = parseFloat(limitSetting?.value || "0");
    const current = parseFloat(currentSetting?.value || "0");
    const lastReset =
      lastResetSetting?.value || new Date().toISOString().split("T")[0];

    return { limit, current, lastReset };
  },

  checkAndResetBudget: async function () {
    try {
      const { lastReset } = await this.getSettings();

      const lastResetDate = new Date(lastReset);
      const currentDate = new Date();

      const currentYear = currentDate.getFullYear();
      const currentMonth = currentDate.getMonth();

      const lastResetYear = lastResetDate.getFullYear();
      const lastResetMonth = lastResetDate.getMonth();

      // Reset on the start of a new calendar month
      const isNewMonth =
        currentYear > lastResetYear ||
        (currentYear === lastResetYear && currentMonth > lastResetMonth);

      if (isNewMonth) {
        const todayStr = currentDate.toISOString().split("T")[0];
        await SystemSettings._updateSettings({
          llm_budget_current: "0",
          llm_budget_last_reset: todayStr,
        });
        console.log(
          `[BudgetManager] Monthly budget reset triggered. Usage reset to 0 USD.`
        );
        return true;
      }
    } catch (err) {
      console.error(
        "[BudgetManager] Failed to check and reset budget:",
        err.message
      );
    }
    return false;
  },

  checkBudgetExceeded: async function () {
    try {
      const { limit, current } = await this.getSettings();
      if (limit <= 0) return false;

      // Perform inline reset check if a new month has arrived
      const didReset = await this.checkAndResetBudget();
      if (didReset) {
        return false;
      }

      return current >= limit;
    } catch (err) {
      console.error(
        "[BudgetManager] Error checking budget status:",
        err.message
      );
      return false;
    }
  },

  recordCallCost: async function (
    provider,
    model,
    promptTokens,
    completionTokens
  ) {
    try {
      const cost = MODEL_COSTS.getCost(
        provider,
        model,
        promptTokens,
        completionTokens
      );
      if (cost <= 0) return 0;

      const { current } = await this.getSettings();
      const newUsage = current + cost;

      await SystemSettings._updateSettings({
        llm_budget_current: String(newUsage),
      });

      return cost;
    } catch (err) {
      console.error("[BudgetManager] Failed to record call cost:", err.message);
      return 0;
    }
  },

  resetBudget: async function () {
    const todayStr = new Date().toISOString().split("T")[0];
    await SystemSettings._updateSettings({
      llm_budget_current: "0",
      llm_budget_last_reset: todayStr,
    });
    return true;
  },

  setLimit: async function (limit) {
    const limitVal = parseFloat(limit);
    if (isNaN(limitVal) || limitVal < 0) {
      throw new Error("Invalid budget limit. Must be a positive number.");
    }
    await SystemSettings._updateSettings({
      llm_budget_limit: String(limitVal),
    });
    return true;
  },
};

module.exports = { BudgetManager };
