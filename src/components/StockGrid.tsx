import React, { useState, useEffect, useRef } from "react";
import { Download, Upload, ArrowUpDown, TableProperties, Edit, RefreshCw } from "lucide-react";
import { StockData } from "../types.js";
import { exportToCSV } from "../utils.js";

interface StockGridProps {
  stocks: StockData[];
  page: "NIFTY" | "SENSEX" | "BANKNIFTY" | "BANKNIFTY";
  darkMode: boolean;
  onSelectCell: (cell: { symbol: string; field: string; value: string } | null) => void;
  onEditCell: (symbol: string, field: string, value: string) => void;
  onCSVImport: (data: any[]) => void;
  fyersAuthorized?: boolean;
  isSimulating?: boolean;
  countdownText?: string;
  countdown15m?: string;
  countdown30m?: string;
  countdown1h?: string;
}

const COLUMNS = [
  { id: "symbol", label: "SYMBOL", letter: "A", type: "string", editable: false },
  { id: "ticker", label: "TICKER", letter: "B", type: "string", editable: false },
  { id: "ltp", label: "LTP", letter: "C", type: "number", editable: true },
  { id: "prevClose", label: "PREV CLOSE", letter: "D", type: "number", editable: true },
  { id: "high", label: "HIGH", letter: "E", type: "number", editable: false },
  { id: "low", label: "LOW", letter: "F", type: "number", editable: false },
  { id: "open", label: "OPEN", letter: "G", type: "number", editable: false },
  { id: "change", label: "CHANGE", letter: "H", type: "number", editable: false },
  { id: "changePercent", label: "% CHANGE", letter: "I", type: "number", editable: true },
  { id: "volume", label: "VOLUME", letter: "J", type: "number", editable: true },
  { id: "lastTradedTime", label: "LAST TRADED TIME", letter: "K", type: "string", editable: false },
  { id: "weightage", label: "WEIGHTAGE", letter: "L", type: "number", editable: true },
  { id: "score", label: "SCORE", letter: "M", type: "formula", expression: "=L*I", editable: false },
  { id: "backupScore", label: "BACKUP SCORE", letter: "N", type: "number", editable: false },
  { id: "scoreDifference", label: "SCORE DIFF", letter: "O", type: "formula", expression: "=M-N", editable: false },
  { id: "score15m", label: "15M BACKUP SCORE", letter: "P", type: "number", editable: false, isTimedBackup: true, timerLabel: "15m" },
  { id: "score15mDiff", label: "15M BACKUP DIF", letter: "Q", type: "formula", expression: "=M-P", editable: false, isTimedBackupDiff: true },
  { id: "score30m", label: "30M BACKUP SCORE", letter: "R", type: "number", editable: false, isTimedBackup: true, timerLabel: "30m" },
  { id: "score30mDiff", label: "30M BACKUP DIF", letter: "S", type: "formula", expression: "=M-R", editable: false, isTimedBackupDiff: true },
  { id: "score1h", label: "1H BACKUP SCORE", letter: "T", type: "number", editable: false, isTimedBackup: true, timerLabel: "1h" },
  { id: "score1hDiff", label: "1H BACKUP DIF", letter: "U", type: "formula", expression: "=M-T", editable: false, isTimedBackupDiff: true },
];

const getApiUrl = (path: string) => {
  const host = (typeof window !== "undefined" && (window.location.protocol === "file:" || window.location.port === "5173"))
    ? "http://localhost:3000"
    : "";
  return `${host}${path}`;
};

function getExcelColumnLetter(index: number): string {
  let letter = "";
  let temp = index;
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}

