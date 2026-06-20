import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Sidebar from "@/components/SettingsSidebar";
import { isMobile } from "react-device-detect";
import { ArrowLeft } from "@phosphor-icons/react";
import SystemJobs from "@/models/systemJobs";
import usePolling from "@/hooks/usePolling";
import paths from "@/utils/paths";
import StatusBadge from "./components/StatusBadge";
import moment from "moment";
import { formatDuration } from "@/utils/numbers";

export default function SystemRunDetailPage() {
  const { t } = useTranslation();
  const { jobKey, runId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [run, setRun] = useState(null);
  const [config, setConfig] = useState(null);

  const fetchRun = async () => {
    const data = await SystemJobs.getRun(runId);
    setRun(data.run);
    setConfig(data.config);
    setLoading(false);
  };

  useEffect(() => {
    fetchRun();
  }, [runId]);

  const isNonTerminal = run?.status === "running" || run?.status === "queued";
  usePolling(fetchRun, 3000, isNonTerminal);

  if (loading) {
    return (
      <RunDetailLayout>
        <p className="text-zinc-400 light:text-slate-600 text-sm">
          {t("scheduledJobs.loading")}
        </p>
      </RunDetailLayout>
    );
  }

  if (!run) {
    return (
      <RunDetailLayout>
        <p className="text-zinc-400 light:text-slate-600 text-sm">
          Run not found
        </p>
      </RunDetailLayout>
    );
  }

  function formatRunDuration(run) {
    if (!run.completedAt || !run.startedAt) return "—";
    const duration = moment.duration(
      moment(run.completedAt).diff(moment(run.startedAt))
    );
    return formatDuration(duration.asSeconds());
  }

  const parsedResult = run.result ? JSON.parse(run.result) : null;

  return (
    <RunDetailLayout>
      <div className="w-full flex flex-col gap-y-2 pb-6 border-white/10 light:border-slate-300 border-b-2">
        <button
          type="button"
          onClick={() => navigate(paths.settings.systemJobRuns(jobKey))}
          className="border-none flex items-center gap-2 text-zinc-400 light:text-slate-600 hover:text-zinc-50 light:hover:text-slate-950 text-sm transition-colors w-fit cursor-pointer bg-transparent"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("scheduledJobs.runHistory.back")}
        </button>
        <div className="flex items-center justify-between">
          <p className="text-lg leading-7 font-semibold text-zinc-50 light:text-slate-950">
            {config?.jobKey || jobKey} - Run #{run.id}
          </p>
          <StatusBadge status={run.status} />
        </div>
        <p className="text-xs text-zinc-400 light:text-slate-600">
          Triggered via: <code className="capitalize">{run.trigger}</code> |
          Duration: <code>{formatRunDuration(run)}</code>
        </p>
      </div>

      <div className="mt-6 space-y-4">
        {/* Error Section */}
        {run.error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-red-400 mb-1">
              Execution Error
            </h3>
            <p className="text-sm text-red-300 font-mono break-all whitespace-pre-wrap">
              {run.error}
            </p>
          </div>
        )}

        {/* Result Summary Section */}
        {parsedResult && (
          <div className="bg-zinc-800/50 light:bg-slate-100 border border-white/10 light:border-slate-300 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-white light:text-slate-950 mb-2">
              Execution Result
            </h3>
            <pre className="text-xs text-zinc-300 light:text-slate-700 font-mono overflow-x-auto whitespace-pre-wrap max-h-60">
              {JSON.stringify(parsedResult, null, 2)}
            </pre>
          </div>
        )}

        {/* Logs Section */}
        <div className="bg-zinc-900 border border-white/10 light:border-slate-300 rounded-lg p-4 flex flex-col gap-y-2">
          <h3 className="text-sm font-semibold text-white light:text-slate-200">
            Execution Logs
          </h3>
          <div className="h-[400px] overflow-y-auto bg-black rounded p-3 font-mono text-xs text-green-400 whitespace-pre-wrap scrollbar-thin">
            {run.logs || "No logs generated during this run."}
          </div>
        </div>
      </div>
    </RunDetailLayout>
  );
}

function RunDetailLayout({ children }) {
  return (
    <div className="w-screen h-screen overflow-hidden bg-theme-bg-container flex">
      <Sidebar />
      <div
        style={{ height: isMobile ? "100%" : "calc(100% - 32px)" }}
        className="relative md:ml-[2px] md:mr-[16px] md:my-[16px] md:rounded-[16px] bg-theme-bg-secondary w-full h-full overflow-y-scroll p-4 md:p-0"
      >
        <div className="flex flex-col w-full px-1 md:pl-6 md:pr-[50px] md:py-6 py-16">
          {children}
        </div>
      </div>
    </div>
  );
}
