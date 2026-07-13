import React, { useState, useEffect } from "react";
import { Plus, Play, Trash2, Save, FileText, CheckCircle, Percent, AlertCircle } from "lucide-react";

export interface StrategyRule {
  metric: string;
  operator: ">" | "<" | "==" | "contains";
  value: string;
}

export interface SavedStrategy {
  name: string;
  rules: StrategyRule[];
  logicGate: "AND" | "OR";
  metrics?: {
    winRate: number;
    profitFactor: number;
    maxDrawdown: number;
    sharpeRatio: number;
    expectancy: number;
    rrRatio: number;
  };
}

export const StrategyMarketplace: React.FC = () => {
  const [strategyName, setStrategyName] = useState("Custom Institutional Alpha");
  const [rules, setRules] = useState<StrategyRule[]>([
    { metric: "PCR", operator: ">", value: "1.2" },
    { metric: "Heavyweight Score", operator: ">", value: "40" },
    { metric: "OI Delta", operator: "==", value: "POSITIVE" }
  ]);
  const [logicGate, setLogicGate] = useState<"AND" | "OR">("AND");
  const [savedStrategies, setSavedStrategies] = useState<SavedStrategy[]>([]);
  const [isBacktesting, setIsBacktesting] = useState(false);
  
  const [activeMetrics, setActiveMetrics] = useState<NonNullable<SavedStrategy["metrics"]> | null>(null);

  // Available metrics to construct strategy logic
  const METRIC_CATALOG = [
    "PCR",
    "Heavyweight Score",
    "OI Delta",
    "Volume Delta",
    "VWAP Distance",
    "Index Momentum",
    "Advance Decline Ratio",
    "IV Spikes"
  ];

  useEffect(() => {
    const cached = localStorage.getItem("mios_saved_strategies");
    if (cached) {
      try {
        setSavedStrategies(JSON.parse(cached));
      } catch (_) {}
    } else {
      // Mock initial catalog strategies
      const mockStrats: SavedStrategy[] = [
        {
          name: "Institutional Call Writing Squeeze",
          logicGate: "AND",
          rules: [
            { metric: "PCR", operator: "<", value: "0.8" },
            { metric: "OI Delta", operator: "==", value: "POSITIVE" },
            { metric: "Heavyweight Score", operator: ">", value: "30" }
          ],
          metrics: {
            winRate: 68.4,
            profitFactor: 2.34,
            maxDrawdown: 6.5,
            sharpeRatio: 2.11,
            expectancy: 15.4,
            rrRatio: 2.5
          }
        },
        {
          name: "Bull Trap Breakout Filter",
          logicGate: "AND",
          rules: [
            { metric: "PCR", operator: ">", value: "1.3" },
            { metric: "Volume Delta", operator: ">", value: "150000" },
            { metric: "VWAP Distance", operator: "<", value: "0.15" }
          ],
          metrics: {
            winRate: 72.1,
            profitFactor: 2.89,
            maxDrawdown: 4.8,
            sharpeRatio: 2.65,
            expectancy: 22.8,
            rrRatio: 3.2
          }
        }
      ];
      setSavedStrategies(mockStrats);
      localStorage.setItem("mios_saved_strategies", JSON.stringify(mockStrats));
    }
  }, []);

  const addRule = () => {
    setRules([...rules, { metric: "PCR", operator: ">", value: "1.0" }]);
  };

  const removeRule = (idx: number) => {
    setRules(rules.filter((_, i) => i !== idx));
  };

  const updateRule = (idx: number, field: keyof StrategyRule, val: string) => {
    const updated = rules.map((r, i) => {
      if (i === idx) {
        return { ...r, [field]: val } as StrategyRule;
      }
      return r;
    });
    setRules(updated);
  };

  const triggerBacktest = () => {
    setIsBacktesting(true);
    // Simulating institutional historical backtest run across TimeScale data lake
    setTimeout(() => {
      setIsBacktesting(false);
      const metrics: SavedStrategy["metrics"] = {
        winRate: parseFloat((55 + Math.random() * 22).toFixed(1)),
        profitFactor: parseFloat((1.5 + Math.random() * 1.8).toFixed(2)),
        maxDrawdown: parseFloat((3.5 + Math.random() * 8.0).toFixed(1)),
        sharpeRatio: parseFloat((1.2 + Math.random() * 1.6).toFixed(2)),
        expectancy: parseFloat((8.0 + Math.random() * 25.0).toFixed(1)),
        rrRatio: parseFloat((1.5 + Math.random() * 2.0).toFixed(1))
      };
      setActiveMetrics(metrics);
    }, 1500);
  };

  const saveStrategy = () => {
    if (!strategyName.trim()) return;
    const newStrat: SavedStrategy = {
      name: strategyName,
      rules,
      logicGate,
      metrics: activeMetrics || {
        winRate: 64.2,
        profitFactor: 1.95,
        maxDrawdown: 8.2,
        sharpeRatio: 1.78,
        expectancy: 12.3,
        rrRatio: 2.0
      }
    };
    const updated = [newStrat, ...savedStrategies.filter(s => s.name !== strategyName)];
    setSavedStrategies(updated);
    localStorage.setItem("mios_saved_strategies", JSON.stringify(updated));
    alert("Quantitative Strategy saved successfully!");
  };

  const loadStrategy = (strat: SavedStrategy) => {
    setStrategyName(strat.name);
    setRules(strat.rules);
    setLogicGate(strat.logicGate);
    if (strat.metrics) setActiveMetrics(strat.metrics);
  };

  const deleteStrategy = (name: string) => {
    const updated = savedStrategies.filter(s => s.name !== name);
    setSavedStrategies(updated);
    localStorage.setItem("mios_saved_strategies", JSON.stringify(updated));
  };

  return (
    <div className="flex flex-col bg-[#080d16] text-slate-100 p-4 rounded-2xl border border-slate-850 h-full overflow-y-auto select-none" style={{ fontFamily: "'Inter', sans-serif" }}>
      
      {/* Title Header */}
      <div className="flex items-center justify-between border-b border-slate-850 pb-2.5 mb-3 flex-shrink-0">
        <div className="flex items-center gap-2">
          <CheckCircle size={16} className="text-teal-400" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-teal-400">Quantitative Strategy Builder</h3>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0">
        {/* Left pane: Rule constructor */}
        <div className="flex-1 flex flex-col gap-3 min-w-[280px]">
          {/* Strategy Info */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-slate-500 font-bold uppercase">Strategy Label</label>
            <input
              type="text"
              value={strategyName}
              onChange={(e) => setStrategyName(e.target.value)}
              className="bg-slate-950 border border-slate-850 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-teal-500 font-bold font-mono"
            />
          </div>

          {/* Logic operator gate */}
          <div className="flex items-center justify-between bg-slate-900 border border-slate-850 p-2.5 rounded-xl">
            <span className="text-xs font-bold text-slate-350">Logical Chaining operator</span>
            <div className="flex bg-slate-950 p-0.5 rounded-lg border border-slate-850">
              <button
                onClick={() => setLogicGate("AND")}
                className={`px-3 py-1 rounded text-[10px] font-bold transition-all ${
                  logicGate === "AND" ? "bg-teal-600 text-white font-extrabold" : "text-slate-500"
                }`}
              >
                AND GATE
              </button>
              <button
                onClick={() => setLogicGate("OR")}
                className={`px-3 py-1 rounded text-[10px] font-bold transition-all ${
                  logicGate === "OR" ? "bg-teal-600 text-white font-extrabold" : "text-slate-500"
                }`}
              >
                OR GATE
              </button>
            </div>
          </div>

          {/* Rules List */}
          <div className="flex flex-col gap-2">
            <label className="text-[10px] text-slate-500 font-bold uppercase flex justify-between items-center">
              <span>Logical Rules Setup</span>
              <button
                onClick={addRule}
                className="flex items-center gap-1 text-teal-400 hover:text-teal-300 font-bold text-[10px] cursor-pointer"
              >
                <Plus size={10} /> Add Rule
              </button>
            </label>

            <div className="flex flex-col gap-2 max-h-[220px] overflow-y-auto pr-1">
              {rules.map((rule, idx) => (
                <div key={idx} className="flex items-center gap-1.5 bg-slate-950 border border-slate-850 p-2 rounded-xl text-xs font-mono">
                  <select
                    value={rule.metric}
                    onChange={(e) => updateRule(idx, "metric", e.target.value)}
                    className="flex-1 bg-slate-900 border border-slate-800 rounded px-1.5 py-1 text-[11px] text-slate-200 outline-none"
                  >
                    {METRIC_CATALOG.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <select
                    value={rule.operator}
                    onChange={(e) => updateRule(idx, "operator", e.target.value as any)}
                    className="bg-slate-900 border border-slate-800 rounded px-1.5 py-1 text-[11px] text-slate-200 outline-none w-14 text-center font-bold"
                  >
                    <option value=">">&gt;</option>
                    <option value="<">&lt;</option>
                    <option value="==">==</option>
                  </select>
                  <input
                    type="text"
                    value={rule.value}
                    onChange={(e) => updateRule(idx, "value", e.target.value)}
                    placeholder="Value"
                    className="bg-slate-900 border border-slate-800 rounded px-2 py-1 text-[11px] text-slate-200 w-20 text-center outline-none focus:border-teal-500"
                  />
                  <button
                    onClick={() => removeRule(idx)}
                    className="p-1 text-rose-500 hover:bg-rose-500/10 rounded cursor-pointer"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Action triggers */}
          <div className="flex gap-2.5 mt-2">
            <button
              onClick={triggerBacktest}
              disabled={isBacktesting || rules.length === 0}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-black uppercase text-white transition-all shadow-md ${
                isBacktesting
                  ? "bg-slate-800 border border-slate-700 text-slate-400 cursor-not-allowed"
                  : "bg-teal-600 hover:bg-teal-700 cursor-pointer shadow-teal-600/10"
              }`}
            >
              <Play size={12} fill="currentColor" />
              <span>{isBacktesting ? "Spooling Backtest..." : "BACKTEST INSTANTLY"}</span>
            </button>
            <button
              onClick={saveStrategy}
              className="px-3 bg-slate-900 hover:bg-slate-850 text-slate-350 border border-slate-850 rounded-xl transition-all cursor-pointer flex items-center justify-center"
              title="Save Strategy"
            >
              <Save size={13} />
            </button>
          </div>
        </div>

        {/* Right pane: Institutional performance metrics & catalog */}
        <div className="w-full lg:w-[320px] flex flex-col gap-3.5 border-t lg:border-t-0 lg:border-l border-slate-850 pt-3 lg:pt-0 lg:pl-4">
          
          {/* Backtest Statistics display */}
          <div className="bg-slate-950 border border-slate-850 rounded-xl p-3.5 flex flex-col gap-2">
            <h4 className="text-[10px] font-black uppercase text-slate-500 tracking-wider">Backtest Analytics</h4>
            {activeMetrics ? (
              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                <div className="bg-slate-900 p-2.5 rounded-lg border border-slate-850/50 flex flex-col">
                  <span className="text-[9px] text-slate-500 font-bold uppercase font-sans">Win Rate</span>
                  <span className="text-sm font-black text-emerald-400 mt-1 flex items-center gap-0.5">
                    {activeMetrics.winRate}% <Percent size={11} />
                  </span>
                </div>
                <div className="bg-slate-900 p-2.5 rounded-lg border border-slate-850/50 flex flex-col">
                  <span className="text-[9px] text-slate-500 font-bold uppercase font-sans">Profit Factor</span>
                  <span className="text-sm font-black text-teal-400 mt-1">{activeMetrics.profitFactor}x</span>
                </div>
                <div className="bg-slate-900 p-2.5 rounded-lg border border-slate-850/50 flex flex-col">
                  <span className="text-[9px] text-slate-500 font-bold uppercase font-sans">Max Drawdown</span>
                  <span className="text-sm font-black text-rose-400 mt-1">-{activeMetrics.maxDrawdown}%</span>
                </div>
                <div className="bg-slate-900 p-2.5 rounded-lg border border-slate-850/50 flex flex-col">
                  <span className="text-[9px] text-slate-500 font-bold uppercase font-sans">Sharpe Ratio</span>
                  <span className="text-sm font-black text-indigo-400 mt-1">{activeMetrics.sharpeRatio}</span>
                </div>
                <div className="bg-slate-900 p-2.5 rounded-lg border border-slate-850/50 flex flex-col">
                  <span className="text-[9px] text-slate-500 font-bold uppercase font-sans">Expectancy</span>
                  <span className="text-sm font-black text-emerald-450 mt-1">+{activeMetrics.expectancy} pts</span>
                </div>
                <div className="bg-slate-900 p-2.5 rounded-lg border border-slate-850/50 flex flex-col">
                  <span className="text-[9px] text-slate-500 font-bold uppercase font-sans">R:R Ratio</span>
                  <span className="text-sm font-black text-slate-200 mt-1">1 : {activeMetrics.rrRatio}</span>
                </div>
              </div>
            ) : (
              <div className="py-8 flex flex-col items-center justify-center text-center gap-1.5 text-slate-500 border border-dashed border-slate-850 rounded-xl">
                <AlertCircle size={18} />
                <p className="text-[10px] font-sans font-bold">Rule configuration pending simulation</p>
              </div>
            )}
          </div>

          {/* Strategy Catalog */}
          <div className="flex flex-col gap-2 flex-1 min-h-[140px] overflow-hidden">
            <label className="text-[10px] text-slate-500 font-black uppercase tracking-wider">Strategy Catalog</label>
            <div className="flex-1 overflow-y-auto flex flex-col gap-1.5 pr-1">
              {savedStrategies.map((strat, idx) => (
                <div
                  key={idx}
                  onClick={() => loadStrategy(strat)}
                  className="flex items-center justify-between bg-slate-900/60 border border-slate-850/60 p-2.5 rounded-xl hover:border-teal-500/40 cursor-pointer transition-all hover:bg-slate-900"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[11px] font-bold text-slate-200">{strat.name}</span>
                    <span className="text-[9px] text-slate-500 font-mono">
                      {strat.rules.length} Rules • {strat.logicGate} • Win: {strat.metrics?.winRate ?? 65}%
                    </span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteStrategy(strat.name);
                    }}
                    className="p-1 text-slate-500 hover:text-rose-500 rounded cursor-pointer"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>

    </div>
  );
};
export default StrategyMarketplace;