function getColWidth(colId: string): string {
  switch (colId) {
    case "symbol": return "min-w-[100px] w-[100px]";
    case "ticker": return "min-w-[145px] w-[145px]";
    case "ltp": return "min-w-[90px] w-[90px]";
    case "prevClose": return "min-w-[110px] w-[110px]";
    case "high": case "low": case "open": return "min-w-[90px] w-[90px]";
    case "change": return "min-w-[90px] w-[90px]";
    case "changePercent": return "min-w-[100px] w-[100px]";
    case "volume": return "min-w-[115px] w-[115px]";
    case "lastTradedTime": return "min-w-[125px] w-[125px]";
    case "weightage": return "min-w-[105px] w-[105px]";
    case "score": return "min-w-[95px] w-[95px]";
    case "backupScore": return "min-w-[125px] w-[125px]";
    case "scoreDifference": return "min-w-[105px] w-[105px]";
    default: return "min-w-[120px] w-[120px]";
  }
}

function getColAlign(colId: string, colType: string): string {
  if (colId === "ticker") {
    return "text-center justify-center items-center";
  }
  if (
    colId === "score" ||
    colId === "backupScore" ||
    colId === "scoreDifference" ||
    colId.startsWith("score15m") ||
    colId.startsWith("score30m") ||
    colId.startsWith("score1h")
  ) {
    return "text-center justify-center";
  }
  return (colType === "number" || colType === "formula") ? "text-right justify-end" : "text-left justify-between";
}

