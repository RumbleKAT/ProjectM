import { useState, useEffect } from "react";
import Sidebar from "@/components/SettingsSidebar";
import { isMobile } from "react-device-detect";
import System from "@/models/system";
import Admin from "@/models/admin";
import Workspace from "@/models/workspace";
import { userFromStorage, baseHeaders } from "@/utils/request";

const METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"];

const MODES = [
  { value: "chat", label: "Chat (LLM + RAG)" },
  { value: "query", label: "Query (RAG only, no LLM)" },
  { value: "automatic", label: "Automatic (tool-calling)" },
];

const ENDPOINT_PRESETS = [
  { label: "List workspaces", method: "GET", path: "/workspaces" },
  { label: "Get workspace", method: "GET", path: "/workspace/:slug" },
  {
    label: "Chat (streaming)",
    method: "POST",
    path: "/workspace/:slug/stream-chat",
    mode: "chat",
    bodyTemplate: true,
  },
  {
    label: "Chat (v1 API key)",
    method: "POST",
    api: "/api/v1",
    path: "/workspace/:slug/chat",
    mode: "chat",
    bodyTemplate: true,
  },
  { label: "System info", method: "GET", path: "/system" },
  {
    label: "Upload document",
    method: "POST",
    path: "/workspace/:slug/update-embeddings",
  },
];

const API_PREFIXES = [
  { label: "Internal API", prefix: "/api" },
  { label: "External API (v1)", prefix: "/api/v1" },
];

function KeyValueEditor({ values, onChange, labelPlaceholder = "Key" }) {
  const add = () => onChange([...values, { key: "", value: "" }]);
  const remove = (i) => onChange(values.filter((_, idx) => idx !== i));
  const update = (i, field, val) => {
    onChange(
      values.map((entry, idx) =>
        idx === i ? { ...entry, [field]: val } : entry
      )
    );
  };

  return (
    <div className="flex flex-col gap-y-2">
      {values.map((entry, i) => (
        <div key={i} className="flex gap-x-2 items-center">
          <input
            type="text"
            placeholder={labelPlaceholder}
            value={entry.key}
            onChange={(e) => update(i, "key", e.target.value)}
            className="w-[200px] px-2 py-1 bg-zinc-800 text-white rounded text-sm border border-zinc-700"
          />
          <input
            type="text"
            placeholder="Value"
            value={entry.value}
            onChange={(e) => update(i, "value", e.target.value)}
            className="flex-1 px-2 py-1 bg-zinc-800 text-white rounded text-sm border border-zinc-700"
          />
          <button
            onClick={() => remove(i)}
            className="text-red-400 hover:text-red-300 text-sm"
          >
            x
          </button>
        </div>
      ))}
      <button
        onClick={add}
        className="text-blue-400 hover:text-blue-300 text-xs self-start"
      >
        + Add
      </button>
    </div>
  );
}

