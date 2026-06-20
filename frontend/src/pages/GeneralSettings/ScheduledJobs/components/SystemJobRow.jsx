import { useNavigate } from "react-router-dom";
import { Play } from "@phosphor-icons/react";
import paths from "@/utils/paths";
import { humanizeCron } from "../utils/cron";
import { useTranslation } from "react-i18next";

export default function SystemJobRow({ job, onTrigger, onToggle }) {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const inFlight =
    job.latestRun?.status === "running" || job.latestRun?.status === "queued";

  const statusText = job.latestRun
    ? t(`scheduledJobs.status.${job.latestRun.status}`, job.latestRun.status)
    : t("scheduledJobs.row.neverRun");

  const stop = (handler) => (e) => {
    e.stopPropagation();
    handler();
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigate(paths.settings.systemJobRuns(job.key))}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          navigate(paths.settings.systemJobRuns(job.key));
        }
      }}
      className="flex items-center justify-between px-4 h-14 hover:bg-white/5 light:hover:bg-slate-200 transition-colors cursor-pointer text-left"
      title={t("scheduledJobs.row.viewRuns")}
    >
      <div className="w-[150px] flex flex-col justify-center truncate pr-2">
        <span className="text-sm font-medium text-white light:text-slate-950 truncate">
          {job.name}
        </span>
        <span className="text-xs text-zinc-400 light:text-slate-600 truncate">
          {job.description}
        </span>
      </div>
      <span className="w-[180px] text-sm text-zinc-400 light:text-slate-600 truncate">
        {humanizeCron(job.schedule, i18n.language)}
      </span>
      <span className="w-[120px] text-sm text-zinc-400 light:text-slate-600 truncate">
        {statusText}
      </span>
      <span className="w-[180px] text-sm text-zinc-400 light:text-slate-600 truncate">
        {job.lastRunAt ? new Date(job.lastRunAt).toLocaleString() : "—"}
      </span>
      <span className="w-[180px] text-sm text-zinc-400 light:text-slate-600 truncate">
        {job.enabled && job.nextRunAt
          ? new Date(job.nextRunAt).toLocaleString()
          : "—"}
      </span>
      <div className="w-[140px] flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={stop(() => onTrigger(job.key))}
          disabled={!job.enabled || inFlight}
          className="border-none p-2 rounded-full text-zinc-400 light:text-slate-950 hover:text-white light:hover:text-slate-700 hover:bg-white/10 light:hover:bg-slate-300/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent cursor-pointer"
          title={t("scheduledJobs.row.runNow")}
        >
          <Play className="h-4 w-4 shrink-0" />
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={job.enabled}
          onClick={stop(() => onToggle(job.key))}
          title={
            job.enabled
              ? t("scheduledJobs.row.disable")
              : t("scheduledJobs.row.enable")
          }
          className={`border-none relative h-[15px] w-7 rounded-full p-0.5 transition-colors cursor-pointer ${
            job.enabled ? "bg-green-400" : "bg-zinc-600 light:bg-slate-300"
          }`}
        >
          <span
            className={`block h-3 w-3 rounded-full bg-white shadow transition-transform ${
              job.enabled ? "translate-x-[13px]" : "translate-x-0"
            }`}
          />
        </button>
      </div>
    </div>
  );
}
