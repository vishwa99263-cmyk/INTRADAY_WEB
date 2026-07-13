/**
 * RiskManager.tsx — Risk Settings + Lot Size Configuration (User-editable, DB-backed)
 */
import React, { useState, useEffect, useCallback } from "react";
import { ShieldCheck, Save, PlusCircle, Edit2, Check, X, AlertCircle } from "lucide-react";

interface Props { activePage: string; }
interface LotConfig { instrument: string; lot_size: number; updated_at?: number }
interface RiskSettings {
  maxTradesPerDay: number; dailyLossLimit: number; dailyProfitTarget: number;
  maxConsecLosses: number; positionSizePct: number; minConfidence: number;
  strictOneLotMode: boolean;
  tradingMode: "INTRADAY" | "SWING";
}

const RISK_KEY = "te_risk_settings";
const DEFAULT_RISK: RiskSettings = {
  maxTradesPerDay: 3, dailyLossLimit: 5000, dailyProfitTarget: 15000,
  maxConsecLosses: 2, positionSizePct: 2, minConfidence: 65,
  strictOneLotMode: true,
  tradingMode: "INTRADAY",
};

const getApiUrl = (p: string) => (window.location.port === "5173" ? "http://localhost:3000" : "") + p;

const RiskManager: React.FC<Props> = ({ activePage }) => {
  const [risk, setRisk] = useState<RiskSettings>(() => {
    try { return JSON.parse(localStorage.getItem(RISK_KEY) || "{}") || DEFAULT_RISK; }
    catch { return DEFAULT_RISK; }
  });
  const [saved, setSaved] = useState(false);
  const [lotConfig, setLotConfig] = useState<LotConfig[]>([]);
  const [editingLot, setEditingLot] = useState<string | null>(null);
  const [lotValue, setLotValue] = useState<string>("");
  const [newInstr, setNewInstr] = useState("");
  const [newLot, setNewLot] = useState("");
  const [saving, setSaving] = useState(false);

  const loadLots = useCallback(async () => {
    try {
      const r = await fetch(getApiUrl("/api/te/lot-config"));
      if (r.ok) { const d = await r.json(); setLotConfig(d.lotConfig || []); }
    } catch { }
  }, []);

  useEffect(() => { loadLots(); }, [loadLots]);

  const saveRisk = () => {
    localStorage.setItem(RISK_KEY, JSON.stringify(risk));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const saveLot = async (instrument: string, lot_size: number) => {
    setSaving(true);
    try {
      const existing = lotConfig.filter(c => c.instrument !== instrument);
      const configs = [...existing, { instrument, lot_size }];
      await fetch(getApiUrl("/api/te/lot-config"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ configs }),
      });
      setLotConfig(configs);
    } finally { setSaving(false); setEditingLot(null); }
  };

  const addNewLot = async () => {
    const instr = newInstr.trim().toUpperCase();
    const size = parseInt(newLot);
    if (!instr || !size) return;
    await saveLot(instr, size);
    setNewInstr(""); setNewLot("");
  };

  const RiskInput: React.FC<{ label: string; value: number; onChange: (v: number) => void; prefix?: string; min?: number; max?: number; step?: number }> = ({
    label, value, onChange, prefix, min, max, step = 1
  }) => (
    <div>
      <label className="text-sm text-slate-500 uppercase font-black mb-1 block">{label}</label>
      <div className="flex items-center gap-1.5">
        {prefix && <span className="text-slate-400 text-base">{prefix}</span>}
        <input type="number" value={value} min={min} max={max} step={step}
          onChange={e => onChange(parseFloat(e.target.value))}
          className="w-full bg-slate-800/60 border border-slate-700/50 rounded-lg px-3 py-2 text-base text-slate-200 outline-none focus:border-indigo-500 transition-colors" />
      </div>
    </div>
  );

  return (
    <div className="p-4 space-y-5" style={{ fontFamily: "'Inter', sans-serif" }}>
      <div>
        <h1 className="text-xl font-black text-white flex items-center gap-2"><ShieldCheck size={18} className="text-indigo-400" /> Risk Manager</h1>
        <p className="text-base text-slate-500 mt-0.5">Configure trading limits · Lot sizes stored in database</p>
      </div>

      {/* Risk Settings */}
      <div className="rounded-2xl border border-slate-800/50 bg-[#080d1a] p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="text-base font-black text-slate-300 uppercase tracking-wider">Risk Rules</div>
          <div className="flex items-center gap-2">
            {saved && <span className="text-sm text-emerald-400 font-black">✓ Saved!</span>}
            <button onClick={saveRisk} className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-base font-black cursor-pointer transition-colors">
              <Save size={12} /> Save Settings
            </button>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <RiskInput label="Max Trades Per Day" value={risk.maxTradesPerDay} onChange={v => setRisk(r => ({ ...r, maxTradesPerDay: v }))} min={1} max={20} />
          <RiskInput label="Daily Loss Limit (₹)" value={risk.dailyLossLimit} onChange={v => setRisk(r => ({ ...r, dailyLossLimit: v }))} prefix="₹" min={500} step={500} />
          <RiskInput label="Daily Profit Target (₹)" value={risk.dailyProfitTarget} onChange={v => setRisk(r => ({ ...r, dailyProfitTarget: v }))} prefix="₹" min={1000} step={1000} />
          <RiskInput label="Max Consecutive Losses" value={risk.maxConsecLosses} onChange={v => setRisk(r => ({ ...r, maxConsecLosses: v }))} min={1} max={10} />
          <div>
            <label className="text-sm text-slate-500 uppercase font-black mb-1 block">Position Size (% of Capital)</label>
            <div className={`flex items-center gap-2 ${risk.strictOneLotMode ? 'opacity-50 pointer-events-none' : ''}`}>
              <input type="range" min={1} max={10} value={risk.positionSizePct} onChange={e => setRisk(r => ({ ...r, positionSizePct: parseInt(e.target.value) }))} className="flex-1 accent-indigo-500" />
              <span className="text-base font-black text-indigo-400 w-8 text-right">{risk.positionSizePct}%</span>
            </div>
            <div className="text-sm text-slate-600 mt-0.5">Conservative: 1-2% · Moderate: 3-5%</div>
          </div>
          <div>
            <label className="text-sm text-slate-500 uppercase font-black mb-1 block">Min Signal Confidence to Trade</label>
            <div className="flex items-center gap-2">
              <input type="range" min={50} max={90} value={risk.minConfidence} onChange={e => setRisk(r => ({ ...r, minConfidence: parseInt(e.target.value) }))} className="flex-1 accent-indigo-500" />
              <span className="text-base font-black text-indigo-400 w-10 text-right">{risk.minConfidence}%</span>
            </div>
            <div className="text-sm text-slate-600 mt-0.5">Higher = fewer but better signals</div>
          </div>
          <div>
            <label className="text-sm text-slate-500 uppercase font-black mb-1 block">Trading Mode</label>
            <select
              value={risk.tradingMode || "INTRADAY"}
              onChange={e => setRisk(r => ({ ...r, tradingMode: e.target.value as "INTRADAY" | "SWING" }))}
              className="w-full bg-slate-800/60 border border-slate-700/50 rounded-lg px-3 py-2 text-base text-slate-200 outline-none focus:border-indigo-500 transition-colors cursor-pointer"
            >
              <option value="INTRADAY">INTRADAY (EOD Auto-Exit)</option>
              <option value="SWING">SWING (Overnight, ITM Strike)</option>
            </select>
            <div className="text-sm text-slate-600 mt-0.5">Swing mode bypasses EOD auto-exits.</div>
          </div>
        </div>
        <div className="mt-6 p-4 rounded-xl border border-indigo-500/30 bg-indigo-900/10 flex items-start gap-3">
          <div className="mt-0.5 flex-shrink-0">
            <input 
              type="checkbox" 
              checked={risk.strictOneLotMode}
              onChange={(e) => setRisk(r => ({ ...r, strictOneLotMode: e.target.checked }))}
              className="w-5 h-5 accent-indigo-500 cursor-pointer"
            />
          </div>
          <div>
            <div className="text-base font-black text-white flex items-center gap-2">
              Institutional 1-Lot Strict Mode
              {risk.strictOneLotMode && <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 text-[10px] uppercase tracking-wider border border-emerald-500/30">Active</span>}
            </div>
            <div className="text-sm text-slate-400 mt-1">
              When active, the Paper Trading Engine will mathematically lock all executed trades to exactly 1 Lot, regardless of AI conviction or dynamic scaling rules.
            </div>
          </div>
        </div>
        <div className="mt-3 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 flex items-start gap-2">
          <AlertCircle size={12} className="text-amber-400 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-amber-300">Settings saved to browser localStorage. Institutional 1-Lot Mode will auto-enforce trades in the Paper Trading engine.</div>
        </div>
      </div>

      {/* Lot Size Config */}
      <div className="rounded-2xl border border-slate-800/50 bg-[#08101a] p-5">
        <div className="mb-4">
          <div className="text-base font-black text-slate-300 uppercase tracking-wider">Instrument Lot Sizes (User Configurable)</div>
          <div className="text-sm text-slate-600 mt-0.5">Stored in database · No code changes needed for updates · Changes take effect immediately</div>
        </div>
        <table className="w-full text-base mb-4">
          <thead>
            <tr className="border-b border-slate-800/30 text-sm text-slate-500 uppercase">
              <th className="p-2 pl-0 text-left">Instrument</th>
              <th className="p-2 text-right">Lot Size</th>
              <th className="p-2 text-right">Last Updated</th>
              <th className="p-2 pr-0 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/20">
            {lotConfig.length === 0 ? (
              <tr><td colSpan={4} className="py-4 text-center text-slate-600">No lot sizes configured. Add below.</td></tr>
            ) : lotConfig.map(cfg => (
              <tr key={cfg.instrument} className="hover:bg-slate-800/20 transition-colors">
                <td className="py-2 font-bold text-slate-200">{cfg.instrument}</td>
                <td className="py-2 text-right">
                  {editingLot === cfg.instrument ? (
                    <input type="number" value={lotValue} onChange={e => setLotValue(e.target.value)}
                      className="w-20 bg-slate-800 border border-indigo-500 rounded px-2 py-0.5 text-base text-white outline-none text-right" autoFocus />
                  ) : (
                    <span className="font-mono font-black text-white">{cfg.lot_size}</span>
                  )}
                </td>
                <td className="py-2 text-right text-slate-500 font-mono">
                  {cfg.updated_at ? new Date(cfg.updated_at).toLocaleDateString("en-IN") : "—"}
                </td>
                <td className="py-2 pr-0 text-right">
                  {editingLot === cfg.instrument ? (
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => saveLot(cfg.instrument, parseInt(lotValue))} disabled={saving}
                        className="text-emerald-400 hover:text-emerald-300 cursor-pointer"><Check size={13} /></button>
                      <button onClick={() => setEditingLot(null)} className="text-slate-500 hover:text-slate-300 cursor-pointer"><X size={13} /></button>
                    </div>
                  ) : (
                    <button onClick={() => { setEditingLot(cfg.instrument); setLotValue(String(cfg.lot_size)); }}
                      className="flex items-center gap-1 px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-sm font-black cursor-pointer transition-colors">
                      <Edit2 size={10} /> Edit
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Add new */}
        <div className="border-t border-slate-800/30 pt-4">
          <div className="text-sm text-slate-500 uppercase font-black mb-2">Add New Instrument</div>
          <div className="flex items-center gap-2">
            <input type="text" value={newInstr} onChange={e => setNewInstr(e.target.value.toUpperCase())}
              placeholder="e.g. BANKNIFTY"
              className="flex-1 bg-slate-800/60 border border-slate-700/50 rounded-lg px-3 py-2 text-base text-slate-200 outline-none focus:border-indigo-500" />
            <input type="number" value={newLot} onChange={e => setNewLot(e.target.value)}
              placeholder="Lot size"
              className="w-24 bg-slate-800/60 border border-slate-700/50 rounded-lg px-3 py-2 text-base text-slate-200 outline-none focus:border-indigo-500" />
            <button onClick={addNewLot} disabled={!newInstr || !newLot}
              className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-base font-black cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              <PlusCircle size={12} /> Add
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RiskManager;

