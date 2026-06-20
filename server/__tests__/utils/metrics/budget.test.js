/* eslint-env jest, node */

// Mock SystemSettings model
jest.mock("../../../models/systemSettings", () => {
  const settingsMock = {
    llm_budget_limit: "10.00",
    llm_budget_current: "2.50",
    llm_budget_last_reset: "2026-06-01",
  };
  return {
    SystemSettings: {
      get: jest.fn().mockImplementation(async ({ label }) => {
        return { value: settingsMock[label] || null };
      }),
      _updateSettings: jest.fn().mockImplementation(async (updates) => {
        Object.assign(settingsMock, updates);
        return { success: true, error: null };
      }),
      // Helper to reset the mock state during tests
      __resetMock: (initial = {}) => {
        Object.assign(settingsMock, {
          llm_budget_limit: "10.00",
          llm_budget_current: "2.50",
          llm_budget_last_reset: "2026-06-01",
          ...initial,
        });
      },
      __getMockState: () => settingsMock,
    },
  };
});

const { MODEL_COSTS } = require("../../../utils/metrics/costFinder");
const { BudgetManager } = require("../../../utils/metrics/budget");
const { SystemSettings } = require("../../../models/systemSettings");

describe("Cost & Budget Management", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    SystemSettings.__resetMock();
  });

  describe("ModelCostFinder (costFinder.js)", () => {
    test("calculates zero cost for local/ollama models", () => {
      const costOllama = MODEL_COSTS.getCost("ollama", "llama3", 1000, 500);
      const costLocalAi = MODEL_COSTS.getCost("localai", "gpt-4", 1000, 500);
      expect(costOllama).toBe(0);
      expect(costLocalAi).toBe(0);
    });

    test("uses fallback pricing for unknown models/providers", () => {
      // Input fallback: $1.50/1M = 0.0000015
      // Output fallback: $6.00/1M = 0.000006
      // 1000 input tokens = 0.0015
      // 500 output tokens = 0.003
      // Expected = 0.0045
      const cost = MODEL_COSTS.getCost("unknown-provider", "unknown-model", 1000, 500);
      expect(cost).toBeCloseTo(0.0045, 6);
    });
  });

  describe("BudgetManager (budget.js)", () => {
    test("retrieves settings correctly", async () => {
      const settings = await BudgetManager.getSettings();
      expect(settings).toEqual({
        limit: 10.00,
        current: 2.50,
        lastReset: "2026-06-01",
      });
    });

    test("sets budget limit", async () => {
      await BudgetManager.setLimit("15.50");
      expect(SystemSettings._updateSettings).toHaveBeenCalledWith({
        llm_budget_limit: "15.5",
      });
      const settings = await BudgetManager.getSettings();
      expect(settings.limit).toBe(15.5);
    });

    test("resets budget", async () => {
      await BudgetManager.resetBudget();
      const state = SystemSettings.__getMockState();
      expect(state.llm_budget_current).toBe("0");
      expect(state.llm_budget_last_reset).toBe(new Date().toISOString().split("T")[0]);
    });

    test("does not report exceeded budget when limit is 0 (disabled)", async () => {
      SystemSettings.__resetMock({ llm_budget_limit: "0.00", llm_budget_current: "10.00" });
      const exceeded = await BudgetManager.checkBudgetExceeded();
      expect(exceeded).toBe(false);
    });

    test("reports exceeded budget when limit is reached or exceeded", async () => {
      SystemSettings.__resetMock({ llm_budget_limit: "10.00", llm_budget_current: "9.99" });
      expect(await BudgetManager.checkBudgetExceeded()).toBe(false);

      SystemSettings.__resetMock({ llm_budget_limit: "10.00", llm_budget_current: "10.00" });
      expect(await BudgetManager.checkBudgetExceeded()).toBe(true);

      SystemSettings.__resetMock({ llm_budget_limit: "10.00", llm_budget_current: "12.50" });
      expect(await BudgetManager.checkBudgetExceeded()).toBe(true);
    });

    test("records token cost and increments budget current usage", async () => {
      SystemSettings.__resetMock({ llm_budget_current: "2.50" });
      // 1000 input, 500 output = 0.0045 cost
      const cost = await BudgetManager.recordCallCost("openai", "gpt-4-fallback", 1000, 500);
      expect(cost).toBeCloseTo(0.0045, 6);

      const state = SystemSettings.__getMockState();
      expect(parseFloat(state.llm_budget_current)).toBeCloseTo(2.5045, 6);
    });

    test("resets budget automatically at the start of a new calendar month", async () => {
      // Last reset was in June 2026
      SystemSettings.__resetMock({
        llm_budget_last_reset: "2026-06-01",
        llm_budget_current: "8.50",
      });

      // Mock current date to July 2026
      const realDate = global.Date;
      const mockDate = new Date("2026-07-02T12:00:00Z");
      global.Date = class extends realDate {
        constructor(...args) {
          if (args.length) return new realDate(...args);
          return mockDate;
        }
        static now() {
          return mockDate.getTime();
        }
      };

      try {
        const exceeded = await BudgetManager.checkBudgetExceeded();
        expect(exceeded).toBe(false); // Should have reset to 0, which is < limit (10)

        const state = SystemSettings.__getMockState();
        expect(state.llm_budget_current).toBe("0");
        expect(state.llm_budget_last_reset).toBe("2026-07-02");
      } finally {
        global.Date = realDate;
      }
    });
  });
});
