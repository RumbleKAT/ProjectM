import React from "react";

export default function JsonEditor({ value, onChange, error }) {
  return (
    <div className="flex flex-col w-full h-full min-h-[60vh] gap-y-2">
      <div className="flex justify-between items-center px-2">
        <span className="text-sm font-semibold text-theme-text-primary">
          Agent Flow JSON
        </span>
      </div>
      <div className="relative flex-1 w-full flex flex-col rounded-xl overflow-hidden border border-theme-border">
        <textarea
          className={`w-full h-full p-4 font-mono text-sm bg-theme-bg-secondary text-theme-text-primary resize-none outline-none focus:outline-none focus:ring-2 ${
            error
              ? "focus:ring-red-500 ring-2 ring-red-500"
              : "focus:ring-primary-button"
          }`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Enter valid JSON here..."
          spellCheck="false"
        />
      </div>
      {error && (
        <div className="text-red-500 text-sm font-medium px-2 bg-red-500/10 p-2 rounded-lg border border-red-500/20">
          JSON Error: {error}
        </div>
      )}
    </div>
  );
}