export default function DeveloperApi() {
  const [apiPrefix, setApiPrefix] = useState("/api");
  const [method, setMethod] = useState("GET");
  const [path, setPath] = useState("");
  const [headers, setHeaders] = useState([{ key: "", value: "" }]);
  const [body, setBody] = useState("");
  const [contentType, setContentType] = useState("application/json");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [response, setResponse] = useState(null);
  const [rawResponse, setRawResponse] = useState(null);
  const [streamingText, setStreamingText] = useState("");
  const [workspaces, setWorkspaces] = useState([]);
  const [selectedSlug, setSelectedSlug] = useState("");
  const [chatMode, setChatMode] = useState("chat");
  const [chatMessage, setChatMessage] = useState("");
  const [workspaceLlm, setWorkspaceLlm] = useState("");
  const [workspaceModel, setWorkspaceModel] = useState("");
  const [llmUpdating, setLlmUpdating] = useState(false);

  const LLM_PROVIDERS = [
    { value: "openai", label: "OpenAI" },
    { value: "anthropic", label: "Anthropic" },
    { value: "gemini", label: "Google Gemini" },
    { value: "ollama", label: "Ollama" },
    { value: "togetherai", label: "Together AI" },
    { value: "groq", label: "Groq" },
    { value: "deepseek", label: "DeepSeek" },
    { value: "mistral", label: "Mistral" },
    { value: "perplexity", label: "Perplexity" },
    { value: "openrouter", label: "OpenRouter" },
    { value: "lmstudio", label: "LM Studio" },
    { value: "localai", label: "LocalAI" },
    { value: "litellm", label: "LiteLLM" },
    { value: "xai", label: "xAI" },
    { value: "cohere", label: "Cohere" },
    { value: "novita", label: "Novita" },
  ];

  const COMMON_MODELS = {
    openai: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-4", "gpt-3.5-turbo"],
    anthropic: [
      "claude-3-5-sonnet-20241022",
      "claude-3-opus-20240229",
      "claude-3-sonnet-20240229",
      "claude-3-haiku-20240307",
    ],
    gemini: ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-1.5-pro", "gemini-1.5-flash"],
    ollama: ["llama3.2", "llama3.1", "mistral", "codellama", "mixtral"],
    togetherai: [
      "mistralai/Mixtral-8x7B-Instruct-v0.1",
      "mistralai/Mistral-7B-Instruct-v0.2",
    ],
    groq: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"],
    deepseek: ["deepseek-chat", "deepseek-reasoner"],
    mistral: ["mistral-large-latest", "mistral-medium-latest", "mistral-small-latest"],
    perplexity: ["sonar-pro", "sonar", "codellama-70b"],
    openrouter: ["openai/gpt-4o", "anthropic/claude-3.5-sonnet", "google/gemini-2.0-flash"],
    xai: ["grok-beta", "grok-2"],
    cohere: ["command-r-plus", "command-r", "command"],
    novita: ["mistralai/mixtral-8x22b-instruct", "meta-llama/llama-3.1-8b-instruct"],
  };

  async function updateWorkspaceLlm(provider, model) {
    if (!selectedSlug) return;
    setLlmUpdating(true);
    try {
      const res = await fetch(`/api/workspace/${selectedSlug}/update`, {
        method: "POST",
        headers: { ...baseHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ chatProvider: provider, chatModel: model || null }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setWorkspaceLlm(provider);
      setWorkspaceModel(model || "");
    } catch (e) {
      console.error("Failed to update workspace LLM:", e);
    }
    setLlmUpdating(false);
  }

  useEffect(() => {
    Workspace.all().then((all) => {
      const list = (all || []).slice(0, 5);
      setWorkspaces(list);
      if (list.length > 0) setSelectedSlug(list[0].slug);
    });
  }, []);

  useEffect(() => {
    if (!selectedSlug) return;
    Workspace.bySlug(selectedSlug).then((ws) => {
      if (ws) {
        setWorkspaceLlm(ws.chatProvider || ws.llmProvider || ws.LLMProvider || "");
        setWorkspaceModel(ws.chatModel || ws.llmModel || "");
      }
    });
  }, [selectedSlug]);

  useEffect(() => {
    const msg = chatMessage.trim();
    if (!msg) {
      if (path.includes("stream-chat") || path.includes("/chat")) {
        setBody(
          JSON.stringify({ message: "Your message", mode: chatMode }, null, 2)
        );
      }
      return;
    }
    if (path.includes("stream-chat") || path.includes("/chat")) {
      setBody(JSON.stringify({ message: msg, mode: chatMode }, null, 2));
    }
  }, [chatMessage, chatMode, path]);

  function resolvePath(template) {
    if (!selectedSlug || !template.includes(":slug")) return template;
    return template.replace(":slug", selectedSlug);
  }

  function applyPreset(preset) {
    setMethod(preset.method);
    if (preset.api) setApiPrefix(preset.api);
    setPath(resolvePath(preset.path));
    if (preset.bodyTemplate) {
      setChatMode(preset.mode || "chat");
      setChatMessage("");
      setBody("");
    } else {
      setBody(preset.body || "");
    }
    setResponse(null);
    setError(null);
  }

  async function sendRequest() {
    if (!path.trim()) return;
    setLoading(true);
    setError(null);
    setResponse(null);
    setRawResponse(null);
    setStreamingText("");

    try {
      const url = `${apiPrefix}${resolvePath(path)}`;
      const headerObj = headers
        .filter((h) => h.key.trim())
        .reduce((acc, h) => ({ ...acc, [h.key]: h.value }), {});

      if (!headerObj["Content-Type"] && ["POST", "PUT", "PATCH"].includes(method) && body.trim()) {
        headerObj["Content-Type"] = contentType;
      }

      const fetchOptions = {
        method,
        headers: headerObj,
      };

      if (body.trim() && ["POST", "PUT", "PATCH"].includes(method)) {
        if (contentType === "application/json") {
          try {
            fetchOptions.body = JSON.stringify(JSON.parse(body));
          } catch {
            fetchOptions.body = body;
          }
        } else {
          fetchOptions.body = body;
        }
      }

      const res = await fetch(url, fetchOptions);

      if (path.includes("stream-chat")) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let accumulated = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          accumulated += chunk;
          setStreamingText(accumulated);
        }

        setRawResponse(accumulated);
        setResponse({
          status: res.status,
          statusText: res.statusText,
          headers: {},
          body: accumulated,
        });
      } else {
        const rawText = await res.text();

      let parsedBody;
      try {
        parsedBody = JSON.parse(rawText);
      } catch {
        parsedBody = rawText;
      }

      const resHeaders = {};
      res.headers.forEach((value, key) => {
        resHeaders[key] = value;
      });

      setRawResponse(rawText);
      setResponse({
        status: res.status,
        statusText: res.statusText,
        headers: resHeaders,
        body: parsedBody,
      });
      }
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }

  const [apiKeys, setApiKeys] = useState([]);
  useEffect(() => {
    const user = userFromStorage();
    const Model = !!user ? Admin : System;
    Model.getApiKeys().then((res) => {
      if (res?.apiKeys) setApiKeys(res.apiKeys);
    });
  }, []);

  function useApiKey(secret) {
    const next = headers.filter(
      (h) => h.key.toLowerCase() !== "authorization"
    );
    next.push({ key: "Authorization", value: `Bearer ${secret}` });
    setHeaders(next);
  }

  function maskKey(secret) {
    if (secret.length <= 8) return secret;
    return secret.slice(0, 4) + "••••••••" + secret.slice(-4);
  }

  const fullUrl = `${apiPrefix}${resolvePath(path)}`;

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
                Developer Playground
              </p>
            </div>
            <p className="text-xs leading-[18px] font-base text-theme-text-secondary">
              Test any AnythingLLM API endpoint with full control over method,
              headers, and body. Select a preset below or craft your own request.
            </p>
          </div>

          <div className="flex flex-col gap-y-5 mt-6 max-w-4xl">
            <div className="flex flex-col gap-y-2">
              <p className="text-sm font-medium text-theme-text-primary">
                Endpoint Presets
              </p>
              <div className="flex flex-wrap gap-2">
                {ENDPOINT_PRESETS.map((preset, i) => (
                  <button
                    key={i}
                    onClick={() => applyPreset(preset)}
                    className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded text-xs border border-zinc-700"
                  >
                    <span
                      className={`font-mono font-bold ${
                        preset.method === "GET"
                          ? "text-green-400"
                          : preset.method === "POST"
                            ? "text-blue-400"
                            : preset.method === "PUT"
                              ? "text-orange-400"
                              : preset.method === "DELETE"
                                ? "text-red-400"
                                : "text-purple-400"
                      }`}
                    >
                      {preset.method}
                    </span>{" "}
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {workspaces.length > 0 && (
              <div className="flex items-center gap-x-3">
                <p className="text-sm font-medium text-theme-text-primary">
                  Workspace
                </p>
                <select
                  value={selectedSlug}
                  onChange={(e) => setSelectedSlug(e.target.value)}
                  className="px-3 py-1.5 bg-zinc-800 text-white rounded text-sm border border-zinc-700"
                >
                  {workspaces.map((w) => (
                    <option key={w.slug} value={w.slug}>
                      {w.name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-theme-text-secondary">
                  (path의 :slug를 자동 치환)
                </p>
              </div>
            )}

            {apiKeys.length > 0 && (
              <div className="flex flex-col gap-y-2">
                <p className="text-sm font-medium text-theme-text-primary">
                  API Keys
                </p>
                <div className="flex flex-wrap gap-2">
                  {apiKeys.map((key) => (
                    <button
                      key={key.id}
                      onClick={() => useApiKey(key.secret)}
                      className="flex items-center gap-x-2 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded text-xs border border-zinc-700"
                      title="Click to set as Authorization header"
                    >
                      <span className="font-mono">
                        {maskKey(key.secret)}
                      </span>
                      {key.label && (
                        <span className="text-theme-text-secondary">
                          ({key.label})
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-x-2 items-center">
              <select
                value={apiPrefix}
                onChange={(e) => setApiPrefix(e.target.value)}
                className="px-2 py-2 bg-zinc-800 text-white rounded text-sm border border-zinc-700"
              >
                {API_PREFIXES.map((p) => (
                  <option key={p.prefix} value={p.prefix}>
                    {p.label}
                  </option>
                ))}
              </select>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="px-2 py-2 bg-zinc-800 text-white rounded text-sm border border-zinc-700 font-mono"
              >
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <input
                type="text"
                placeholder={"/workspace/:slug/chat"}
                value={path}
                onChange={(e) => setPath(e.target.value)}
                className="flex-1 px-3 py-2 bg-zinc-800 text-white rounded text-sm border border-zinc-700 font-mono"
              />
              <button
                onClick={sendRequest}
                disabled={loading || !path.trim()}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 text-white rounded text-sm font-medium"
              >
                {loading ? "Sending..." : "Send"}
              </button>
            </div>

            <div className="flex flex-col gap-y-3">
              <p className="text-sm font-medium text-theme-text-primary">
                Request Headers
              </p>
              <KeyValueEditor
                values={headers}
                onChange={setHeaders}
                labelPlaceholder="Header"
              />
            </div>

            <div className="flex flex-col gap-y-3">
              <div className="flex items-center gap-x-3">
                <p className="text-sm font-medium text-theme-text-primary">
                  Request Body
                </p>
                <select
                  value={contentType}
                  onChange={(e) => setContentType(e.target.value)}
                  className="px-2 py-1 bg-zinc-800 text-white rounded text-xs border border-zinc-700"
                >
                  <option value="application/json">application/json</option>
                  <option value="text/plain">text/plain</option>
                  <option value="application/xml">application/xml</option>
                </select>
              </div>

              {(path.includes("stream-chat") || path.includes("/chat")) && (
                <div className="grid grid-cols-2 gap-x-4 gap-y-3 bg-zinc-900 rounded p-4 border border-zinc-700">
                  <div className="flex flex-col gap-y-1.5 col-span-2">
                    <label className="text-xs font-medium text-theme-text-secondary">
                      Chat Message
                    </label>
                    <input
                      type="text"
                      value={chatMessage}
                      onChange={(e) => setChatMessage(e.target.value)}
                      placeholder="Enter your message..."
                      className="px-3 py-2 bg-zinc-800 text-white rounded text-sm border border-zinc-700"
                    />
                  </div>
                  <div className="flex flex-col gap-y-1.5">
                    <label className="text-xs font-medium text-theme-text-secondary">
                      Mode
                    </label>
                    <select
                      value={chatMode}
                      onChange={(e) => setChatMode(e.target.value)}
                      className="px-3 py-2 bg-zinc-800 text-white rounded text-sm border border-zinc-700"
                    >
                      {MODES.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={"{ \"message\": \"Hello\", \"mode\": \"chat\" }"}
                rows={5}
                className="w-full px-3 py-2 bg-zinc-800 text-white rounded text-sm border border-zinc-700 font-mono resize-y"
              />
            </div>

            <div className="flex flex-col gap-y-1.5">
              <p className="text-xs font-mono text-theme-text-secondary">
                Request URL:{" "}
                <span className="text-blue-400">
                  {method} {fullUrl}
                </span>
              </p>
            </div>

            {error && (
              <div className="p-3 bg-red-900/30 border border-red-700 rounded text-sm text-red-300">
                {error}
              </div>
            )}

            {loading && path.includes("stream-chat") && (
              <div className="flex flex-col gap-y-3">
                <div className="flex items-center gap-x-2">
                  <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                  <p className="text-sm font-medium text-theme-text-primary">
                    Streaming Response
                  </p>
                </div>
                <pre className="bg-zinc-800 rounded p-3 text-sm font-mono text-theme-text-primary max-h-[500px] overflow-y-auto whitespace-pre-wrap">
                  {streamingText || "(waiting for chunks...)"}
                </pre>
              </div>
            )}

            {response && (
              <div className="flex flex-col gap-y-3">
                <div className="flex items-center gap-x-3">
                  <p className="text-sm font-medium text-theme-text-primary">
                    Response
                  </p>
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-mono ${
                      response.status >= 200 && response.status < 300
                        ? "bg-green-900/50 text-green-400"
                        : response.status >= 400 && response.status < 500
                          ? "bg-yellow-900/50 text-yellow-400"
                          : response.status >= 500
                            ? "bg-red-900/50 text-red-400"
                            : "bg-zinc-800 text-theme-text-secondary"
                    }`}
                  >
                    {response.status} {response.statusText}
                  </span>
                </div>

                {response.headers &&
                  Object.keys(response.headers).length > 0 && (
                    <div className="flex flex-col gap-y-1">
                      <p className="text-xs font-medium text-theme-text-secondary">
                        Response Headers
                      </p>
                      <div className="bg-zinc-800 rounded p-3 text-xs font-mono text-theme-text-secondary max-h-[200px] overflow-y-auto">
                        {Object.entries(response.headers).map(
                          ([key, value]) => (
                            <div key={key}>
                              <span className="text-blue-400">{key}</span>:{" "}
                              {value}
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  )}

                <div className="flex flex-col gap-y-1">
                  <div className="flex items-center gap-x-2">
                    <p className="text-xs font-medium text-theme-text-secondary">
                      Response Body
                    </p>
                    {rawResponse && rawResponse.length > 2000 && (
                      <span className="text-xs text-theme-text-secondary">
                        ({rawResponse.length} bytes)
                      </span>
                    )}
                  </div>
                  <pre className="bg-zinc-800 rounded p-3 text-sm font-mono text-theme-text-primary max-h-[500px] overflow-y-auto whitespace-pre-wrap">
                    {response.body !== null
                      ? typeof response.body === "object"
                        ? JSON.stringify(response.body, null, 2)
                        : String(response.body)
                      : "(no body)"}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
