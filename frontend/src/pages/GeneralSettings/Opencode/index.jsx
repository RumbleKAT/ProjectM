import { useEffect, useState, useRef } from "react";
import Sidebar from "@/components/SettingsSidebar";
import { isMobile } from "react-device-detect";
import {
  Play,
  Terminal,
  CheckCircle,
  Warning,
  Trash,
  Gear,
  Cpu,
  Plug,
  ArrowClockwise,
} from "@phosphor-icons/react";
import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";
import showToast from "@/utils/toast";

export default function GeneralOpencode() {
  const [loading, setLoading] = useState(true);
  const [systemConfig, setSystemConfig] = useState(null);
  const [serverUrl, setServerUrl] = useState("http://localhost:4096");
  const [selectedModel, setSelectedModel] = useState("system-llm");
  const [customModel, setCustomModel] = useState("");
  const [savingModel, setSavingModel] = useState(false);

  // MCP configurations
  const [mcpConfig, setMcpConfig] = useState(null);
  const [opencodeMcpStatus, setOpencodeMcpStatus] = useState(null);
  const [mcpType, setMcpType] = useState("project");
  const [selectedApiKey, setSelectedApiKey] = useState("generate");
  const [anythingllmUrl, setAnythingllmUrl] = useState(window.location.origin);
  const [mcpSaving, setMcpSaving] = useState(false);

  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState([]);
  const [connectionStatus, setConnectionStatus] = useState("checking");
  const terminalEndRef = useRef(null);

  useEffect(() => {
    fetchConfig();
    fetchMCPConfig();
    fetchOpencodeMcpStatus();
  }, []);

  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs]);

  const fetchConfig = async () => {
    try {
      const response = await fetch(`${API_BASE}/opencode/config`, {
        headers: baseHeaders(),
      });
      if (!response.ok) throw new Error("Failed to load configuration.");
      const data = await response.json();
      if (data.success) {
        setSystemConfig(data);
        if (data.serverUrl) setServerUrl(data.serverUrl);
        if (data.selectedModel) setSelectedModel(data.selectedModel);
        if (data.customModel) setCustomModel(data.customModel);
        checkServerConnection(data.serverUrl);
      } else {
        showToast("Error loading system settings.", "error");
      }
    } catch (e) {
      console.error(e);
      showToast(e.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const fetchMCPConfig = async () => {
    try {
      const response = await fetch(`${API_BASE}/opencode/mcp`, {
        headers: baseHeaders(),
      });
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setMcpConfig(data);
        }
      }
    } catch (e) {
      console.error("Failed to fetch MCP config:", e);
    }
  };

  const fetchOpencodeMcpStatus = async () => {
    try {
      const response = await fetch(`${API_BASE}/opencode/mcp-status`, {
        headers: baseHeaders(),
      });
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setOpencodeMcpStatus(data.mcpStatus || {});
        }
      }
    } catch (e) {
      console.error("Failed to fetch OpenCode MCP status:", e);
    }
  };

  const checkServerConnection = async (urlToTest) => {
    setConnectionStatus("checking");
    try {
      const response = await fetch(
        `${API_BASE}/opencode/check-connection?url=${encodeURIComponent(
          urlToTest
        )}`,
        {
          headers: baseHeaders(),
        }
      );
      if (!response.ok) throw new Error("Connection check failed");
      const data = await response.json();
      if (data.success && data.connected) {
        setConnectionStatus("connected");
      } else {
        setConnectionStatus("disconnected");
      }
    } catch (e) {
      setConnectionStatus("disconnected");
    }
  };

  const handleSaveModel = async () => {
    setSavingModel(true);
    try {
      const response = await fetch(`${API_BASE}/opencode/config`, {
        method: "POST",
        headers: {
          ...baseHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          selectedModel,
          customModel,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to save model configuration.");
      }

      showToast("Model configuration saved successfully!", "success");
    } catch (e) {
      console.error(e);
      showToast(e.message, "error");
    } finally {
      setSavingModel(false);
    }
  };

  const handleRunAgent = async (e) => {
    e.preventDefault();
    if (!prompt.trim()) return;

    setRunning(true);
    setLogs((prev) => [
      ...prev,
      {
        type: "system",
        text: "Starting session: [Mode: OpenCode Agent via SDK]",
        time: new Date().toLocaleTimeString(),
      },
      {
        type: "input",
        text: prompt,
        time: new Date().toLocaleTimeString(),
      },
    ]);

    const targetUrl = `${API_BASE}/opencode/chat`;
    const targetModel =
      selectedModel === "custom" ? customModel : selectedModel;

    try {
      const response = await fetch(targetUrl, {
        method: "POST",
        headers: {
          ...baseHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt,
          serverUrl,
          model: targetModel,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.error || `Request failed with code ${response.status}`
        );
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const dataStr = line.slice(6);
            const parsed = JSON.parse(dataStr);

            if (parsed.type === "message") {
              setLogs((prev) => {
                if (
                  prev.length > 0 &&
                  prev[prev.length - 1].type === "message"
                ) {
                  const updated = [...prev];
                  updated[updated.length - 1] = {
                    ...updated[updated.length - 1],
                    text: updated[updated.length - 1].text + parsed.text,
                  };
                  return updated;
                } else {
                  return [...prev, { type: "message", text: parsed.text }];
                }
              });
            } else if (parsed.type === "reasoning") {
              setLogs((prev) => {
                if (
                  prev.length > 0 &&
                  prev[prev.length - 1].type === "reasoning"
                ) {
                  const updated = [...prev];
                  updated[updated.length - 1] = {
                    ...updated[updated.length - 1],
                    text: updated[updated.length - 1].text + parsed.text,
                  };
                  return updated;
                } else {
                  return [...prev, { type: "reasoning", text: parsed.text }];
                }
              });
            } else if (parsed.type === "file_diff") {
              setLogs((prev) => [
                ...prev,
                {
                  type: "file_diff",
                  text: `File modified: ${parsed.data?.filePath || ""}`,
                  diff: parsed.data,
                },
              ]);
            } else if (parsed.type === "error") {
              setLogs((prev) => [
                ...prev,
                { type: "error", text: parsed.text },
              ]);
            } else {
              setLogs((prev) => [
                ...prev,
                { type: "info", text: JSON.stringify(parsed) },
              ]);
            }
          } catch (err) {
            console.error("Failed to parse chunk:", err, line);
          }
        }
      }

      setLogs((prev) => [
        ...prev,
        {
          type: "system",
          text: "Session completed successfully.",
          time: new Date().toLocaleTimeString(),
        },
      ]);
      setPrompt("");
    } catch (err) {
      console.error(err);
      setLogs((prev) => [
        ...prev,
        {
          type: "error",
          text: `Execution failed: ${err.message}`,
          time: new Date().toLocaleTimeString(),
        },
      ]);
      showToast(err.message, "error");
    } finally {
      setRunning(false);
    }
  };

  const handleSaveMCP = async (e) => {
    e.preventDefault();
    setMcpSaving(true);
    try {
      const response = await fetch(`${API_BASE}/opencode/mcp`, {
        method: "POST",
        headers: {
          ...baseHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          apiKey: selectedApiKey,
          anythingllmUrl,
          type: mcpType,
        }),
      });

      if (!response.ok) throw new Error("Failed to register MCP server.");
      const data = await response.json();
      if (data.success) {
        showToast("AnythingLLM MCP Server registered successfully!", "success");
        fetchMCPConfig();
        fetchOpencodeMcpStatus();
      } else {
        showToast(data.error || "Failed to register MCP server.", "error");
      }
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setMcpSaving(false);
    }
  };

  const clearLogs = () => {
    setLogs([]);
  };

  // Helper to check if anythingllm is registered as an MCP server
  const getMCPStatus = () => {
    if (!mcpConfig) return { status: "not_registered", text: "Checking..." };

    const isGlobalReg = mcpConfig.globalConfig?.mcpServers?.anythingllm;
    const isProjectReg = mcpConfig.projectConfig?.mcpServers?.anythingllm;

    if (isGlobalReg && isProjectReg) {
      return { status: "both", text: "Registered (Global & Project)" };
    } else if (isProjectReg) {
      return { status: "project", text: "Registered (Project)" };
    } else if (isGlobalReg) {
      return { status: "global", text: "Registered (Global)" };
    }

    return { status: "not_registered", text: "Not Registered" };
  };

  const mcpStatus = getMCPStatus();

  return (
    <div className="w-screen h-screen overflow-hidden bg-theme-bg-container flex">
      <Sidebar />
      <div
        style={{ height: isMobile ? "100%" : "calc(100% - 32px)" }}
        className="relative md:ml-[2px] md:mr-[16px] md:my-[16px] md:rounded-[16px] bg-theme-bg-secondary w-full h-full overflow-y-scroll p-4 md:p-0"
      >
        <div className="flex flex-col w-full px-1 md:pl-6 md:pr-[50px] md:py-6 py-16">
          {/* Header */}
          <div className="w-full flex flex-col gap-y-1 pb-6 border-white/10 border-b-2">
            <div className="items-center flex gap-x-4">
              <Terminal className="h-6 w-6 text-emerald-400" />
              <p className="text-lg leading-6 font-bold text-theme-text-primary">
                OpenCode Agent & LLM Console
              </p>
            </div>
            <p className="text-xs leading-[18px] font-base text-theme-text-secondary mt-2">
              Interact with the OpenCode CLI server using the OpenCode SDK, or
              run prompts directly against AnythingLLM's configured default LLM
              provider.
            </p>
          </div>

          {/* Setup Cards Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
            {/* Opencode Connection Config */}
            <div className="bg-theme-bg-primary rounded-xl p-5 border border-white/5 flex flex-col gap-y-4 justify-between">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-x-2">
                    <Gear className="h-5 w-5 text-emerald-400" />
                    <h3 className="font-semibold text-theme-text-primary text-sm">
                      OpenCode SDK Settings
                    </h3>
                  </div>

                  {/* Connection Status Badge */}
                  {connectionStatus === "checking" && (
                    <span className="px-2 py-0.5 rounded text-xs bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse">
                      Checking...
                    </span>
                  )}
                  {connectionStatus === "connected" && (
                    <span className="px-2 py-0.5 rounded text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-x-1">
                      <CheckCircle className="h-3.5 w-3.5" /> Connected
                    </span>
                  )}
                  {connectionStatus === "disconnected" && (
                    <span className="px-2 py-0.5 rounded text-xs bg-red-500/10 text-red-400 border border-red-500/20 flex items-center gap-x-1">
                      <Warning className="h-3.5 w-3.5" /> Offline
                    </span>
                  )}
                </div>

                <div className="flex flex-col gap-y-1.5">
                  <label className="text-xs text-theme-text-secondary font-medium">
                    OpenCode Server URL
                  </label>
                  <div className="flex gap-x-2">
                    <input
                      type="text"
                      value={serverUrl}
                      onChange={(e) => setServerUrl(e.target.value)}
                      placeholder="http://localhost:4096"
                      className="bg-theme-bg-secondary text-sm text-theme-text-primary px-3 py-2 rounded-lg border border-white/10 focus:border-emerald-500 focus:outline-none w-full"
                    />
                    <button
                      onClick={() => checkServerConnection(serverUrl)}
                      className="px-3 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-xs font-semibold transition-all duration-200"
                    >
                      Test
                    </button>
                  </div>
                </div>
              </div>

              {connectionStatus === "disconnected" && (
                <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 mt-2 flex gap-x-2 items-start">
                  <Warning className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold block">
                      OpenCode CLI server not detected locally.
                    </span>
                    To run the agent, start the server in your terminal:
                    <code className="block bg-black/30 p-1 rounded font-mono mt-1 text-[11px]">
                      opencode serve
                    </code>
                  </div>
                </div>
              )}
            </div>

            {/* Default LLM Configuration Status */}
            <div className="bg-theme-bg-primary rounded-xl p-5 border border-white/5 flex flex-col gap-y-4 justify-between">
              <div>
                <div className="flex items-center gap-x-2 mb-3">
                  <Cpu className="h-5 w-5 text-emerald-400" />
                  <h3 className="font-semibold text-theme-text-primary text-sm">
                    AnythingLLM System LLM
                  </h3>
                </div>

                {loading ? (
                  <div className="text-sm text-theme-text-secondary animate-pulse">
                    Loading LLM Configuration...
                  </div>
                ) : systemConfig ? (
                  <div className="flex flex-col gap-y-2.5">
                    <div className="flex justify-between items-center bg-theme-bg-secondary px-3 py-2 rounded-lg border border-white/5">
                      <span className="text-[11px] text-theme-text-secondary font-medium">
                        LLM Provider
                      </span>
                      <span className="text-xs font-semibold text-emerald-400 capitalize">
                        {systemConfig.provider}
                      </span>
                    </div>

                    <div className="flex justify-between items-center bg-theme-bg-secondary px-3 py-2 rounded-lg border border-white/5">
                      <span className="text-[11px] text-theme-text-secondary font-medium">
                        Default Model
                      </span>
                      <span
                        className="text-xs font-semibold text-theme-text-primary truncate max-w-[140px]"
                        title={systemConfig.model}
                      >
                        {systemConfig.model || "Not specified"}
                      </span>
                    </div>

                    <div className="flex justify-between items-center bg-theme-bg-secondary px-3 py-2 rounded-lg border border-white/5">
                      <span className="text-[11px] text-theme-text-secondary font-medium">
                        API Key Status
                      </span>
                      {systemConfig.hasApiKey ? (
                        <span className="text-xs font-semibold text-emerald-400 flex items-center gap-x-1">
                          <CheckCircle className="h-3.5 w-3.5" /> Configured
                        </span>
                      ) : (
                        <span className="text-xs font-semibold text-amber-400 flex items-center gap-x-1">
                          <Warning className="h-3.5 w-3.5" /> Not Configured
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-red-400">
                    Failed to load LLM settings.
                  </div>
                )}
              </div>
            </div>

            {/* MCP Register Panel */}
            <div className="bg-theme-bg-primary rounded-xl p-5 border border-white/5 flex flex-col gap-y-4 justify-between">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-x-2">
                    <Plug className="h-5 w-5 text-emerald-400" />
                    <h3 className="font-semibold text-theme-text-primary text-sm">
                      Register AnythingLLM MCP
                    </h3>
                  </div>

                  {mcpStatus.status === "not_registered" ? (
                    <span className="px-2 py-0.5 rounded text-[10px] bg-white/5 text-theme-text-secondary border border-white/10">
                      Not Configured
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      Active
                    </span>
                  )}
                </div>

                <div className="text-[11px] text-theme-text-secondary mb-3 leading-relaxed">
                  Register AnythingLLM as an MCP Server in OpenCode. This lets
                  the OpenCode Agent query AnythingLLM vectors and documents.
                </div>

                <div className="flex justify-between items-center bg-theme-bg-secondary px-3 py-2 rounded-lg border border-white/5 text-[11px] mb-2">
                  <span className="text-theme-text-secondary font-medium">
                    MCP Status
                  </span>
                  <span
                    className={`font-semibold ${mcpStatus.status === "not_registered" ? "text-amber-400" : "text-emerald-400"}`}
                  >
                    {mcpStatus.text}
                  </span>
                </div>
              </div>

              {/* Quick Trigger Button to show registration form */}
              <a
                href="#mcp-register-section"
                className="w-full py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 rounded-lg text-xs font-semibold text-center transition-all duration-200"
              >
                Configure MCP Server
              </a>
            </div>
          </div>

          {/* Model Customization & Tabs Section */}
          <div className="bg-theme-bg-primary rounded-xl p-5 border border-white/5 mt-6 flex flex-col gap-y-4">
            {/* Tabs */}
            <div className="pb-2 text-sm font-bold text-emerald-400 border-b-2 border-emerald-400">
              OpenCode Agent Session
            </div>

            {/* Model Override Option */}
            <div className="flex flex-col gap-y-3 bg-theme-bg-secondary p-4 rounded-xl border border-white/5">
              <div className="flex flex-col gap-y-1">
                <span className="text-xs font-semibold text-theme-text-primary">
                  Select AI Model
                </span>
                <span className="text-[11px] text-theme-text-secondary">
                  Choose the model to use for this execution session.
                </span>
              </div>

              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="bg-theme-bg-primary text-sm text-theme-text-primary px-3 py-2 rounded-lg border border-white/10 focus:border-emerald-500 focus:outline-none w-full cursor-pointer"
              >
                <option value="system-llm">
                  {systemConfig
                    ? `AnythingLLM System LLM (${systemConfig.provider}: ${systemConfig.model || "default"})`
                    : "AnythingLLM System LLM (Loading...)"}
                </option>
                <option value="opencode/big-pickle">
                  OpenCode Zen: Big Pickle (Free stealth model)
                </option>
                <option value="opencode/minimax-m2.5-free">
                  OpenCode Zen: MiniMax M2.5 (Free)
                </option>
                <option value="opencode/deepseek-v4-flash-free">
                  OpenCode Zen: DeepSeek V4 Flash (Free)
                </option>
                <option value="custom">Custom Model Path / ID</option>
              </select>

              {selectedModel === "custom" && (
                <div className="flex flex-col gap-y-1.5 mt-2">
                  <label className="text-[11px] text-theme-text-secondary font-medium">
                    Model ID / Name
                  </label>
                  <input
                    type="text"
                    value={customModel}
                    onChange={(e) => setCustomModel(e.target.value)}
                    placeholder="openai/gpt-4o or anthropic/claude-3-5-sonnet"
                    className="bg-theme-bg-primary text-sm text-theme-text-primary px-3 py-2 rounded-lg border border-white/10 focus:border-emerald-500 focus:outline-none w-full font-mono"
                  />
                </div>
              )}

              <div className="flex justify-end mt-2">
                <button
                  type="button"
                  onClick={handleSaveModel}
                  disabled={savingModel}
                  className="px-4 py-1.5 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition-all duration-200"
                >
                  {savingModel ? "Saving..." : "Save Model Settings"}
                </button>
              </div>
            </div>

            {/* Prompt input Form */}
            <form onSubmit={handleRunAgent} className="flex flex-col gap-y-3">
              <div className="flex flex-col gap-y-1.5">
                <label className="text-xs text-theme-text-secondary font-medium">
                  Prompt / Command
                </label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Describe what coding task OpenCode should perform, e.g. 'Add unit tests for utils.js'"
                  rows={3}
                  className="bg-theme-bg-secondary text-sm text-theme-text-primary p-3 rounded-lg border border-white/10 focus:border-emerald-500 focus:outline-none w-full"
                />
              </div>

              <div className="flex justify-end gap-x-2">
                {logs.length > 0 && (
                  <button
                    type="button"
                    onClick={clearLogs}
                    className="px-4 py-2 border border-white/10 hover:border-white/20 text-theme-text-primary rounded-lg text-xs font-semibold flex items-center gap-x-1.5 transition-all duration-200"
                  >
                    <Trash className="h-4 w-4" /> Clear Output
                  </button>
                )}
                <button
                  type="submit"
                  disabled={running || !prompt.trim()}
                  className="px-5 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white rounded-lg text-xs font-bold flex items-center gap-x-2 transition-all duration-200"
                >
                  <Play className="h-4 w-4" weight="fill" />
                  {running ? "Executing..." : "Execute"}
                </button>
              </div>
            </form>
          </div>

          {/* Interactive Output Console */}
          {(logs.length > 0 || running) && (
            <div className="mt-6 flex flex-col gap-y-2">
              <span className="text-xs font-bold text-theme-text-secondary uppercase tracking-wider flex items-center gap-x-1.5">
                <Terminal className="h-4 w-4" /> Output Console
              </span>

              <div className="bg-black text-theme-text-primary font-mono text-xs p-4 rounded-xl shadow-2xl h-[450px] overflow-y-auto border border-white/10 flex flex-col gap-y-3">
                {logs.map((log, idx) => {
                  if (log.type === "system") {
                    return (
                      <div
                        key={idx}
                        className="text-emerald-500 border-b border-emerald-500/10 pb-1 flex justify-between"
                      >
                        <span>{log.text}</span>
                        <span className="text-[10px] text-emerald-500/60">
                          {log.time}
                        </span>
                      </div>
                    );
                  }
                  if (log.type === "input") {
                    return (
                      <div
                        key={idx}
                        className="text-emerald-400 font-semibold bg-emerald-950/20 p-2.5 rounded border border-emerald-500/10"
                      >
                        <span className="text-emerald-500 mr-2">&gt;</span>
                        {log.text}
                      </div>
                    );
                  }
                  if (log.type === "reasoning") {
                    return (
                      <div
                        key={idx}
                        className="text-cyan-400 bg-cyan-950/15 p-3 rounded border border-cyan-500/10 whitespace-pre-wrap leading-relaxed"
                      >
                        <div className="text-[10px] text-cyan-400/60 uppercase tracking-widest font-bold mb-1.5 flex items-center gap-x-1">
                          <Cpu className="h-3 w-3 animate-spin" /> Thinking
                          Process
                        </div>
                        {log.text}
                      </div>
                    );
                  }
                  if (log.type === "message") {
                    return (
                      <div
                        key={idx}
                        className="text-slate-100 bg-slate-900/40 p-3.5 rounded border border-slate-800 whitespace-pre-wrap leading-relaxed"
                      >
                        {log.text}
                      </div>
                    );
                  }
                  if (log.type === "file_diff") {
                    return (
                      <div
                        key={idx}
                        className="text-amber-400 bg-amber-950/10 p-3 rounded border border-amber-500/10"
                      >
                        <span className="font-semibold block mb-1">
                          🛠️ {log.text}
                        </span>
                        {log.diff && log.diff.diffText && (
                          <pre className="text-[10px] bg-black/50 p-2 rounded mt-2 border border-white/5 overflow-x-auto text-slate-300 font-mono">
                            {log.diff.diffText}
                          </pre>
                        )}
                      </div>
                    );
                  }
                  if (log.type === "error") {
                    return (
                      <div
                        key={idx}
                        className="text-red-400 bg-red-950/25 p-3 rounded border border-red-500/20"
                      >
                        <span className="font-semibold">❌ Error:</span>{" "}
                        {log.text}
                      </div>
                    );
                  }
                  return (
                    <div key={idx} className="text-slate-400">
                      {log.text}
                    </div>
                  );
                })}
                {running && (
                  <div className="flex items-center gap-x-2 text-emerald-400 py-1.5 animate-pulse">
                    <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping"></span>
                    <span>Agent is working...</span>
                  </div>
                )}
                <div ref={terminalEndRef} />
              </div>
            </div>
          )}

          {/* MCP Register Panel section */}
          <div
            id="mcp-register-section"
            className="bg-theme-bg-primary rounded-xl p-5 border border-white/5 mt-6 flex flex-col gap-y-4"
          >
            <div className="w-full pb-3 border-white/10 border-b flex justify-between items-center">
              <div className="flex items-center gap-x-3">
                <Plug className="h-5 w-5 text-emerald-400" />
                <h3 className="font-bold text-theme-text-primary text-sm">
                  Register AnythingLLM MCP Server in OpenCode
                </h3>
              </div>
              <span className="text-xs text-theme-text-secondary">
                Writes settings directly to{" "}
                <code className="bg-black/20 p-0.5 rounded font-mono">
                  opencode.json
                </code>
              </span>
            </div>

            <form
              onSubmit={handleSaveMCP}
              className="grid grid-cols-1 md:grid-cols-3 gap-6"
            >
              <div className="flex flex-col gap-y-1.5">
                <label className="text-xs text-theme-text-secondary font-medium">
                  AnythingLLM Server API URL
                </label>
                <input
                  type="text"
                  value={anythingllmUrl}
                  onChange={(e) => setAnythingllmUrl(e.target.value)}
                  placeholder="http://localhost:3001"
                  required
                  className="bg-theme-bg-secondary text-sm text-theme-text-primary px-3 py-2 rounded-lg border border-white/10 focus:border-emerald-500 focus:outline-none w-full"
                />
              </div>

              <div className="flex flex-col gap-y-1.5">
                <label className="text-xs text-theme-text-secondary font-medium">
                  Developer API Key Selection
                </label>
                <select
                  value={selectedApiKey}
                  onChange={(e) => setSelectedApiKey(e.target.value)}
                  className="bg-theme-bg-secondary text-sm text-theme-text-primary px-3 py-2 rounded-lg border border-white/10 focus:border-emerald-500 focus:outline-none w-full cursor-pointer"
                >
                  <option value="generate">
                    Generate New Key (Recommended)
                  </option>
                  {mcpConfig?.apiKeys?.map((k) => (
                    <option key={k.id} value={k.secret}>
                      {k.name || `Key (id: ${k.id})`} ({k.secret.slice(0, 8)}
                      ...)
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-y-1.5">
                <label className="text-xs text-theme-text-secondary font-medium">
                  Configuration Location
                </label>
                <select
                  value={mcpType}
                  onChange={(e) => setMcpType(e.target.value)}
                  className="bg-theme-bg-secondary text-sm text-theme-text-primary px-3 py-2 rounded-lg border border-white/10 focus:border-emerald-500 focus:outline-none w-full cursor-pointer"
                >
                  <option value="project">
                    Project Configuration (./opencode.json)
                  </option>
                  <option value="global">
                    Global Configuration (~/.config/opencode/opencode.json)
                  </option>
                </select>
              </div>

              <div className="md:col-span-3 flex justify-between items-center bg-theme-bg-secondary/40 p-4 rounded-xl border border-white/5 mt-2">
                <div className="flex flex-col text-xs text-theme-text-secondary leading-relaxed">
                  <span className="font-semibold text-theme-text-primary mb-1">
                    What this does:
                  </span>
                  This will register the AnythingLLM MCP server{" "}
                  <code className="text-emerald-400 font-mono inline">
                    @raqueljezweb/anythingllm-mcp-server
                  </code>{" "}
                  inside the target{" "}
                  <code className="font-mono text-emerald-400">
                    opencode.json
                  </code>
                  . After saving, open the OpenCode CLI server (or restart it if
                  running) to enable tool access!
                </div>
                <button
                  type="submit"
                  disabled={mcpSaving}
                  className="px-6 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-all duration-200 shrink-0 ml-4"
                >
                  {mcpSaving ? "Saving..." : "Register MCP Server"}
                </button>
              </div>
            </form>
          </div>

          {/* Live OpenCode MCP Server Status */}
          <div className="bg-theme-bg-primary rounded-xl p-5 border border-white/5 mt-6 flex flex-col gap-y-4">
            <div className="w-full pb-3 border-white/10 border-b flex justify-between items-center">
              <div className="flex items-center gap-x-3">
                <Plug className="h-5 w-5 text-emerald-400" />
                <h3 className="font-bold text-theme-text-primary text-sm">
                  OpenCode MCP Server Status
                </h3>
              </div>
              {opencodeMcpStatus &&
              Object.keys(opencodeMcpStatus).length > 0 ? (
                <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  {Object.keys(opencodeMcpStatus).length} Server
                  {Object.keys(opencodeMcpStatus).length !== 1 ? "s" : ""}{" "}
                  Active
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded text-[10px] bg-white/5 text-theme-text-secondary border border-white/10">
                  No Servers Registered
                </span>
              )}
            </div>

            {opencodeMcpStatus === null ? (
              <div className="text-xs text-theme-text-secondary animate-pulse">
                Loading MCP server list...
              </div>
            ) : Object.keys(opencodeMcpStatus).length === 0 ? (
              <div className="flex flex-col items-center gap-y-3 py-6 text-theme-text-secondary">
                <Plug className="h-8 w-8 opacity-30" />
                <span className="text-xs">
                  No MCP servers are currently registered in the OpenCode
                  server.
                </span>
                <span className="text-[11px] opacity-60">
                  Use the "Register AnythingLLM MCP" button above or configure
                  opencode.json manually.
                </span>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {Object.entries(opencodeMcpStatus).map(([name, info]) => (
                  <div
                    key={name}
                    className="bg-theme-bg-secondary/50 rounded-lg border border-white/5 p-4 flex flex-col gap-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-theme-text-primary font-mono">
                        {name}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] ${info.disabled ? "bg-red-500/10 text-red-400 border border-red-500/20" : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"}`}
                      >
                        {info.disabled ? "Disabled" : "Active"}
                      </span>
                    </div>
                    {info.description && (
                      <span className="text-[11px] text-theme-text-secondary">
                        {info.description}
                      </span>
                    )}
                    {info.tools &&
                      Array.isArray(info.tools) &&
                      info.tools.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {info.tools.map((tool, i) => (
                            <span
                              key={i}
                              className="px-1.5 py-0.5 rounded text-[10px] bg-white/5 text-theme-text-secondary border border-white/10 font-mono"
                            >
                              {typeof tool === "string" ? tool : tool.name}
                            </span>
                          ))}
                        </div>
                      )}
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-end pt-1">
              <button
                onClick={fetchOpencodeMcpStatus}
                className="flex items-center gap-x-1.5 px-3 py-1.5 text-[11px] text-theme-text-secondary hover:text-theme-text-primary border border-white/10 hover:border-white/20 rounded-lg transition-all duration-200"
              >
                <ArrowClockwise className="h-3.5 w-3.5" />
                Refresh
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
