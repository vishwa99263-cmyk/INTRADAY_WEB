/**
 * ProcessorTab.tsx
 * Institutional-grade diagnostic terminal showing live computations, comparative alignment, and server logs.
 */

import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Activity, Cpu, Server, AlertTriangle, ShieldCheck,
  RefreshCw, Terminal, CheckCircle2, XCircle, Clock, Zap
} from "lucide-react";

interface ProcessorTabProps {
  socket?: any;
  aiAnalysis: any;          // NIFTY payload
  aiAnalysisSensex: any;    // SENSEX payload
  aiAnalysisBanknifty: any;  // BANKNIFTY payload
  niftyOptionChain: any;
  sensexOptionChain: any;
  bankniftyOptionChain: any;
  niftySpot: number;
  sensexSpot: number;
  bankniftySpot: number;
  activePage: "NIFTY" | "BANKNIFTY" | "SENSEX";
}

interface LogMessage {
  timestamp: number;
  level: "info" | "warn" | "error";
  message: string;
}

interface EngineState {
  marketOpen: boolean;
  connectionStatus: string;
  fyersAuthorized: boolean;
  lastFyersError: string;
  serverTime: number;
}

interface AutoConfig {
  isActive: boolean;
  mode: "PAPER" | "LIVE";
  maxTradesLimit: number;
}

