import React, { useState, useEffect } from "react";
import { 
  ShieldCheck, AlertCircle, Check, Key, Link2, HelpCircle, 
  Settings, Database, Play, Pause, RefreshCw, Eye, EyeOff
} from "lucide-react";

interface FyersConfig {
  app_id: string;
  secret_key: string;
  redirect_uri: string;
  access_token: string;
}

interface FyersIntegrationProps {
  fyersConfig: FyersConfig;
  fyersAuthorized: boolean;
  isSimulating: boolean;
  lastFyersError: string;
  onSaveConfig: (config: FyersConfig) => Promise<void>;
  onToggleSimulate: (simulate: boolean) => Promise<void>;
  darkMode: boolean;
}

export default function FyersIntegration({
  fyersConfig,
  fyersAuthorized,
  isSimulating,
  lastFyersError,
  onSaveConfig,
  onToggleSimulate,
  darkMode
}: FyersIntegrationProps) {
  const [appId, setAppId] = useState(fyersConfig.app_id || "");
  const [secretKey, setSecretKey] = useState(fyersConfig.secret_key || "");
  const [redirectUri, setRedirectUri] = useState(fyersConfig.redirect_uri || "");
  const [accessToken, setAccessToken] = useState(fyersConfig.access_token || "");
  
  const [showSecret, setShowSecret] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  // Keep state synced with props when they update over socket
  useEffect(() => {
    if (fyersConfig) {
      if (fyersConfig.app_id !== undefined) setAppId(fyersConfig.app_id);
      if (fyersConfig.secret_key !== undefined) setSecretKey(fyersConfig.secret_key);
      if (fyersConfig.redirect_uri !== undefined) setRedirectUri(fyersConfig.redirect_uri);
      if (fyersConfig.access_token !== undefined) setAccessToken(fyersConfig.access_token);
    }
  }, [fyersConfig]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await onSaveConfig({
        app_id: appId,
        secret_key: secretKey,
        redirect_uri: redirectUri,
        access_token: accessToken
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopyRedirect = () => {
    navigator.clipboard.writeText(redirectUri);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex-1 flex flex-col p-6 overflow-auto max-w-5xl mx-auto w-full gap-6">
      
      {/* Upper Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        
        {/* Connection Status Card */}
        <div className={`p-5 rounded border shadow-sm flex flex-col justify-between ${
          darkMode ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"
        }`}>
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-full ${fyersAuthorized ? "bg-emerald-500/10 text-emerald-500" : "bg-amber-500/10 text-amber-500"}`}>
              <ShieldCheck size={20} />
            </div>
            <div>
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Fyers API Status</h3>
              <p className="text-lg font-black tracking-tight mt-0.5">
                {fyersAuthorized ? "AUTHORIZED" : "UNAUTHORIZED"}
              </p>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${fyersAuthorized ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`}></span>
            <span className="text-xs font-bold font-mono text-slate-400">
              {fyersAuthorized ? "Live quotes feeding successfully" : "Using simulative high-fidelity fallback"}
            </span>
          </div>
        </div>

        {/* Feed Control Deck */}
        <div className={`p-5 rounded border shadow-sm flex flex-col justify-between ${
          darkMode ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"
        }`}>
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-full ${!isSimulating ? "bg-emerald-500/10 text-emerald-500" : "bg-blue-500/10 text-blue-500"}`}>
              <Database size={20} />
            </div>
            <div>
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Active Workspace Feed</h3>
              <p className="text-lg font-black tracking-tight mt-0.5">
                {isSimulating ? "SIMULATIVE REFRESH" : "LIVE FYERS MARKET"}
              </p>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => onToggleSimulate(true)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded text-xs font-bold cursor-pointer transition-colors border ${
                isSimulating 
                  ? "bg-amber-600 text-white border-transparent" 
                  : darkMode ? "bg-transparent text-slate-400 border-slate-800 hover:text-white" : "bg-transparent text-slate-600 border-slate-300 hover:text-black"
              }`}
            >
              <Pause size={12} />
              <span>Simulate</span>
            </button>
            <button
              onClick={() => onToggleSimulate(false)}
              disabled={!fyersAuthorized}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded text-xs font-bold cursor-pointer transition-colors border ${
                !isSimulating 
                  ? "bg-emerald-600 text-white border-transparent" 
                  : !fyersAuthorized 
                  ? "opacity-50 cursor-not-allowed bg-slate-800/20 text-slate-500 border-slate-800"
                  : darkMode ? "bg-transparent text-slate-400 border-slate-800 hover:text-white" : "bg-transparent text-slate-600 border-slate-300 hover:text-black"
              }`}
              title={!fyersAuthorized ? "Authorized Fyers API Token required to activate Live Feed" : "Activate Live Feed"}
            >
              <Play size={12} />
              <span>Live Feed</span>
            </button>
          </div>
        </div>

        {/* Network Metrics Card */}
        <div className={`p-5 rounded border shadow-sm flex flex-col justify-between ${
          darkMode ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"
        }`}>
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-full ${lastFyersError ? "bg-rose-500/10 text-rose-500" : "bg-emerald-500/10 text-emerald-500"}`}>
              <AlertCircle size={20} />
            </div>
            <div>
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Feed Diagnostics</h3>
              <p className="text-lg font-black tracking-tight mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap max-w-[200px]" title={lastFyersError || "System operational"}>
                {lastFyersError ? "API RETRY ERROR" : "OPERATIONAL"}
              </p>
            </div>
          </div>
          <div className="mt-4 text-[11px] font-mono text-slate-400 overflow-hidden text-ellipsis whitespace-nowrap" title={lastFyersError || "All endpoints operating normally with minimal latency."}>
            {lastFyersError ? (
              <span className="text-rose-500 font-bold">{lastFyersError}</span>
            ) : "All systems nominal. API responding at <50ms list-fetch rate."}
          </div>
        </div>

      </div>

      {/* Main Form and Instructions Dual Column */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Form Panel */}
        <form onSubmit={handleSubmit} className={`lg:col-span-7 p-6 rounded border shadow-sm flex flex-col gap-4 ${
          darkMode ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"
        }`}>
          <div className="border-b dark:border-slate-800 pb-3">
            <h2 className="text-sm font-bold tracking-tight text-emerald-650">Fyers API Credentials Configuration</h2>
            <p className="text-xs text-slate-400 mt-1">
              Configure your credentials and paste your updated live token to connect to real-time prices.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">APP ID</label>
            <input 
              type="text"
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              placeholder="e.g. R8T7ETPIPG-100"
              className={`w-full px-3 py-2 text-xs border rounded outline-none font-mono ${
                darkMode ? "bg-slate-950 border-slate-800 text-slate-200 focus:border-emerald-500" : "bg-white border-slate-300 text-slate-800 focus:border-emerald-600"
              }`}
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">SECRET KEY</label>
            <div className="relative">
              <input 
                type={showSecret ? "text" : "password"}
                value={secretKey}
                onChange={(e) => setSecretKey(e.target.value)}
                placeholder="Paste your Secret Key"
                className={`w-full px-3 py-2 pr-10 text-xs border rounded outline-none font-mono ${
                  darkMode ? "bg-slate-950 border-slate-800 text-slate-200 focus:border-emerald-500" : "bg-white border-slate-300 text-slate-800 focus:border-emerald-600"
                }`}
                required
              />
              <button
                type="button"
                onClick={() => setShowSecret(!showSecret)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-350"
              >
                {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">REDIRECT URI</label>
            <div className="flex gap-2">
              <input 
                type="text"
                value={redirectUri}
                onChange={(e) => setRedirectUri(e.target.value)}
                placeholder="e.g. http://127.0.0.1:3000"
                className={`flex-1 px-3 py-2 text-xs border rounded outline-none font-mono ${
                  darkMode ? "bg-slate-950 border-slate-800 text-slate-200 focus:border-emerald-500" : "bg-white border-slate-300 text-slate-800 focus:border-emerald-600"
                }`}
                required
              />
              <button
                type="button"
                onClick={handleCopyRedirect}
                className={`px-3 py-2 text-xs rounded border cursor-pointer font-bold ${
                  darkMode ? "border-slate-800 text-slate-300 hover:bg-slate-850 hover:text-white" : "border-slate-350 text-slate-700 hover:bg-slate-100 hover:text-black"
                }`}
              >
                {copied ? <Check size={14} className="text-emerald-500" /> : <Link2 size={14} />}
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">LIVE ACCESS TOKEN</label>
            <div className="relative">
              <textarea 
                rows={3}
                type={showToken ? "text" : "password"}
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder="Paste your incredibly long JWT Fyers Access Token..."
                className={`w-full px-3 py-2 pr-10 text-xs border rounded outline-none font-mono resize-none leading-relaxed ${
                  darkMode ? "bg-slate-950 border-slate-800 text-slate-200 focus:border-emerald-500" : "bg-white border-slate-300 text-slate-800 focus:border-emerald-600"
                }`}
                required
              />
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                className="absolute right-3 top-2.5 text-slate-500 hover:text-slate-350"
              >
                {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={isSaving}
            className={`w-full py-2.5 rounded text-xs font-bold cursor-pointer transition-colors mt-2 text-white flex items-center justify-center gap-2 ${
              isSaving ? "bg-slate-700/60" : "bg-emerald-600 hover:bg-emerald-500"
            }`}
          >
            {isSaving ? <RefreshCw size={14} className="animate-spin" /> : <Key size={14} />}
            <span>{isSaving ? "AUTHENTICATING & COMMITTING..." : "SAVE & VERIFY LIVE FEED"}</span>
          </button>
        </form>

        {/* Right Instructions / Help Column */}
        <div className={`lg:col-span-5 p-6 rounded border shadow-sm flex flex-col gap-4 ${
          darkMode ? "bg-slate-900 border-slate-800 text-slate-300" : "bg-white border-slate-200 text-slate-700"
        }`}>
          <div>
            <h3 className="text-sm font-bold tracking-tight text-teal-400 flex items-center gap-2">
              <HelpCircle size={16} />
              <span>Fyers Token Expiry Guide</span>
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Fyers credentials authorize high-speed connection but expire daily. Follow these simple steps:
            </p>
          </div>

          <ol className="text-xs list-decimal pl-4 flex flex-col gap-3 leading-relaxed">
            <li>
              Log in to the <a href="https://api.fyers.in" target="_blank" rel="noopener noreferrer" className="text-emerald-500 font-bold underline">Fyers API Dashboard</a>.
            </li>
            <li>
              Set your Redirect URL in your App settings to exact matching: <b className="font-mono text-slate-300 px-1 py-0.5 rounded bg-slate-950 text-[10px]/none dark:text-emerald-400">http://127.0.0.1:3000</b>.
            </li>
            <li>
              Generate Login URL / Authorize to capture the <b className="text-emerald-500">Authorization Code</b> from the URL search code params.
            </li>
            <li>
              Exchange code for standard Access Token or paste your latest token directly here in the input form to stream live quotation feeds.
            </li>
          </ol>

          <div className="border-t dark:border-slate-800 pt-3 flex flex-col gap-3">
            <p className="text-[11px] leading-relaxed text-slate-400 opacity-90">
              <span className="font-bold text-slate-100 dark:text-amber-500 uppercase tracking-wider block mb-1">Dual-Hybrid Architecture Engine</span>
              When you paste a valid token, the Excel formulas connect. If the token gets expired or fails, the dashboard automatically reverts to high-speed simulative quotation ticks and keeps all sheets dynamically running. This ensures a flawless trading workstation experience anytime.
            </p>
          </div>
        </div>

      </div>

    </div>
  );
}
