import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

const SystemJobs = {
  list: async function () {
    return await fetch(`${API_BASE}/system-jobs`, {
      headers: baseHeaders(),
    })
      .then((res) => res.json())
      .catch(() => ({ jobs: [] }));
  },

  toggle: async function (key) {
    return await fetch(
      `${API_BASE}/system-jobs/${encodeURIComponent(key)}/toggle`,
      {
        method: "POST",
        headers: baseHeaders(),
      }
    )
      .then((res) => res.json())
      .catch(() => ({ success: false }));
  },

  trigger: async function (key) {
    return await fetch(
      `${API_BASE}/system-jobs/${encodeURIComponent(key)}/trigger`,
      {
        method: "POST",
        headers: baseHeaders(),
      }
    )
      .then((res) => res.json())
      .catch((e) => ({ success: false, error: e.message }));
  },

  runs: async function (key) {
    return await fetch(
      `${API_BASE}/system-jobs/${encodeURIComponent(key)}/runs`,
      {
        headers: baseHeaders(),
      }
    )
      .then((res) => res.json())
      .catch(() => ({ runs: [] }));
  },

  getRun: async function (runId) {
    return await fetch(`${API_BASE}/system-jobs/runs/${runId}`, {
      headers: baseHeaders(),
    })
      .then((res) => res.json())
      .catch(() => ({ run: null, config: null }));
  },
};

export default SystemJobs;