function StockGrid({
  stocks,
  page,
  darkMode,
  onSelectCell,
  onEditCell,
  onCSVImport,
  fyersAuthorized = false,
  isSimulating = true,
  countdownText = "05:00",
  countdown15m = "15:00",
  countdown30m = "30:00",
  countdown1h = "60:00"
}: StockGridProps) {
  const [selectedCol, setSelectedCol] = useState("N");
  const [selectedCoords, setSelectedCoords] = useState<{ row: number; col: number } | null>(null);
  const [editingCoords, setEditingCoords] = useState<{ row: number; col: number } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [sortField, setSortField] = useState<string>("weightage");
  const [sortAsc, setSortAsc] = useState<boolean>(false);
  const [filterText, setFilterText] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // Trigger coordinate selected callback to formula bar
  useEffect(() => {
    if (selectedCoords && sortedStocks[selectedCoords.row]) {
      const stock = sortedStocks[selectedCoords.row];
      const col = COLUMNS[selectedCoords.col];
      const val = (stock as any)[col.id]?.toString() || "";
      onSelectCell({ symbol: stock.symbol, field: col.id, value: val });

      // Auto-scroll selected cell into view
      if (gridRef.current) {
        const container = gridRef.current;
        const cell = container.querySelector(
          `[data-row="${selectedCoords.row}"][data-col="${selectedCoords.col}"]`
        ) as HTMLElement;
        if (cell) {
          const containerLeft = container.scrollLeft;
          const containerRight = containerLeft + container.clientWidth;
          const cellLeft = cell.offsetLeft;
          const cellRight = cellLeft + cell.clientWidth;

          // Sticky left columns: Symbol is A (approx 135px wide), so avoid overlapping it
          const stickyThreshold = 150; 
          if (cellLeft < containerLeft + stickyThreshold) {
            container.scrollLeft = Math.max(0, cellLeft - stickyThreshold);
          } else if (cellRight > containerRight) {
            container.scrollLeft = cellRight - container.clientWidth;
          }

          const containerTop = container.scrollTop;
          const containerBottom = containerTop + container.clientHeight;
          const cellTop = cell.offsetTop;
          const cellBottom = cellTop + cell.clientHeight;

          if (cellTop < containerTop) {
            container.scrollTop = cellTop;
          } else if (cellBottom > containerBottom) {
            container.scrollTop = cellBottom - container.clientHeight;
          }
        }
      }
    } else {
      onSelectCell(null);
    }
  }, [selectedCoords]);

  // Handle keyboard spreadsheet navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!selectedCoords || editingCoords) return;

      let { row, col } = selectedCoords;

      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          if (row > 0) setSelectedCoords({ row: row - 1, col });
          break;
        case "ArrowDown":
          e.preventDefault();
          if (row < sortedStocks.length - 1) setSelectedCoords({ row: row + 1, col });
          break;
        case "ArrowLeft":
          e.preventDefault();
          if (col > 0) setSelectedCoords({ row, col: col - 1 });
          break;
        case "ArrowRight":
          e.preventDefault();
          if (col < COLUMNS.length - 1) setSelectedCoords({ row, col: col + 1 });
          break;
        case "Enter":
          e.preventDefault();
          const targetCol = COLUMNS[col];
          const targetStock = sortedStocks[row];
          const isTargetIndexRow = targetStock && (targetStock.ticker === "NSE:NIFTY50-INDEX" || targetStock.ticker === "BSE:SENSEX-INDEX" || targetStock.ticker === "NSE:NIFTYBANK-INDEX");
          if (targetCol.editable && !isTargetIndexRow) {
            setEditingCoords({ row, col });
            setEditValue((sortedStocks[row] as any)[targetCol.id]?.toString() || "");
          }
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedCoords, editingCoords, stocks, sortField, sortAsc, filterText]);

  // Implement scroll navigation via left/right arrows on container
  useEffect(() => {
    const container = gridRef.current;
    if (!container) return;

    const handleContainerKeyDown = (e: KeyboardEvent) => {
      if (editingCoords) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        container.scrollLeft -= 120;
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        container.scrollLeft += 120;
      }
    };

    container.addEventListener("keydown", handleContainerKeyDown);
    return () => {
      container.removeEventListener("keydown", handleContainerKeyDown);
    };
  }, [editingCoords]);

  // Bloomberg Style for % Change Column
  const getPercentChangeStyle = (val: number) => {
    if (isNaN(val)) return {};
    if (val === 0) {
      return { backgroundColor: "#FFFFFF", color: "#000000", fontWeight: "600" };
    }
    const abs = Math.abs(val);
    if (val > 0) {
      if (abs > 3.0) return { backgroundColor: "#1B5E20", color: "#FFFFFF", fontWeight: "bold" };
      if (abs >= 2.0) return { backgroundColor: "#43A047", color: "#FFFFFF", fontWeight: "bold" };
      if (abs >= 1.0) return { backgroundColor: "#A5D6A7", color: "#000000", fontWeight: "600" };
      return { backgroundColor: "#E8F5E9", color: "#000000" };
    } else {
      if (abs > 3.0) return { backgroundColor: "#B71C1C", color: "#FFFFFF", fontWeight: "bold" };
      if (abs >= 2.0) return { backgroundColor: "#E53935", color: "#FFFFFF", fontWeight: "bold" };
      if (abs >= 1.0) return { backgroundColor: "#EF9A9A", color: "#000000", fontWeight: "600" };
      return { backgroundColor: "#FFEBEE", color: "#000000" };
    }
  };

  // Bloomberg Terminal Heatmap Style for Columns M to U
  const getHeatmapStyle = (val: number) => {
    if (isNaN(val)) return {};
    const abs = Math.abs(val);
    if (val === 0) {
      return { backgroundColor: "#FFFFFF", color: "#000000", fontWeight: "650" };
    }
    if (val > 0) {
      if (abs >= 30.0) return { backgroundColor: "#1B5E20", color: "#FFFFFF", fontWeight: "bold" };
      if (abs >= 15.0) return { backgroundColor: "#43A047", color: "#FFFFFF", fontWeight: "bold" };
      if (abs >= 5.0) return { backgroundColor: "#A5D6A7", color: "#000000", fontWeight: "600" };
      return { backgroundColor: "#E8F5E9", color: "#000000" };
    } else {
      if (abs >= 30.0) return { backgroundColor: "#B71C1C", color: "#FFFFFF", fontWeight: "bold" };
      if (abs >= 15.0) return { backgroundColor: "#E53935", color: "#FFFFFF", fontWeight: "bold" };
      if (abs >= 5.0) return { backgroundColor: "#EF9A9A", color: "#000000", fontWeight: "600" };
      return { backgroundColor: "#FFEBEE", color: "#000000" };
    }
  };

  // Color intensity calculation for non-score gradient columns (like Change / Change %)
  const getIntensityClass = (val: number, isScore: boolean) => {
    if (isNaN(val)) return "";
    if (val === 0) {
      return "bg-slate-100 text-black font-semibold border border-slate-200";
    }
    const abs = Math.abs(val);
    // Change / changePercent: 0 -> 0.3 -> 0.8 -> 1.5 -> 3.0 -> infinity
    if (val > 0) {
      if (abs >= 3.0) return "bg-green-600 text-black font-black border border-green-750";
      if (abs >= 1.5) return "bg-green-500 text-black font-bold border border-green-600";
      if (abs >= 0.8) return "bg-green-400 text-black font-bold border border-green-300";
      if (abs >= 0.3) return "bg-green-200 text-black font-semibold border border-green-100";
      return "bg-green-50 text-black border border-green-100/30";
    } else {
      if (abs >= 3.0) return "bg-red-600 text-black font-black border border-red-750";
      if (abs >= 1.5) return "bg-red-500 text-black font-bold border border-red-600";
      if (abs >= 0.8) return "bg-red-400 text-black font-bold border border-red-300";
      if (abs >= 0.3) return "bg-red-200 text-black font-semibold border border-red-100";
      return "bg-red-50 text-black border border-red-100/30";
    }
  };

  // Pin NIFTY 50 / SENSEX index row to the very top (index 1 / row index 0)
  const indexStock = stocks.find(s => s.ticker === "NSE:NIFTY50-INDEX" || s.ticker === "BSE:SENSEX-INDEX" || s.ticker === "NSE:NIFTYBANK-INDEX");
  const individualStocks = stocks.filter(s => s.ticker !== "NSE:NIFTY50-INDEX" && s.ticker !== "BSE:SENSEX-INDEX" && s.ticker !== "NSE:NIFTYBANK-INDEX");

  const sortedIndividual = [...individualStocks]
    .filter(s => s.symbol.toUpperCase().includes(filterText.toUpperCase()))
    .sort((a, b) => {
      const valA = (a as any)[sortField];
      const valB = (b as any)[sortField];

      if (typeof valA === "string") {
        return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      return sortAsc ? (valA || 0) - (valB || 0) : (valB || 0) - (valA || 0);
    });

  const sortedStocks = indexStock && indexStock.symbol.toUpperCase().includes(filterText.toUpperCase())
    ? [indexStock, ...sortedIndividual]
    : sortedIndividual;

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  const handleCommitEdit = (row: number, col: number) => {
    const stock = sortedStocks[row];
    const column = COLUMNS[col];
    onEditCell(stock.symbol, column.id, editValue);
    setEditingCoords(null);
  };

  // Export spreadsheet as standard Excel CSV
  const handleExportCSV = () => {
    const headers = COLUMNS.map(c => c.label);
    const rows = sortedStocks.map(s => [
      s.symbol,
      s.ticker,
      s.ltp,
      s.prevClose,
      s.high || "",
      s.low || "",
      s.open || "",
      s.change || "",
      `${s.changePercent}%`,
      s.volume,
      s.lastTradedTime || "",
      s.weightage,
      s.score,
      s.backupScore,
      s.scoreDifference,
      s.score15m,
      s.score15mDiff,
      s.score30m,
      s.score30mDiff,
      s.score1h,
      s.score1hDiff
    ]);
    exportToCSV(`${page}_STOCK_ANALYZER_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
  };

  // Re-usable spreadsheet CSV drag & drop / upload importer
  const handleCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const lines = text.split("\n");
        const parsedRows: any[] = [];
        
        // Skip header index 0
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          
          const parts = line.split(",");
          if (parts.length >= 12) {
            parsedRows.push({
              symbol: parts[0].replace(/["]/g, ""),
              ticker: parts[1].replace(/["]/g, ""),
              ltp: parseFloat(parts[2]),
              prevClose: parseFloat(parts[3]),
              changePercent: parseFloat(parts[8]?.replace(/[%\s]/g, "")),
              volume: parseInt(parts[9]),
              weightage: parseFloat(parts[11]),
            });
          }
        }
        
        onCSVImport(parsedRows);
      } catch (err) {
        alert("Incorrect CSV schema. Please make sure columns align with Symbol, Ticker, LTP, and Prev Close.");
      }
    };
    reader.readAsText(file);
  };

  const colLetterOptions = [
    { letter: "N", label: "BACKUP SCORE" },
    { letter: "P", label: "15M BACKUP SCORE" },
    { letter: "R", label: "30M BACKUP SCORE" },
    { letter: "T", label: "1H BACKUP SCORE" }
  ];

  const handleForceCopy = async () => {
    try {
      const res = await fetch(getApiUrl("/api/stocks/copy-column"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page, targetCol: selectedCol })
      });
      if (res.ok) {
        const opt = colLetterOptions.find(o => o.letter === selectedCol);
        alert(`Successfully copied Column M (SCORE) data to Column ${selectedCol} (${opt?.label || ""})`);
      } else {
        const err = await res.json();
        alert(`Copy failed: ${err.error || "Unknown server error"}`);
      }
    } catch (err: any) {
      alert(`Copy failed: ${err.message}`);
    }
  };

  return (
    <div className="flex flex-col flex-1 h-full select-none bg-white">
      {/* Search Filter, Import and Excel export panel */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 border-b bg-slate-50 border-slate-200">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-700">
            Spreadsheet Filter:
          </span>
          <input
            type="text"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Type stock symbol (e.g. RELIANCE)..."
            className="px-3 py-1.5 text-xs border rounded w-60 outline-none h-8 font-mono bg-white border-slate-300 text-slate-800 focus:border-emerald-600"
          />
        </div>

        <div className="flex items-center gap-2">
          {/* Force Copy State */}
          <select
            value={selectedCol}
            onChange={(e) => setSelectedCol(e.target.value)}
            className="px-3 py-1 text-xs border rounded outline-none h-8 font-mono font-bold bg-white border-slate-300 text-slate-800"
          >
            {colLetterOptions.map(opt => (
              <option key={opt.letter} value={opt.letter}>
                {opt.letter} - {opt.label}
              </option>
            ))}
          </select>
          <button
            onClick={handleForceCopy}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white bg-indigo-600 hover:bg-indigo-700 font-bold rounded shadow cursor-pointer transition-colors h-8 mr-1"
          >
            <RefreshCw size={14} />
            Force Copy State
          </button>
          <div className="h-6 w-[1px] bg-slate-300 mx-1 hidden sm:block" />

          {/* CSV Import */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white bg-teal-600 hover:bg-teal-700 font-bold rounded shadow cursor-pointer transition-colors h-8"
          >
            <Upload size={14} />
            Import CSV
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleCSVUpload}
            accept=".csv"
            className="hidden"
          />

          {/* CSV Export */}
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white bg-emerald-600 hover:bg-emerald-700 font-bold rounded shadow cursor-pointer transition-colors h-8"
          >
            <Download size={14} />
            Export CSV
          </button>
        </div>
      </div>

      {/* Main Excel Sheet Frame */}
      <div 
        ref={gridRef}
        tabIndex={0}
        className="flex-1 overflow-auto bg-slate-100 focus:outline-none focus:ring-1 focus:ring-teal-500/20 cursor-default"
      >
        <table className="w-full text-left border-collapse border-separate border-spacing-0">
          {/* Alphabet Line Headers (Excel Header Column row) */}
          <thead>
            <tr className="h-6">
              {/* Corner Cell Index */}
              <th className="w-10 text-center text-[10px] border font-bold z-30 sticky top-0 left-0 bg-slate-200 text-black border-slate-300">
                /
              </th>
              {COLUMNS.map((col, index) => {
                const wClass = getColWidth(col.id);
                const headerBg = "bg-slate-200 text-black";
                return (
                  <th
                    key={col.id}
                    onClick={() => handleSort(col.id)}
                    className={`px-2 text-center border font-mono text-[10px] font-bold cursor-pointer hover:opacity-80 transition-all sticky top-0 z-20 border-slate-300 dark:border-slate-800 ${headerBg} ${
                      sortField === col.id ? "ring-1 ring-inset ring-emerald-400" : ""
                    } ${wClass}`}
                  >
                    <div className="flex items-center justify-between gap-0.5">
                      <span>
                        {col.letter === "N" ? `${col.letter} (${countdownText})` :
                         (col as any).isTimedBackup && (col as any).timerLabel === "15m"
                           ? <span className="flex flex-col items-start leading-none gap-0.5">
                               <span>{col.letter}</span>
                               <span className={`text-[8px] font-bold ${countdown15m === "00:00" || countdown15m.startsWith("00:0") ? "text-amber-600 animate-pulse" : "text-violet-600"}`}>
                                 ⏱ {countdown15m}
                               </span>
                             </span>
                           : (col as any).isTimedBackup && (col as any).timerLabel === "30m"
                           ? <span className="flex flex-col items-start leading-none gap-0.5">
                               <span>{col.letter}</span>
                               <span className={`text-[8px] font-bold ${countdown30m.startsWith("00:0") ? "text-amber-600 animate-pulse" : "text-violet-600"}`}>
                                 ⏱ {countdown30m}
                               </span>
                             </span>
                           : (col as any).isTimedBackup && (col as any).timerLabel === "1h"
                           ? <span className="flex flex-col items-start leading-none gap-0.5">
                               <span>{col.letter}</span>
                               <span className={`text-[8px] font-bold ${countdown1h.startsWith("00:00:0") ? "text-amber-600 animate-pulse" : "text-violet-600"}`}>
                                 ⏱ {countdown1h}
                               </span>
                             </span>
                           : col.letter}
                      </span>
                      <ArrowUpDown size={9} className="opacity-50" />
                    </div>
                  </th>
                );
              })}
            </tr>

            {/* Structured Metric Header Labels */}
            <tr className="h-8">
              <th className="text-center border border-slate-300 font-bold sticky left-0 top-6 z-30 bg-slate-200"></th>
              {COLUMNS.map((col) => {
                const wClass = getColWidth(col.id);
                const alignClass = "text-center";
                const labelBg = "bg-slate-200 text-black";
                return (
                  <th
                    key={col.id}
                    onClick={() => handleSort(col.id)}
                    className={`px-2.5 border border-slate-300 font-sans text-[11.5px] font-bold select-none cursor-pointer hover:opacity-80 sticky top-6 z-20 transition-colors ${labelBg} ${wClass} ${alignClass}`}
                  >
                    <div className="flex items-center justify-center gap-1 leading-tight">
                      <span>{col.label}</span>
                      {col.type === "formula" && (
                        <span className="text-[8px] font-mono text-emerald-800 font-bold bg-emerald-100 px-1 py-0.5 rounded border border-emerald-300 leading-none">
                          {col.expression}
                        </span>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>

          {/* Body Lines Spreadsheet Row Blocks */}
          <tbody className="divide-y divide-slate-200">
            {sortedStocks.map((stock, rowIndex) => {
              const excelRowIndex = rowIndex + 1;
              const isIndexRow = stock.ticker === "NSE:NIFTY50-INDEX" || stock.ticker === "BSE:SENSEX-INDEX" || stock.ticker === "NSE:NIFTYBANK-INDEX";
              return (
                <tr
                  key={stock.symbol}
                  className={`h-9 group transition-colors ${
                    isIndexRow
                      ? "bg-amber-50 text-amber-900 font-bold border-y border-amber-300"
                      : "hover:bg-slate-100/50"
                  }`}
                >
                  {/* Left Row Number Sticky Index block */}
                  <td className={`w-10 text-center font-mono text-xs font-semibold border sticky left-0 z-10 text-slate-500 ${
                    isIndexRow
                      ? "bg-amber-100/50 border-slate-300 border-l-4 border-l-amber-400"
                      : "bg-slate-200 border-slate-300 border-r-slate-400"
                  }`}>
                    {excelRowIndex}
                  </td>

                  {/* Individual spreadsheet cells mapping */}
                  {COLUMNS.map((col, colIndex) => {
                    const isSelected = selectedCoords?.row === rowIndex && selectedCoords?.col === colIndex;
                    const isEditing = editingCoords?.row === rowIndex && editingCoords?.col === colIndex;
                    const cellValue = (stock as any)[col.id];
                    
                     // Validation and Formatting Rules: "If data invalid: show ###"
                     const isInvalid = (val: any) => {
                       return val === undefined || val === null || val === "" || val === "###";
                     };

                     const isNAField = isIndexRow && (
                       col.id === "weightage" ||
                       col.id === "volume" ||
                       col.id === "score" ||
                       col.id === "backupScore" ||
                       col.id === "scoreDifference" ||
                       col.id === "score15m" ||
                       col.id === "score15mDiff" ||
                       col.id === "score30m" ||
                       col.id === "score30mDiff" ||
                       col.id === "score1h" ||
                       col.id === "score1hDiff"
                     );

                     let displayedText = cellValue;
                     if (isNAField) {
                       displayedText = "N/A";
                     } else if (isInvalid(cellValue)) {
                       displayedText = "###";
                     } else if (col.id === "symbol" || col.id === "ticker") {
                       displayedText = cellValue;
                     } else if (col.id === "lastTradedTime") {
                       if (typeof cellValue === "number" && cellValue > 0) {
                         const d = new Date(cellValue * 1000);
                         displayedText = d.toLocaleTimeString();
                       } else {
                         displayedText = cellValue || "###";
                       }
                     } else {
                       const num = Number(cellValue);
                       if (isNaN(num)) {
                         displayedText = "###";
                       } else if (col.id === "ltp" || col.id === "prevClose" || col.id === "high" || col.id === "low" || col.id === "open") {
                         if (num <= 0) displayedText = "###";
                         else displayedText = num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                       } else if (col.id === "change") {
                         displayedText = `${num > 0 ? "+" : ""}${num.toFixed(2)}`;
                       } else if (col.id === "changePercent") {
                         displayedText = `${num > 0 ? "+" : ""}${num.toFixed(2)}%`;
                       } else if (col.id === "volume") {
                         if (num < 0) displayedText = "###";
                         else displayedText = num.toLocaleString();
                       } else if (col.id === "weightage") {
                         if (isNaN(num)) displayedText = "###";
                         else displayedText = `${num > 0 ? "+" : ""}${num.toFixed(3)}%`;
                       } else if (col.id === "score" || col.id === "scoreDifference" || col.id === "backupScore" || col.id === "ltpBackup" ||
                                  col.id === "score15m" || col.id === "score15mDiff" ||
                                  col.id === "score30m" || col.id === "score30mDiff" ||
                                  col.id === "score1h"  || col.id === "score1hDiff") {
                         displayedText = `${num > 0 ? "+" : ""}${num.toFixed(3)}`;
                       }
                     }

                    // Intensity class calculations
                    const isScoreCol = col.id === "score" || col.id === "scoreDifference" ||
                      col.id === "score15mDiff" || col.id === "score30mDiff" || col.id === "score1hDiff";
                    const isTimedBackupScoreCol = col.id === "score15m" || col.id === "score30m" || col.id === "score1h" || col.id === "backupScore";
                    const isChgCol = col.id === "changePercent" || col.id === "change";
                    
                    const showGradient = !isIndexRow || col.id === "changePercent" || col.id === "change";
                     
                    const cellGradient = (showGradient && col.id === "change")
                      ? getIntensityClass(cellValue, false)
                      : "";

                    const customStyle = (showGradient && (isScoreCol || isTimedBackupScoreCol))
                      ? getHeatmapStyle(cellValue)
                      : (showGradient && col.id === "changePercent")
                      ? getPercentChangeStyle(cellValue)
                      : {};

                    const wClass = getColWidth(col.id);
                    const alignClass = getColAlign(col.id, col.type);

                    // Per-column default text/bg class when no heatmap gradient is applied
                    const getDefaultCellClass = () => {
                      if (cellGradient || (showGradient && col.id === "changePercent")) return ""; // heatmap overrides
                      if (col.id === "symbol") return "text-teal-700 font-extrabold";
                      if (col.id === "ticker") return "text-slate-800 font-bold text-[8.5px]";
                      if (col.id === "ltp") return "text-slate-900 font-bold";
                      if (col.id === "prevClose") return "text-slate-600";
                      if (col.id === "high") return "text-emerald-700 font-semibold";
                      if (col.id === "low") return "text-rose-700 font-semibold";
                      if (col.id === "open") return "text-sky-700";
                      if (col.id === "volume") return "text-amber-700";
                      if (col.id === "lastTradedTime") return "text-slate-500 text-[11px]";
                      if (col.id === "weightage") return "text-indigo-700 font-semibold";
                      return "text-slate-800";
                    };
                    const defaultCellClass = getDefaultCellClass();

                    // Row background alternation (clean light sheets banding)
                    const rowBg = !isIndexRow
                      ? (rowIndex % 2 === 0
                          ? "bg-white"
                          : "bg-slate-50")
                      : "";

                    return (
                      <td
                        key={col.id}
                        data-row={rowIndex}
                        data-col={colIndex}
                        onClick={() => setSelectedCoords({ row: rowIndex, col: colIndex })}
                        onDoubleClick={() => !isIndexRow && col.editable && setEditingCoords({ row: rowIndex, col: colIndex })}
                        style={customStyle}
                        className={`excel-cell anti-flicker-cell px-2.5 font-semibold border border-slate-200 font-mono select-none h-9 ${wClass} ${alignClass} ${rowBg} ${
                          isIndexRow
                            ? "text-amber-900 bg-amber-50/55"
                            : ""
                        } ${defaultCellClass} ${cellGradient} ${isSelected ? "excel-cell-active" : ""} ${isIndexRow ? "cursor-default" : "cursor-cell"} ${
                          col.id === "ticker" || isScoreCol || isTimedBackupScoreCol ? "text-[10px] font-bold" : "text-[13px]"
                        }`}
                      >
                        {isEditing ? (
                          <input
                            type="text"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={() => handleCommitEdit(rowIndex, colIndex)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleCommitEdit(rowIndex, colIndex);
                              if (e.key === "Escape") setEditingCoords(null);
                            }}
                            autoFocus
                            className="absolute inset-0 px-2 py-0.5 w-full h-full text-sm font-mono border-2 border-emerald-600 outline-none z-50 bg-white text-slate-900 dark:bg-slate-950 dark:text-emerald-400"
                          />
                        ) : (
                          <div className={`flex items-center w-full ${alignClass === "text-right" ? "justify-end" : "justify-between"}`}>
                            <span>{displayedText}</span>
                            {col.editable && !isIndexRow && (
                              <Edit size={10} className="opacity-0 group-hover:opacity-40 cursor-edit ml-1" />
                            )}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default React.memo(StockGrid);