export const ProcessorTab: React.FC<ProcessorTabProps> = ({
  socket,
  aiAnalysis,
  aiAnalysisSensex,
  aiAnalysisBanknifty,
  niftyOptionChain,
  sensexOptionChain,
  bankniftyOptionChain,
  niftySpot,
  sensexSpot,
  bankniftySpot,
  activePage
}) => {
  const [logs, setLogs] = useState<LogMessage[]>([]);
  const [engineState, setEngineState] = useState<EngineState>({
    marketOpen: false,
    connectionStatus: "DISCONNECTED",
    fyersAuthorized: false,
    lastFyersError: "",
    serverTime: Date.now()
  });
  const [autoConfig, setAutoConfig] = useState<AutoConfig>({
    isActive: false,
    mode: "PAPER",
    maxTradesLimit: 100
  });
  const [activePositionsCount, setActivePositionsCount] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const logTerminalRef = useRef<HTMLDivElement>(null);

  const isLocal = typeof window !== "undefined" && (window.location.port === "5173" || window.location.protocol === "file:");
  const baseApi = isLocal ? "http://localhost:3000" : "";

  // ── Fetch Initial Data ──
  const fetchData = async () => {
    setLoading(true);
    try {
      // 1. Fetch market state
      const stateRes = await fetch(`${baseApi}/api/market/state`);
      if (stateRes.ok) {
        const data = await stateRes.json();
        setEngineState({
          marketOpen: data.connectionStatus === "LIVE",
          connectionStatus: data.connectionStatus,
          fyersAuthorized: data.fyersAuthorized,
          lastFyersError: data.lastFyersError || "",
          serverTime: data.serverTime || Date.now()
        });
      }

      // 2. Fetch autotrade config
      const configRes = await fetch(`${baseApi}/api/te/autotrade/status`);
      if (configRes.ok) {
        const data = await configRes.json();
        if (data.success && data.config) {
          setAutoConfig({
            isActive: data.config.isActive,
            mode: data.config.mode,
            maxTradesLimit: data.config.maxTradesLimit ?? 100
          });
        }
      }

      // 3. Fetch initial logs
      const logsRes = await fetch(`${baseApi}/api/te/engine-logs`);
      if (logsRes.ok) {
        const data = await logsRes.json();
        if (data.success && data.logs) {
          setLogs(data.logs);
        }
      }

      // 4. Fetch open positions count
      const tradesRes = await fetch(`${baseApi}/api/te/paper-trades?status=OPEN`);
      if (tradesRes.ok) {
        const data = await tradesRes.json();
        if (data.success && data.trades) {
          setActivePositionsCount(data.trades.length);
        }
      }
    } catch (err) {
      console.error("[ProcessorTab] Error fetching diagnostics:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000); // Poll health status every 5 seconds
    return () => clearInterval(interval);
  }, []);

  // ── WebSocket Log & Config Listeners ──
  useEffect(() => {
    if (!socket) return;

    const handleNewLog = (logItem: LogMessage) => {
      setLogs(prev => {
        const updated = [...prev, logItem];
        if (updated.length > 200) updated.shift();
        return updated;
      });
    };

    const handleConfigUpdate = (config: any) => {
      setAutoConfig({
        isActive: config.isActive,
        mode: config.mode,
        maxTradesLimit: config.maxTradesLimit ?? 100
      });
    };

    const handlePositionUpdate = () => {
      // Re-fetch open trades count on placement/close
      fetch(`${baseApi}/api/te/paper-trades?status=OPEN`)
        .then(res => res.json())
        .then(data => {
          if (data.success && data.trades) {
            setActivePositionsCount(data.trades.length);
          }
        }).catch(() => {});
    };

    socket.on("engine-log", handleNewLog);
    socket.on("autotrade-status-update", handleConfigUpdate);
    socket.on("paper-trade-closed", handlePositionUpdate);
    socket.on("toast-trigger", handlePositionUpdate);

    return () => {
      socket.off("engine-log", handleNewLog);
      socket.off("autotrade-status-update", handleConfigUpdate);
      socket.off("paper-trade-closed", handlePositionUpdate);
      socket.off("toast-trigger", handlePositionUpdate);
    };
  }, [socket]);

  // Auto-scroll logs
  useEffect(() => {
    if (logTerminalRef.current) {
      logTerminalRef.current.scrollTop = logTerminalRef.current.scrollHeight;
    }
  }, [logs]);

  // ── Process Comparison Matrix Data ──
  const indexesData = useMemo(() => {
    return [
      {
        name: "NIFTY",
        spot: niftySpot,
        vix: niftyOptionChain?.indiaVix ?? 15,
        expiry: niftyOptionChain?.selectedExpiry ?? "N/A",
        payload: aiAnalysis
      },
      {
        name: "BANKNIFTY",
        spot: bankniftySpot,
        vix: bankniftyOptionChain?.indiaVix ?? 15,
        expiry: bankniftyOptionChain?.selectedExpiry ?? "N/A",
        payload: aiAnalysisBanknifty || aiAnalysis
      },
      {
        name: "SENSEX",
        spot: sensexSpot,
        vix: sensexOptionChain?.indiaVix ?? 15,
        expiry: sensexOptionChain?.selectedExpiry ?? "N/A",
        payload: aiAnalysisSensex || aiAnalysis
      }
    ];
  }, [
    niftySpot, bankniftySpot, sensexSpot,
    niftyOptionChain, bankniftyOptionChain, sensexOptionChain,
    aiAnalysis, aiAnalysisBanknifty, aiAnalysisSensex
  ]);

  const clearConsole = () => {
    setLogs([]);
  };

  return (
    <div className="p-4 space-y-4 text-slate-200 bg-[#040811] min-h-full">
      {/* ── HEADER ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded bg-indigo-950/60 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
            <Cpu size={18} className="animate-pulse" />
          </div>
          <div>
            <h1 className="text-base font-black uppercase tracking-wider text-slate-100 flex items-center gap-2">
              AMEX Engine Processor Terminal
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
            </h1>
            <p className="text-xs text-slate-500 font-mono">
              Live computations, alignment matrix, trade gating diagnostic console.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end md:self-auto font-mono">
          <div className="px-2.5 py-1 rounded bg-slate-900 border border-slate-800 text-[10px] text-slate-400 flex items-center gap-1.5">
            <Clock size={11} />
            <span>Server Time: {new Date(engineState.serverTime).toLocaleTimeString()}</span>
          </div>
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 text-white rounded text-xs font-bold transition-all cursor-pointer shadow-md"
          >
            <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
            <span>Sync</span>
          </button>
        </div>
      </div>

      {/* ── METRICS ROW ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Connection */}
        <div className="bg-[#060d1a] border border-slate-800/60 rounded-lg p-3.5 flex items-center gap-3">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${engineState.connectionStatus === "LIVE" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-red-500/10 text-red-400 border border-red-500/20"}`}>
            <Server size={18} />
          </div>
          <div>
            <div className="text-[10px] text-slate-500 font-mono uppercase">Socket Heartbeat</div>
            <div className="text-sm font-black uppercase text-slate-200 tracking-wide font-mono">
              {engineState.connectionStatus === "LIVE" ? "CONNECTED" : engineState.connectionStatus}
            </div>
          </div>
        </div>

        {/* Fyers Auth Status */}
        <div className="bg-[#060d1a] border border-slate-800/60 rounded-lg p-3.5 flex items-center gap-3">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${engineState.fyersAuthorized ? "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20" : "bg-amber-500/10 text-amber-400 border border-amber-500/20"}`}>
            <ShieldCheck size={18} />
          </div>
          <div>
            <div className="text-[10px] text-slate-500 font-mono uppercase">Fyers Link Status</div>
            <div className="text-sm font-black uppercase text-slate-200 tracking-wide font-mono">
              {engineState.fyersAuthorized ? "AUTHORIZED" : "UNAUTHORIZED"}
            </div>
          </div>
        </div>

        {/* Active Positions */}
        <div className="bg-[#060d1a] border border-slate-800/60 rounded-lg p-3.5 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center justify-center">
            <Activity size={18} />
          </div>
          <div>
            <div className="text-[10px] text-slate-500 font-mono uppercase">Active Positions</div>
            <div className="text-sm font-black text-slate-200 tracking-wide font-mono">
              {activePositionsCount} OPEN TRADE{activePositionsCount !== 1 ? "S" : ""}
            </div>
          </div>
        </div>

        {/* AutoTrader configuration */}
        <div className="bg-[#060d1a] border border-slate-800/60 rounded-lg p-3.5 flex items-center gap-3">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${autoConfig.isActive ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-slate-800 text-slate-500"}`}>
            <Zap size={18} />
          </div>
          <div>
            <div className="text-[10px] text-slate-500 font-mono uppercase">Auto Trading System</div>
            <div className="text-sm font-black text-slate-200 tracking-wide font-mono uppercase">
              {autoConfig.isActive ? `ON (${autoConfig.mode} · Lmt: ${autoConfig.maxTradesLimit})` : "INACTIVE"}
            </div>
          </div>
        </div>
      </div>

      {/* ── COMPARATIVE STRATEGY ALIGNMENT MATRIX ── */}
      <div className="border border-slate-800/60 rounded-xl bg-[#060d1a]/60 p-4 space-y-3">
        <h2 className="text-sm font-black uppercase tracking-wider text-slate-300 flex items-center gap-2">
          <Cpu size={14} className="text-indigo-400" />
          Comparative Strategy Alignment Matrix
        </h2>

        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-500 uppercase text-[10px]">
                <th className="py-2.5 px-3">Index Symbol</th>
                <th className="py-2.5 px-3 text-right">LTP / SPOT</th>
                <th className="py-2.5 px-3 text-center">VIX / EXPIRY</th>
                <th className="py-2.5 px-3 text-center">Final Signal</th>
                <th className="py-2.5 px-3 text-center">AI Confidence</th>
                <th className="py-2.5 px-3">Dominant Strategy</th>
                <th className="py-2.5 px-3">Gates Gating Status</th>
              </tr>
            </thead>
            <tbody>
              {indexesData.map(idx => {
                const hasPayload = idx.payload && idx.payload.antigravity;

                const antigravity = hasPayload ? idx.payload.antigravity : null;
                const alignment = hasPayload ? idx.payload.alignment : null;

                const finalSignal = antigravity ? antigravity.finalSignal : "WAIT";
                const conviction = antigravity ? antigravity.antigravityScore : 50;
                const grade = antigravity ? antigravity.signalGrade : "C";
                const regime = antigravity ? antigravity.marketRegime : "RANGING";
                const dominant = alignment ? alignment.dominantStrategy : "NONE";
                const blocked = alignment ? alignment.noTradeFilter : true;
                const blockedReason = alignment ? alignment.noTradeReason : "Waiting for first tick...";

                const signalColors =
                  finalSignal === "BUY_CE" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" :
                  finalSignal === "BUY_PE" ? "bg-rose-500/10 text-rose-400 border border-rose-500/20" :
                  "bg-slate-800 text-slate-500";

                return (
                  <tr key={idx.name} className="border-b border-slate-900/60 hover:bg-slate-900/10 transition-colors">
                    <td className="py-3 px-3 font-bold text-slate-300 flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${hasPayload ? "bg-indigo-500 animate-pulse" : "bg-slate-700"}`}></span>
                      {idx.name}
                    </td>
                    <td className="py-3 px-3 text-right text-slate-300 font-bold">
                      {idx.spot > 0 ? idx.spot.toFixed(2) : "0.00"}
                    </td>
                    <td className="py-3 px-3 text-center text-slate-400">
                      VIX {idx.vix.toFixed(1)} <span className="opacity-40">|</span> <span className="text-[10px]">{idx.expiry}</span>
                    </td>
                    <td className="py-3 px-3 text-center">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-black tracking-wider ${signalColors}`}>
                        {finalSignal}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-center">
                      {antigravity ? (
                        <div className="flex flex-col items-center">
                          <span className="font-bold text-indigo-400">{conviction.toFixed(1)}%</span>
                          <span className="text-[9px] text-slate-500 font-black">GRADE {grade}</span>
                        </div>
                      ) : (
                        <span className="text-slate-600">--</span>
                      )}
                    </td>
                    <td className="py-3 px-3">
                      {antigravity ? (
                        <div className="flex flex-col">
                          <span className="text-slate-300 font-black text-[11px] uppercase">{dominant.replace(/_/g, " ")}</span>
                          <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">{regime.replace(/_/g, " ")}</span>
                        </div>
                      ) : (
                        <span className="text-slate-600">--</span>
                      )}
                    </td>
                    <td className="py-3 px-3 max-w-[280px]">
                      {alignment ? (
                        <div className="flex items-start gap-1.5">
                          {blocked ? (
                            <XCircle size={13} className="text-rose-500 mt-0.5 flex-shrink-0" />
                          ) : (
                            <CheckCircle2 size={13} className="text-emerald-500 mt-0.5 flex-shrink-0" />
                          )}
                          <div className="flex flex-col">
                            <span className={`font-bold ${blocked ? "text-rose-500" : "text-emerald-500"}`}>
                              {blocked ? "BLOCKED" : "READY"}
                            </span>
                            <span className="text-[10px] text-slate-500 leading-3">{blockedReason}</span>
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-600">Waiting for payload...</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── LOWER SECTION ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Active Errors & System Health (Left col) */}
        <div className="lg:col-span-1 border border-slate-800/60 rounded-xl bg-[#060d1a]/40 p-4 flex flex-col justify-between space-y-4">
          <div className="space-y-4">
            <h2 className="text-sm font-black uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <AlertTriangle size={14} className="text-amber-500" />
              Active System Alerts & Errors
            </h2>

            {/* Error cards */}
            <div className="space-y-3 overflow-y-auto max-h-[220px] custom-dashboard-scrollbar">
              {/* Fyers authorization error */}
              {engineState.lastFyersError ? (
                <div className="p-3 rounded bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-mono space-y-1.5">
                  <div className="flex items-center gap-1.5 font-black uppercase text-[10px] text-rose-400">
                    <AlertTriangle size={12} />
                    <span>Fyers API Error</span>
                  </div>
                  <p className="leading-4">{engineState.lastFyersError}</p>
                </div>
              ) : null}

              {/* No active error state */}
              {!engineState.lastFyersError ? (
                <div className="p-4 rounded border border-slate-900 bg-slate-950/45 text-center text-slate-500 text-xs font-mono py-8">
                  <ShieldCheck size={20} className="mx-auto mb-1.5 opacity-25 text-emerald-400" />
                  <span>No active critical authorization errors detected. All systems green.</span>
                </div>
              ) : null}
            </div>
          </div>

          <div className="border-t border-slate-800/60 pt-3 text-[10px] text-slate-500 font-mono space-y-1">
            <div>💡 **India VIX** captures general option premium markup.</div>
            <div>💡 **Simulation Bypass** executes trades using simulator feeds.</div>
          </div>
        </div>

        {/* Live Logs Console (Right cols) */}
        <div className="lg:col-span-2 border border-slate-800/60 rounded-xl bg-[#060d1a]/40 p-4 space-y-3 flex flex-col h-[320px]">
          <div className="flex items-center justify-between flex-shrink-0">
            <h2 className="text-sm font-black uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <Terminal size={14} className="text-indigo-400" />
              Live Engine Console Logs
            </h2>

            <button
              onClick={clearConsole}
              className="px-2 py-0.5 border border-slate-850 hover:bg-slate-900/50 rounded text-[9px] font-black uppercase font-mono cursor-pointer transition-colors"
            >
              Clear
            </button>
          </div>

          {/* Terminal log panel */}
          <div
            ref={logTerminalRef}
            className="flex-1 overflow-y-auto bg-black/50 border border-slate-900/80 rounded-lg p-3 font-mono text-[11px] space-y-1.5 custom-dashboard-scrollbar select-text selection:bg-indigo-900/50 selection:text-white"
          >
            {logs.length === 0 ? (
              <div className="text-slate-600 italic py-4 text-center">
                Waiting for system logging streams...
              </div>
            ) : (
              logs.map((log, idx) => {
                const dateStr = new Date(log.timestamp).toLocaleTimeString();
                const levelColors =
                  log.level === "error" ? "text-rose-500 font-bold" :
                  log.level === "warn" ? "text-amber-500" :
                  "text-indigo-400";
                
                return (
                  <div key={idx} className="leading-4 flex gap-1.5">
                    <span className="text-slate-600 flex-shrink-0">[{dateStr}]</span>
                    <span className={`${levelColors} flex-shrink-0 uppercase text-[9px] font-black tracking-wider`}>
                      [{log.level}]
                    </span>
                    <span className="text-slate-300 break-all">{log.message}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProcessorTab;
