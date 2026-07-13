import React, { useState, useEffect, FormEvent, KeyboardEvent } from "react";
import { HelpCircle, Check, X } from "lucide-react";

interface FormulaBarProps {
  activeCell: { symbol: string; field: string; value: string } | null;
  onCommit: (newValue: string) => void;
  darkMode: boolean;
}

export default function ExcelFormulaBar({ activeCell, onCommit, darkMode }: FormulaBarProps) {
  const [inputValue, setInputValue] = useState("");

  useEffect(() => {
    if (activeCell) {
      setInputValue(activeCell.value);
    } else {
      setInputValue("");
    }
  }, [activeCell]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onCommit(inputValue);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      onCommit(inputValue);
    } else if (e.key === "Escape" && activeCell) {
      setInputValue(activeCell.value);
    }
  };

  return (
    <div className={`flex items-center gap-2 px-3 py-2 border-b select-none ${
      darkMode ? "bg-slate-900 border-slate-800 text-slate-100" : "bg-white border-slate-350 text-slate-900"
    }`}>
      {/* Name box / Coordinate indicator */}
      <div className={`flex items-center justify-center px-4 py-1.5 text-xs md:text-sm font-mono font-bold border-2 rounded h-9 w-36 ${
        darkMode ? "bg-slate-950 border-slate-800 text-teal-400" : "bg-slate-100 border-slate-300 text-emerald-800"
      }`}>
        {activeCell ? `${activeCell.symbol}.${activeCell.field.toUpperCase()}` : "A1"}
      </div>

      {/* Action triggers */}
      <div className="flex items-center gap-1.5 border-r pr-2 border-slate-205 dark:border-slate-850">
        <button
          onClick={() => activeCell && setInputValue(activeCell.value)}
          disabled={!activeCell}
          title="Cancel"
          className={`p-1.5 rounded-md text-red-500 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors`}
        >
          <X size={16} />
        </button>
        <button
          onClick={() => onCommit(inputValue)}
          disabled={!activeCell}
          title="Commit"
          className={`p-1.5 rounded-md text-green-600 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors`}
        >
          <Check size={16} />
        </button>
      </div>

      {/* The Formula indicator icon fx */}
      <span className="text-sm md:text-base font-serif font-black italic text-slate-400 select-none px-2.5">
        fx
      </span>

      {/* Active input bar */}
      <form onSubmit={handleSubmit} className="flex-1">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!activeCell}
          placeholder={activeCell ? "Enter value or formula starting with '='..." : "Select a cell in the spreadsheets below to edit..."}
          className={`w-full px-4 py-1.5 text-xs md:text-sm font-mono font-semibold border-2 rounded h-9 outline-none ${
            darkMode 
              ? "bg-slate-950 border-slate-800 text-emerald-400 focus:border-emerald-500 placeholder:text-slate-600" 
              : "bg-slate-50 border-slate-300 text-slate-950 focus:border-emerald-650 focus:bg-white placeholder:text-slate-400"
          }`}
        />
      </form>

      {/* Simple Excel instructions helper */}
      <div className="group relative">
        <span className="cursor-help p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
          <HelpCircle size={14} />
        </span>
        <div className={`absolute right-0 top-7 hidden group-hover:block z-50 w-80 p-3 rounded-lg shadow-xl text-[11px] font-sans border leading-relaxed ${
          darkMode ? "bg-slate-950 border-slate-800 text-slate-300" : "bg-white border-slate-200 text-slate-700"
        }`}>
          <p className="font-bold text-emerald-600 dark:text-teal-400 mb-1">Standard Excel formulas mapped:</p>
          <ul className="list-disc pl-4 space-y-1 font-mono text-[10px]">
            <li><span className="font-sans font-bold text-slate-900 dark:text-slate-100">Sum of Scores:</span> =SUM(SCORE)</li>
            <li><span className="font-sans font-bold text-slate-900 dark:text-slate-100">Sum of Weights:</span> =SUM(WEIGHTAGE)</li>
            <li><span className="font-sans font-bold text-slate-900 dark:text-slate-100">Average LTP:</span> =AVERAGE(LTP)</li>
            <li><span className="font-sans font-bold text-slate-900 dark:text-slate-100">Advances count:</span> =COUNTIF(CHANGERANGE,"&gt;0")</li>
            <li><span className="font-sans font-bold text-slate-900 dark:text-slate-100">Declines count:</span> =COUNTIF(CHANGERANGE,"&lt;0")</li>
            <li><span className="font-sans font-bold text-slate-900 dark:text-slate-100">Stock Multiplier:</span> =HDFCBANK*LTP</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
