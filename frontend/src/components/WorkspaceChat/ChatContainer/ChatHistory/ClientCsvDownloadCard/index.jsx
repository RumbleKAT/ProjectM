import { memo, useState } from "react";
import { saveAs } from "file-saver";
import Papa from "papaparse";
import { DownloadSimple, CircleNotch } from "@phosphor-icons/react";
import { humanFileSize } from "@/utils/numbers";

/**
 * @param {{content: {filename: string, csvData: any[]}}} props
 */
function ClientCsvDownloadCard({ props }) {
  const { filename = "data.csv", csvData = [] } = props.content || {};
  const [downloading, setDownloading] = useState(false);
  const [fileSizeStr, setFileSizeStr] = useState("Unknown size");

  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);

    try {
      // 1. Convert JSON array to CSV string
      const csvString = Papa.unparse(csvData);

      // 2. Add UTF-8 BOM so Excel opens it properly
      const bom = "\ufeff";
      const blob = new Blob([bom + csvString], {
        type: "text/csv;charset=utf-8;",
      });

      // Calculate approximate size just for display if we want, or just download
      setFileSizeStr(humanFileSize(blob.size, true, 1));

      // 3. Trigger download
      saveAs(blob, filename);
    } catch (e) {
      console.error("Failed to generate and download CSV file", e);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex justify-center w-full my-2">
      <div className="w-full max-w-[750px] mr-4">
        <div className="flex items-center justify-between bg-zinc-800 light:bg-slate-100 light:border light:border-slate-200/50 rounded-xl px-2 py-1">
          <div className="flex items-center gap-x-3 min-w-0">
            <div className="bg-[#1e7145] text-white rounded-lg flex items-center justify-center flex-shrink-0 h-[48px] w-[48px] text-xs font-bold">
              CSV
            </div>
            <div className="flex flex-col min-w-0">
              <p className="text-white light:text-slate-900 text-sm font-medium truncate leading-snug">
                {filename}
              </p>
              <p className="text-zinc-400 light:text-slate-500 text-xs leading-snug">
                {Array.isArray(csvData)
                  ? `${csvData.length} rows`
                  : "Raw CSV Data"}{" "}
                · {fileSizeStr}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading || !csvData}
            className="flex-shrink-0 border-none px-3 py-1.5 rounded-lg flex items-center gap-x-2 bg-transparent hover:bg-zinc-700 light:hover:bg-slate-200 text-zinc-300 light:text-slate-700 hover:text-white light:hover:text-slate-900 disabled:opacity-50 disabled:hover:bg-transparent transition-colors"
          >
            {downloading ? (
              <CircleNotch weight="bold" className="w-5 h-5 animate-spin" />
            ) : (
              <DownloadSimple weight="bold" className="w-5 h-5" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default memo(ClientCsvDownloadCard);
