import React from "react";
import { Calendar, RefreshCw } from "lucide-react";
import type { ExpiryItem } from "../../types.js";

interface ExpiryDropdownProps {
  selectedExpiry: string;
  onChange: (val: string) => void;
  expiryList: ExpiryItem[];
  loading: boolean;
  lastRefresh: string;
  onRefresh: () => void;
}

export default function ExpiryDropdown({
  selectedExpiry,
  onChange,
  expiryList,
  loading,
  lastRefresh,
  onRefresh,
}: ExpiryDropdownProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2">
        <Calendar size={14} className="text-teal-400" />
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">EXPIRY DATE:</span>
        <select
          value={selectedExpiry}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 px-3 text-xs font-mono font-bold bg-slate-900 hover:bg-slate-800 text-teal-400 border border-slate-700 hover:border-slate-600 rounded-lg outline-none cursor-pointer focus:ring-1 focus:ring-teal-500/50 focus:border-teal-500 transition-all"
        >
          {expiryList.map((exp) => (
            <option key={exp.value} value={exp.value}>
              {exp.label} {exp.expiryFlag === "W" ? "(Weekly)" : exp.expiryFlag === "M" ? "(Monthly)" : ""}
            </option>
          ))}
        </select>
      </div>

      <button
        onClick={onRefresh}
        disabled={loading}
        className="p-2 rounded-lg bg-slate-900 border border-slate-700 hover:bg-slate-800 hover:border-slate-600 text-slate-400 hover:text-white disabled:opacity-40 transition-all cursor-pointer flex items-center justify-center"
        title="Reload Chain"
      >
        <RefreshCw size={12} className={`${loading ? "animate-spin text-teal-400" : ""}`} />
      </button>

      {lastRefresh && (
        <span className="text-[10px] text-slate-500 font-mono tracking-wide">
          REALTIME STREAM | {lastRefresh}
        </span>
      )}
    </div>
  );
}
