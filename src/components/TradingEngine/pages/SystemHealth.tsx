/**
 * SystemHealth.tsx — Live connection, latency, and data freshness monitor
 */
import React, { useState, useEffect, useRef } from "react";
import { Activity, Wifi, WifiOff, Clock, RefreshCw, CheckCircle, AlertCircle } from "lucide-react";

interface Props { serverTime?: number; activePage: string; }

const getApiUrl = (p: string) => (window.location.port === "5173" ? "http://localhost:3000" : "") + p;

interface ApiStatus { path: string; label: string; status: "OK" | "ERROR" | "CHECKING"; ms?: number }

const ENDPOINTS: { path: string; label: string }[] = [
  { path: "/api/te/signals?limit=1", label: "TE Signals DB" },
  { path: "/api/te/paper-trades?limit=1", label: "Paper Trades DB" },
  { path: "/api/te/lot-config", label: "Lot Config DB" },
  { path: "/api/backup/trigger", label: "Backup Engine" },
  { path: "/api/fyers/config", label: "Fyers Config" },
];

const SystemHealth: React.FC<Props> = ({ serverTime, activePage }) => {
  const [apiStatus, setApiStatus] = useState<ApiStatus[]>(ENDPOINTS.map(e => ({ ...e, status: "CHECKING" })));
  const [events, setEvents] = useState<{ time: string; event: string }[]>([]);
  const mountTime = useRef(Date.now());
  const [now, setNow] = useState(Date.now());

  // Update now every second
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Track server time events
  useEffect(() => {
    if (!serverTime) return;
    setEvents(prev => [
      { time: new Date().toLocaleTimeString("en-IN"), event: `server-time: ${new Date(serverTime).toLocaleTimeString("en-IN")}` },
      ...prev.slice(0, 19)
    ]);
  }, [serverTime]);

  // Check API endpoints
  const checkApis = async () => {
    setApiStatus(ENDPOINTS.map(e => ({ ...e, status: "CHECKING" })));
    for (const ep of ENDPOINTS) {
      const start = Date.now();
      try {
        const r = await fetch(getApiUrl(ep.path), { method: "GET", signal: AbortSignal.timeout(3000) });
        const ms = Date.now() - start;
        setApiStatus(prev => prev.map(s => s.path === ep.path ? { ...s, status: r.ok ? "OK" : "ERROR", ms } : s));
      } catch {
        setApiStatus(prev => prev.map(s => s.path === ep.path ? { ...s, status: "ERROR" } : s));
      }
    }
  };

  useEffect(() => { checkApis(); }, []);

  const latency = serverTime ? now - serverTime : null;
  const isConnected = serverTime ? (now - serverTime) < 5000 : false;
  const isStale = serverTime ? (now - serverTime) > 8000 : true;
  const uptimeS = Math.floor((now - mountTime.current) / 1000);
  const uptimeStr = uptimeS < 60 ? `${uptimeS}s` : uptimeS < 3600 ? `${Math.floor(uptimeS / 60)}m ${uptimeS % 60}s` : `${Math.floor(uptimeS / 3600)}h ${Math.floor((uptimeS % 3600) / 60)}m`;

  return (
    <div className="p-4 space-y-4" style={{ fontFamily: "'Inter', sans-serif" }}>
      <div>
        <h1 className="text-xl font-black text-white flex items-center gap-2"><Activity size={18} className="text-indigo-400" /> System Health</h1>
        <p className="text-base text-slate-500 mt-0.5">Connection · Latency · API status · {activePage}</p>
      </div>

      {/* Connection + Latency cards */}
      <div className="grid grid-cols-4 gap-3">
        <div className={`rounded-xl border p-4 ${isConnected ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-500/30 bg-red-500/5"}`}>
          <div className="flex items-center gap-2 mb-2">
            {isConnected ? <Wifi size={14} className="text-emerald-400" /> : <WifiOff size={14} className="text-red-400" />}
            <span className="text-sm text-slate-500 uppercase font-black">WebSocket</span>
          </div>
          <div className={`text-base font-black ${isConnected ? "text-emerald-400" : "text-red-400"}`}>
            {isConnected ? "CONNECTED" : "DISCONNECTED"}
          </div>
          <div className="text-sm text-slate-600 mt-0.5">Socket.IO → server</div>
        </div>

        <div className={`rounded-xl border p-4 ${latency !== null && latency < 3000 ? "border-slate-700/30 bg-slate-900/30" : "border-amber-500/30 bg-amber-500/5"}`}>
          <div className="flex items-center gap-2 mb-2">
            <Clock size={14} className="text-indigo-400" />
            <span className="text-sm text-slate-500 uppercase font-black">Latency</span>
          </div>
          <div className="text-base font-black text-white">
            {latency !== null ? `${latency}ms` : "—"}
          </div>
          <div className="text-sm text-slate-600 mt-0.5">{latency && latency < 1000 ? "Excellent" : latency && latency < 3000 ? "Good" : "Degraded"}</div>
        </div>

        <div className={`rounded-xl border p-4 ${!isStale ? "border-slate-700/30 bg-slate-900/30" : "border-amber-500/30 bg-amber-500/5"}`}>
          <div className="flex items-center gap-2 mb-2">
            <RefreshCw size={14} className={isStale ? "text-amber-400 animate-spin" : "text-slate-400"} />
            <span className="text-sm text-slate-500 uppercase font-black">Data Freshness</span>
          </div>
          <div className={`text-base font-black ${!isStale ? "text-emerald-400" : "text-amber-400"}`}>
            {!isStale ? "FRESH" : "STALE"}
          </div>
          <div className="text-sm text-slate-600 mt-0.5">
            {serverTime ? `Last: ${((now - serverTime) / 1000).toFixed(1)}s ago` : "No data"}
          </div>
        </div>

        <div className="rounded-xl border border-slate-700/30 bg-slate-900/30 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Activity size={14} className="text-indigo-400" />
            <span className="text-sm text-slate-500 uppercase font-black">Page Uptime</span>
          </div>
          <div className="text-base font-black text-white">{uptimeStr}</div>
          <div className="text-sm text-slate-600 mt-0.5">Since page load</div>
        </div>
      </div>

      {/* Data Freshness Warning */}
      {isStale && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 flex items-start gap-2">
          <AlertCircle size={13} className="text-amber-400 mt-0.5 flex-shrink-0" />
          <div className="text-base text-amber-300">Data is stale! Server time hasn't updated in {latency !== null ? `${((now - serverTime!) / 1000).toFixed(0)}s` : "a while"}. Check WebSocket connection and server status.</div>
        </div>
      )}

      {/* API Endpoint Health */}
      <div className="rounded-xl border border-slate-800/50 bg-[#08101a] overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-800/50 flex items-center justify-between">
          <span className="text-sm font-black text-slate-400 uppercase tracking-wider">API Endpoint Status</span>
          <button onClick={checkApis} className="text-sm text-slate-400 hover:text-slate-200 cursor-pointer flex items-center gap-1">
            <RefreshCw size={10} /> Recheck
          </button>
        </div>
        <table className="w-full text-base">
          <thead><tr className="border-b border-slate-800/30 text-sm text-slate-500 uppercase">
            <th className="p-2 pl-4 text-left">Endpoint</th>
            <th className="p-2 text-center">Status</th>
            <th className="p-2 pr-4 text-right">Latency</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-800/20">
            {apiStatus.map(ep => (
              <tr key={ep.path} className="hover:bg-slate-800/20">
                <td className="p-2 pl-4">
                  <div className="text-slate-300 font-semibold">{ep.label}</div>
                  <div className="text-sm text-slate-600 font-mono">{ep.path}</div>
                </td>
                <td className="p-2 text-center">
                  {ep.status === "CHECKING" ? (
                    <span className="text-sm text-slate-500 animate-pulse">Checking...</span>
                  ) : ep.status === "OK" ? (
                    <span className="flex items-center justify-center gap-1 text-emerald-400 text-sm font-black">
                      <CheckCircle size={10} /> OK
                    </span>
                  ) : (
                    <span className="flex items-center justify-center gap-1 text-red-400 text-sm font-black">
                      <AlertCircle size={10} /> ERROR
                    </span>
                  )}
                </td>
                <td className="p-2 pr-4 text-right font-mono text-sm">
                  {ep.ms !== undefined ? <span className={ep.ms < 100 ? "text-emerald-400" : ep.ms < 500 ? "text-amber-400" : "text-red-400"}>{ep.ms}ms</span> : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Socket Events Log */}
      <div className="rounded-xl border border-slate-800/50 bg-[#08101a] overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-800/50">
          <span className="text-sm font-black text-slate-400 uppercase tracking-wider">Recent Socket Events</span>
        </div>
        <div className="p-3 space-y-1 max-h-40 overflow-y-auto custom-dashboard-scrollbar">
          {events.length === 0 ? (
            <div className="text-sm text-slate-600 text-center py-3">No events received yet</div>
          ) : events.map((e, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-sm text-slate-600 font-mono w-14 flex-shrink-0">{e.time}</span>
              <span className="text-sm text-slate-400 font-mono">{e.event}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default SystemHealth;

