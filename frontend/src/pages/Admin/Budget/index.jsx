import { useEffect, useState } from "react";
import Sidebar from "@/components/SettingsSidebar";
import { isMobile } from "react-device-detect";
import Admin from "@/models/admin";
import CTAButton from "@/components/lib/CTAButton";
import { CurrencyDollar, ArrowsCounterClockwise } from "@phosphor-icons/react";

export default function AdminBudget() {
  const [loading, setLoading] = useState(true);
  const [budget, setBudget] = useState({ limit: 0, current: 0, lastReset: "" });
  const [newLimit, setNewLimit] = useState("");
  const [status, setStatus] = useState({ type: "", message: "" });
  const [updating, setUpdating] = useState(false);

  const fetchBudget = async () => {
    const res = await Admin.getBudget();
    if (res?.success && res.budget) {
      setBudget(res.budget);
      setNewLimit(String(res.budget.limit));
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchBudget();
  }, []);

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    setUpdating(true);
    setStatus({ type: "", message: "" });

    const limitVal = parseFloat(newLimit);
    if (isNaN(limitVal) || limitVal < 0) {
      setStatus({ type: "error", message: "Limit must be a positive number." });
      setUpdating(false);
      return;
    }

    const res = await Admin.updateBudgetLimit(limitVal);
    if (res?.success) {
      setStatus({
        type: "success",
        message: "Budget settings updated successfully.",
      });
      fetchBudget();
    } else {
      setStatus({
        type: "error",
        message: res?.error || "Failed to update budget settings.",
      });
    }
    setUpdating(false);
  };

  const handleResetBudget = async () => {
    if (
      !window.confirm(
        "Are you sure you want to reset current month cost to $0.00?"
      )
    ) {
      return;
    }
    setUpdating(true);
    setStatus({ type: "", message: "" });

    const res = await Admin.resetBudget();
    if (res?.success) {
      setStatus({
        type: "success",
        message: "Budget usage reset successfully.",
      });
      fetchBudget();
    } else {
      setStatus({
        type: "error",
        message: res?.error || "Failed to reset budget.",
      });
    }
    setUpdating(false);
  };

  const percentUsed =
    budget.limit > 0 ? Math.min((budget.current / budget.limit) * 100, 100) : 0;
  const progressColor =
    percentUsed >= 90
      ? "bg-red-500"
      : percentUsed >= 75
        ? "bg-amber-500"
        : "bg-green-500";

  return (
    <div className="w-screen h-screen overflow-hidden bg-theme-bg-container flex">
      <Sidebar />
      <div
        style={{ height: isMobile ? "100%" : "calc(100% - 32px)" }}
        className="relative md:ml-[2px] md:mr-[16px] md:my-[16px] md:rounded-[16px] bg-theme-bg-secondary w-full h-full overflow-y-scroll p-4 md:p-0"
      >
        <div className="flex flex-col w-full px-1 md:pl-6 md:pr-[50px] md:py-6 py-16">
          <div className="w-full flex flex-col gap-y-1 pb-6 border-white/10 border-b-2">
            <div className="items-center flex gap-x-4">
              <p className="text-lg leading-6 font-bold text-theme-text-primary">
                Cost & Budget Management
              </p>
            </div>
            <p className="text-xs leading-[18px] font-base text-theme-text-secondary mt-2">
              Track your LLM cost in real-time, configure monthly budgets, and
              prevent API bill shock with a system-wide circuit breaker.
            </p>
          </div>

          {loading ? (
            <div className="w-full py-10 flex justify-center text-theme-text-secondary text-sm">
              Loading budget configurations...
            </div>
          ) : (
            <div className="mt-6 flex flex-col gap-y-6 max-w-[600px]">
              {status.message && (
                <div
                  className={`p-3 rounded-lg text-sm ${
                    status.type === "success"
                      ? "bg-green-500/10 text-green-400 border border-green-500/20"
                      : "bg-red-500/10 text-red-400 border border-red-500/20"
                  }`}
                >
                  {status.message}
                </div>
              )}

              {/* Stat Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-theme-bg-primary border border-white/5 rounded-xl p-5 flex flex-col gap-y-1">
                  <p className="text-xs text-theme-text-secondary font-medium uppercase tracking-wider">
                    Current Monthly Cost
                  </p>
                  <p className="text-3xl font-bold text-theme-text-primary">
                    ${budget.current.toFixed(4)} USD
                  </p>
                  <p className="text-[10px] text-theme-text-secondary">
                    Last reset date: {budget.lastReset}
                  </p>
                </div>

                <div className="bg-theme-bg-primary border border-white/5 rounded-xl p-5 flex flex-col gap-y-1">
                  <p className="text-xs text-theme-text-secondary font-medium uppercase tracking-wider">
                    Monthly Budget Limit
                  </p>
                  <p className="text-3xl font-bold text-theme-text-primary">
                    {budget.limit > 0
                      ? `$${budget.limit.toFixed(2)} USD`
                      : "No Limit"}
                  </p>
                  <p className="text-[10px] text-theme-text-secondary">
                    Circuit breaker: {budget.limit > 0 ? "ENABLED" : "DISABLED"}
                  </p>
                </div>
              </div>

              {/* Progress Bar (Only visible if limit is set) */}
              {budget.limit > 0 && (
                <div className="bg-theme-bg-primary border border-white/5 rounded-xl p-5 flex flex-col gap-y-3">
                  <div className="flex justify-between items-center text-xs font-semibold text-theme-text-secondary">
                    <span>Budget Utilized</span>
                    <span>{percentUsed.toFixed(1)}%</span>
                  </div>
                  <div className="w-full bg-white/10 rounded-full h-3.5 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${progressColor}`}
                      style={{ width: `${percentUsed}%` }}
                    />
                  </div>
                  {percentUsed >= 100 && (
                    <p className="text-[11px] text-red-400 font-semibold mt-1">
                      ⚠️ Circuit breaker active! LLM calls are blocked until
                      budget is reset or limit is increased.
                    </p>
                  )}
                </div>
              )}

              {/* Settings Form */}
              <form
                onSubmit={handleSaveSettings}
                className="bg-theme-bg-primary border border-white/5 rounded-xl p-5 flex flex-col gap-y-4"
              >
                <p className="text-sm font-semibold text-theme-text-primary">
                  Budget Configuration
                </p>

                <div className="flex flex-col gap-y-2">
                  <label
                    htmlFor="budgetLimit"
                    className="text-xs font-medium text-theme-text-secondary"
                  >
                    Monthly Budget Limit (USD)
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-theme-text-secondary">
                      <CurrencyDollar size={18} />
                    </div>
                    <input
                      id="budgetLimit"
                      type="number"
                      step="0.01"
                      min="0"
                      value={newLimit}
                      onChange={(e) => setNewLimit(e.target.value)}
                      placeholder="e.g. 50.00"
                      className="pl-9 border-none bg-theme-bg-secondary text-theme-text-primary text-sm rounded-lg focus:ring-2 focus:ring-blue-500 block w-full p-2.5 outline-none"
                    />
                  </div>
                  <p className="text-[10px] text-theme-text-secondary">
                    Set to 0 to disable budget limit and the circuit breaker.
                  </p>
                </div>

                <div className="flex items-center justify-between gap-x-4 pt-2 border-t border-white/5">
                  <button
                    type="button"
                    onClick={handleResetBudget}
                    disabled={updating}
                    className="flex items-center gap-x-2 text-xs font-semibold text-red-400 hover:text-red-300 disabled:opacity-50 transition-colors"
                  >
                    <ArrowsCounterClockwise size={14} />
                    Reset Monthly Cost
                  </button>

                  <CTAButton type="submit" disabled={updating}>
                    Save Settings
                  </CTAButton>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
