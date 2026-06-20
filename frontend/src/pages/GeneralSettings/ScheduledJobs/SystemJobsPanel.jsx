import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import SystemJobs from "@/models/systemJobs";
import usePolling from "@/hooks/usePolling";
import showToast from "@/utils/toast";
import SystemJobRow from "./components/SystemJobRow";

export default function SystemJobsPanel() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState([]);

  const fetchJobs = async () => {
    const { jobs: foundJobs } = await SystemJobs.list();
    setJobs(foundJobs || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchJobs();
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

  if (loading) {
    return (
      <div className="w-full flex items-center justify-center text-zinc-400 light:text-slate-600 text-sm pt-8">
        {t("scheduledJobs.loading")}
      </div>
    );
  }

  return (
    <div className="pt-8">
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
