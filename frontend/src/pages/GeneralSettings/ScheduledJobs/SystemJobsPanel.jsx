import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import SystemJobs from "@/models/systemJobs";
import Admin from "@/models/admin";
import usePolling from "@/hooks/usePolling";
import showToast from "@/utils/toast";
import SystemJobRow from "./components/SystemJobRow";

export default function SystemJobsPanel() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState([]);
  const [retentionDays, setRetentionDays] = useState(30);
  const [workspaceRetentionDays, setWorkspaceRetentionDays] = useState(30);
  const [tempCleanupEnabled, setTempCleanupEnabled] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingWorkspaceSettings, setSavingWorkspaceSettings] = useState(false);
  const [savingTempCleanup, setSavingTempCleanup] = useState(false);

  const fetchJobs = async () => {
    const { jobs: foundJobs } = await SystemJobs.list();
    setJobs(foundJobs || []);
    setLoading(false);
  };

  const fetchRetentionDays = async () => {
    try {
      const { settings } = await Admin.systemPreferencesByFields([
        "inactive_chat_retention_days",
        "inactive_workspace_retention_days",
        "temp_workspace_cleanup_enabled",
      ]);
      if (settings?.inactive_chat_retention_days !== undefined) {
        setRetentionDays(Number(settings.inactive_chat_retention_days));
      }
      if (settings?.inactive_workspace_retention_days !== undefined) {
        setWorkspaceRetentionDays(
          Number(settings.inactive_workspace_retention_days)
        );
      }
      if (settings?.temp_workspace_cleanup_enabled !== undefined) {
        setTempCleanupEnabled(
          settings.temp_workspace_cleanup_enabled === "true"
        );
      }
    } catch (e) {
      console.error("Failed to fetch retention days setting", e);
    }
  };

  useEffect(() => {
    fetchJobs();
    fetchRetentionDays();
  }, []);

  usePolling(fetchJobs, 5000);

  const handleToggle = async (key) => {
    const result = await SystemJobs.toggle(key);
    if (result?.success) {
      showToast(t("scheduledJobs.systemJobs.toast.toggled"), "success", {
        clear: true,
      });
    } else {
      showToast("Failed to toggle system job", "error", { clear: true });
    }
    fetchJobs();
  };

  const handleTrigger = async (key) => {
    const { success, skipped, error } = await SystemJobs.trigger(key);
    if (!success) {
      showToast(
        error || t("scheduledJobs.systemJobs.toast.triggerFailed"),
        "error",
        { clear: true }
      );
    } else if (skipped) {
      showToast(t("scheduledJobs.systemJobs.toast.triggerSkipped"), "info", {
        clear: true,
      });
    } else {
      showToast(t("scheduledJobs.systemJobs.toast.triggered"), "success", {
        clear: true,
      });
    }
    fetchJobs();
  };

  const handleUpdateRetention = async (days) => {
    setSavingSettings(true);
    const result = await Admin.updateSystemPreferences({
      inactive_chat_retention_days: Number(days),
    });
    setSavingSettings(false);
    if (result?.success) {
      setRetentionDays(Number(days));
      showToast(
        t(
          "scheduledJobs.systemJobs.toast.retentionSaved",
          "Auto-delete retention period updated successfully."
        ),
        "success",
        { clear: true }
      );
      fetchJobs();
    } else {
      showToast(
        result?.error || "Failed to update retention period.",
        "error",
        { clear: true }
      );
    }
  };

  const handleUpdateWorkspaceRetention = async (days) => {
    setSavingWorkspaceSettings(true);
    const result = await Admin.updateSystemPreferences({
      inactive_workspace_retention_days: Number(days),
    });
    setSavingWorkspaceSettings(false);
    if (result?.success) {
      setWorkspaceRetentionDays(Number(days));
      showToast(
        t(
          "scheduledJobs.systemJobs.toast.workspaceRetentionSaved",
          "Auto-delete workspace retention period updated successfully."
        ),
        "success",
        { clear: true }
      );
      fetchJobs();
    } else {
      showToast(
        result?.error || "Failed to update workspace retention period.",
        "error",
        { clear: true }
      );
    }
  };

  const handleUpdateTempCleanup = async (enabled) => {
    setSavingTempCleanup(true);
    const result = await Admin.updateSystemPreferences({
      temp_workspace_cleanup_enabled: enabled ? "true" : "false",
    });
    setSavingTempCleanup(false);
    if (result?.success) {
      setTempCleanupEnabled(enabled);
      showToast(
        t(
          "scheduledJobs.systemJobs.toast.tempCleanupSaved",
          "Temporary workspace cleanup setting updated successfully."
        ),
        "success",
        { clear: true }
      );
      fetchJobs();
    } else {
      showToast(
        result?.error ||
          "Failed to update temporary workspace cleanup setting.",
        "error",
        { clear: true }
      );
    }
  };

  if (loading) {
    return (
      <div className="w-full flex items-center justify-center text-zinc-400 light:text-slate-600 text-sm pt-8">
        {t("scheduledJobs.loading")}
      </div>
    );
  }

  const hasCleanupJob = jobs.some(
    (job) => job.key === "cleanup-inactive-chat-threads"
  );
  const hasWorkspaceCleanupJob = jobs.some(
    (job) => job.key === "cleanup-inactive-workspaces"
  );

  return (
    <div className="pt-8">
      {(hasCleanupJob || hasWorkspaceCleanupJob) && (
        <div className="flex flex-col md:flex-row gap-6 mb-6">
          {hasCleanupJob && (
            <div className="flex-1 p-6 rounded-xl bg-white/5 light:bg-slate-50 border border-white/10 light:border-slate-200">
              <div className="flex flex-col gap-y-1">
                <h3 className="text-sm font-semibold text-white light:text-slate-900">
                  {t(
                    "scheduledJobs.systemJobs.retention.title",
                    "Auto-delete Old Chat Rooms"
                  )}
                </h3>
                <p className="text-xs text-zinc-400 light:text-slate-600 mb-4">
                  {t(
                    "scheduledJobs.systemJobs.retention.description",
                    "Automatically delete chat rooms that have been inactive for a certain period of time. This job runs daily."
                  )}
                </p>
              </div>
              <div className="flex items-center gap-x-4">
                <select
                  value={retentionDays}
                  onChange={(e) =>
                    handleUpdateRetention(Number(e.target.value))
                  }
                  disabled={savingSettings}
                  className="border-none bg-theme-settings-input-bg text-white placeholder:text-theme-settings-input-placeholder text-sm rounded-lg focus:outline-primary-button active:outline-primary-button outline-none block w-fit py-2 px-4 cursor-pointer"
                >
                  <option value={1}>
                    {t("scheduledJobs.systemJobs.retention.oneDay", "1 Day")}
                  </option>
                  <option value={7}>
                    {t("scheduledJobs.systemJobs.retention.oneWeek", "1 Week")}
                  </option>
                  <option value={30}>
                    {t(
                      "scheduledJobs.systemJobs.retention.oneMonth",
                      "1 Month"
                    )}
                  </option>
                </select>
              </div>
            </div>
          )}

          {hasWorkspaceCleanupJob && (
            <div className="flex-1 p-6 rounded-xl bg-white/5 light:bg-slate-50 border border-white/10 light:border-slate-200">
              <div className="flex flex-col gap-y-1">
                <h3 className="text-sm font-semibold text-white light:text-slate-900">
                  {t(
                    "scheduledJobs.systemJobs.workspaceRetention.title",
                    "Auto-delete Old Workspaces"
                  )}
                </h3>
                <p className="text-xs text-zinc-400 light:text-slate-600 mb-4">
                  {t(
                    "scheduledJobs.systemJobs.workspaceRetention.description",
                    "Automatically delete workspaces that have been inactive for a certain period of time. This job runs daily."
                  )}
                </p>
              </div>
              <div className="flex items-center gap-x-4">
                <select
                  value={workspaceRetentionDays}
                  onChange={(e) =>
                    handleUpdateWorkspaceRetention(Number(e.target.value))
                  }
                  disabled={savingWorkspaceSettings}
                  className="border-none bg-theme-settings-input-bg text-white placeholder:text-theme-settings-input-placeholder text-sm rounded-lg focus:outline-primary-button active:outline-primary-button outline-none block w-fit py-2 px-4 cursor-pointer"
                >
                  <option value={1}>
                    {t("scheduledJobs.systemJobs.retention.oneDay", "1 Day")}
                  </option>
                  <option value={7}>
                    {t("scheduledJobs.systemJobs.retention.oneWeek", "1 Week")}
                  </option>
                  <option value={30}>
                    {t(
                      "scheduledJobs.systemJobs.retention.oneMonth",
                      "1 Month"
                    )}
                  </option>
                </select>
              </div>
            </div>
          )}

          <div className="flex-1 p-6 rounded-xl bg-white/5 light:bg-slate-50 border border-white/10 light:border-slate-200">
            <div className="flex flex-col gap-y-1">
              <h3 className="text-sm font-semibold text-white light:text-slate-900">
                {t(
                  "scheduledJobs.systemJobs.tempCleanup.title",
                  "Auto-delete Temp Workspaces"
                )}
              </h3>
              <p className="text-xs text-zinc-400 light:text-slate-600 mb-4">
                {t(
                  "scheduledJobs.systemJobs.tempCleanup.description",
                  "Automatically delete temporary workspaces created via the developer API after 24 hours."
                )}
              </p>
            </div>
            <div className="flex items-center gap-x-4">
              <select
                value={tempCleanupEnabled ? "true" : "false"}
                onChange={(e) =>
                  handleUpdateTempCleanup(e.target.value === "true")
                }
                disabled={savingTempCleanup}
                className="border-none bg-theme-settings-input-bg text-white placeholder:text-theme-settings-input-placeholder text-sm rounded-lg focus:outline-primary-button active:outline-primary-button outline-none block w-fit py-2 px-4 cursor-pointer"
              >
                <option value="true">
                  {t("scheduledJobs.systemJobs.tempCleanup.enabled", "Enabled")}
                </option>
                <option value="false">
                  {t(
                    "scheduledJobs.systemJobs.tempCleanup.disabled",
                    "Disabled"
                  )}
                </option>
              </select>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between px-4 pb-[18px] text-xs font-semibold uppercase tracking-[1.4px] text-zinc-400 light:text-slate-600">
        <span className="w-[150px]">{t("scheduledJobs.table.name")}</span>
        <span className="w-[180px]">{t("scheduledJobs.table.schedule")}</span>
        <span className="w-[120px]">{t("scheduledJobs.table.status")}</span>
        <span className="w-[180px]">{t("scheduledJobs.table.lastRun")}</span>
        <span className="w-[180px]">{t("scheduledJobs.table.nextRun")}</span>
        <span className="w-[140px] text-right">
          {t("scheduledJobs.table.actions")}
        </span>
      </div>
      <div className="h-px w-full bg-white/10 light:bg-slate-300" />

      {jobs.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-8 py-24 text-center">
          <div className="flex flex-col gap-1.5">
            <p className="text-base font-semibold text-zinc-50 light:text-slate-950">
              {t("scheduledJobs.systemJobs.emptyTitle")}
            </p>
            <p className="text-sm font-medium text-zinc-400 light:text-slate-600">
              {t("scheduledJobs.systemJobs.emptySubtitle")}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-white/5 light:divide-slate-300">
          {jobs.map((job) => (
            <SystemJobRow
              key={job.key}
              job={job}
              onTrigger={handleTrigger}
              onToggle={handleToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}
