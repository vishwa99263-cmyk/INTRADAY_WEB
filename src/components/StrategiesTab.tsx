import React, { useState, useEffect } from "react";
import { 
  BookOpen, Search, Plus, Edit2, Trash2, Save, X, 
  Info, AlertTriangle, CheckCircle, Sparkles, HelpCircle 
} from "lucide-react";

export interface Strategy {
  id: string;
  name: string;
  objective: string;
  marketLogic: string;
  entryRules: string;
  exitRules: string;
  stopLossRules: string;
  confidenceFactors: string;
  realExample: string;
  commonMistakes: string;
  bestConditions: string;
  worstConditions: string;
  liveDashboardIntegration: string;
  notes?: string;
  isSystem?: boolean;
}

interface StrategiesTabProps {
  darkMode: boolean;
}

export default function StrategiesTab({ darkMode }: StrategiesTabProps) {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  // Edit/Create Form state
  const [formData, setFormData] = useState<Omit<Strategy, "id" | "isSystem">>({
    name: "",
    objective: "",
    marketLogic: "",
    entryRules: "",
    exitRules: "",
    stopLossRules: "",
    confidenceFactors: "",
    realExample: "",
    commonMistakes: "",
    bestConditions: "",
    worstConditions: "",
    liveDashboardIntegration: "",
    notes: ""
  });

  const fetchStrategies = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/strategies");
      const data = await res.json();
      if (res.ok && data.strategies) {
        setStrategies(data.strategies);
        if (data.strategies.length > 0 && !selectedId) {
          setSelectedId(data.strategies[0].id);
        }
      } else {
        setError(data.error ?? "Failed to fetch strategies");
      }
    } catch (err) {
      console.error("Error fetching strategies:", err);
      setError("Network error fetching strategies");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStrategies();
  }, []);

  const selectedStrategy = strategies.find(s => s.id === selectedId);

  const startEdit = () => {
    if (!selectedStrategy) return;
    setFormData({
      name: selectedStrategy.name,
      objective: selectedStrategy.objective,
      marketLogic: selectedStrategy.marketLogic,
      entryRules: selectedStrategy.entryRules,
      exitRules: selectedStrategy.exitRules,
      stopLossRules: selectedStrategy.stopLossRules,
      confidenceFactors: selectedStrategy.confidenceFactors,
      realExample: selectedStrategy.realExample,
      commonMistakes: selectedStrategy.commonMistakes,
      bestConditions: selectedStrategy.bestConditions,
      worstConditions: selectedStrategy.worstConditions,
      liveDashboardIntegration: selectedStrategy.liveDashboardIntegration,
      notes: selectedStrategy.notes || ""
    });
    setIsEditing(true);
    setIsCreating(false);
  };

  const startCreate = () => {
    setFormData({
      name: "",
      objective: "",
      marketLogic: "",
      entryRules: "",
      exitRules: "",
      stopLossRules: "",
      confidenceFactors: "",
      realExample: "",
      commonMistakes: "",
      bestConditions: "",
      worstConditions: "",
      liveDashboardIntegration: "",
      notes: ""
    });
    setIsCreating(true);
    setIsEditing(false);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.objective.trim()) {
      alert("Strategy Name and Objective are required fields.");
      return;
    }

    try {
      const url = isCreating ? "/api/strategies" : "/api/strategies/edit";
      const body = isCreating 
        ? formData 
        : { id: selectedId, fields: formData };

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      
      if (res.ok && data.success) {
        setIsCreating(false);
        setIsEditing(false);
        if (isCreating && data.strategy) {
          setSelectedId(data.strategy.id);
        }
        await fetchStrategies();
      } else {
        alert(data.error ?? "Failed to save strategy");
      }
    } catch (err) {
      console.error("Save strategy error:", err);
      alert("Network error saving strategy");
    }
  };

  const handleDelete = async () => {
    if (!selectedStrategy) return;
    if (selectedStrategy.isSystem) {
      alert("System strategies cannot be deleted.");
      return;
    }
    if (!confirm(`Are you sure you want to delete the strategy: "${selectedStrategy.name}"?`)) {
      return;
    }

    try {
      const res = await fetch("/api/strategies/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selectedId })
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setIsEditing(false);
        setIsCreating(false);
        const remaining = strategies.filter(s => s.id !== selectedId);
        if (remaining.length > 0) {
          setSelectedId(remaining[0].id);
        } else {
          setSelectedId("");
        }
        await fetchStrategies();
      } else {
        alert(data.error ?? "Failed to delete strategy");
      }
    } catch (err) {
      console.error("Delete strategy error:", err);
      alert("Network error deleting strategy");
    }
  };

  const filteredStrategies = strategies.filter(s => 
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    s.objective.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className={`flex flex-col md:flex-row h-full w-full overflow-hidden select-text text-sm ${
      darkMode ? "bg-slate-950 text-slate-100" : "bg-slate-50 text-slate-900"
    }`}>
      {/* ── Left Sidebar (List catalog) ── */}
      <div className={`w-full md:w-80 flex flex-col border-r flex-shrink-0 ${
        darkMode ? "border-slate-850 bg-slate-955" : "border-slate-250 bg-white"
      }`}>
        {/* Sidebar Header */}
        <div className="p-4 border-b border-gray-300 dark:border-slate-850 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="font-bold text-xs uppercase tracking-wider text-teal-400 flex items-center gap-1.5">
              <BookOpen size={14} /> PLAYBOOK CATALOG
            </span>
            <button
              onClick={startCreate}
              className="flex items-center gap-1 px-2.5 py-1 text-[10.5px] bg-teal-600 hover:bg-teal-700 text-white font-bold rounded cursor-pointer transition-colors shadow-sm"
            >
              <Plus size={12} /> Add New
            </button>
          </div>

          {/* Search strategy bar */}
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search playbooks..."
              className={`w-full pl-8 pr-3 py-1.5 text-xs rounded border outline-none font-mono ${
                darkMode ? "bg-slate-950 border-slate-800 text-teal-400 focus:border-teal-700" : "bg-slate-100 border-slate-300 text-slate-800 focus:border-emerald-600"
              }`}
            />
            <Search className="absolute left-2.5 top-2.5 opacity-40" size={13} />
          </div>
        </div>

        {/* Scrollable Strategies List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-center text-xs opacity-60">Loading strategy catalog...</div>
          ) : error ? (
            <div className="p-4 text-center text-xs text-rose-500 font-mono">{error}</div>
          ) : filteredStrategies.length === 0 ? (
            <div className="p-4 text-center text-xs opacity-60">No strategies found</div>
          ) : (
            <div className="divide-y dark:divide-slate-850/50">
              {filteredStrategies.map((s) => {
                const isActive = s.id === selectedId && !isCreating;
                return (
                  <div
                    key={s.id}
                    onClick={() => {
                      setSelectedId(s.id);
                      setIsEditing(false);
                      setIsCreating(false);
                    }}
                    className={`p-3.5 cursor-pointer transition-colors flex flex-col gap-1.5 ${
                      isActive 
                        ? (darkMode ? "bg-slate-900 border-l-4 border-l-teal-500" : "bg-slate-100 border-l-4 border-l-emerald-600")
                        : (darkMode ? "hover:bg-slate-900/40" : "hover:bg-slate-50")
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-extrabold text-[12.5px] leading-snug tracking-normal">{s.name}</span>
                      {s.isSystem && (
                        <span className="text-[7.5px] font-mono tracking-widest font-black uppercase bg-teal-500/10 text-teal-400 border border-teal-500/20 px-1 rounded flex-shrink-0">
                          SYSTEM
                        </span>
                      )}
                    </div>
                    <p className={`text-[10.5px] font-medium leading-relaxed line-clamp-2 ${
                      darkMode ? "text-slate-400" : "text-slate-550"
                    }`}>
                      {s.objective}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Right Panel (Details / Editor) ── */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-slate-100 dark:bg-slate-900">
        
        {isEditing || isCreating ? (
          /* ── WRITING / EDITING VIEW FORM ── */
          <form onSubmit={handleSave} className={`w-full max-w-4xl p-6 rounded-2xl border shadow-lg flex flex-col gap-5 ${
            darkMode ? "bg-slate-955 border-slate-850" : "bg-white border-slate-250"
          }`}>
            <div className="flex items-center justify-between border-b pb-3 dark:border-slate-850">
              <span className="font-black text-sm uppercase tracking-wider text-teal-400">
                {isCreating ? "📖 Create Custom Trading Strategy" : `✍️ Edit Playbook: ${formData.name}`}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsEditing(false);
                    setIsCreating(false);
                  }}
                  className="px-3.5 py-1.5 text-xs font-bold rounded cursor-pointer bg-slate-500/10 hover:bg-slate-500/25 transition-colors border dark:border-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-xs font-bold text-white bg-teal-600 hover:bg-teal-700 rounded shadow cursor-pointer transition-colors flex items-center gap-1.5"
                >
                  <Save size={13} /> Save Strategy
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Strategy Name */}
              <div className="flex flex-col gap-1.5 md:col-span-2">
                <label className="text-[11px] font-black uppercase text-slate-550 tracking-wider">Strategy Name</label>
                <input
                  type="text"
                  required
                  disabled={selectedStrategy?.isSystem && isEditing}
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g. 5-Minute EMA Exponential Rebound..."
                  className={`px-3 py-2 rounded border outline-none font-sans font-bold text-sm ${
                    darkMode ? "bg-slate-950 border-slate-800 text-teal-450 focus:border-teal-700" : "bg-slate-50 border-slate-300 text-slate-800 focus:border-emerald-600"
                  }`}
                />
                {selectedStrategy?.isSystem && isEditing && (
                  <span className="text-[10px] text-amber-500 italic mt-0.5">Note: System strategy names cannot be modified.</span>
                )}
              </div>

              {/* Objective */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-black uppercase text-slate-550 tracking-wider">Objective</label>
                <textarea
                  required
                  rows={3}
                  value={formData.objective}
                  onChange={(e) => setFormData({ ...formData, objective: e.target.value })}
                  placeholder="Summarize the core target goal..."
                  className={`px-3 py-2 rounded border outline-none font-sans text-xs ${
                    darkMode ? "bg-slate-950 border-slate-800 text-slate-200 focus:border-teal-700" : "bg-slate-50 border-slate-300 text-slate-800 focus:border-emerald-600"
                  }`}
                />
              </div>

              {/* Market Logic */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-black uppercase text-slate-550 tracking-wider">Market Logic</label>
                <textarea
                  rows={3}
                  value={formData.marketLogic}
                  onChange={(e) => setFormData({ ...formData, marketLogic: e.target.value })}
                  placeholder="Why does this strategy work mathematically/microstructurally?..."
                  className={`px-3 py-2 rounded border outline-none font-sans text-xs ${
                    darkMode ? "bg-slate-950 border-slate-800 text-slate-200 focus:border-teal-700" : "bg-slate-50 border-slate-300 text-slate-800 focus:border-emerald-600"
                  }`}
                />
              </div>

              {/* Entry Rules */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-black uppercase text-slate-550 tracking-wider">Entry Rules</label>
                <textarea
                  rows={3}
                  value={formData.entryRules}
                  onChange={(e) => setFormData({ ...formData, entryRules: e.target.value })}
                  placeholder="Rule 1...\nRule 2..."
                  className={`px-3 py-2 rounded border outline-none font-sans text-xs ${
                    darkMode ? "bg-slate-950 border-slate-800 text-slate-200 focus:border-teal-700" : "bg-slate-50 border-slate-300 text-slate-800 focus:border-emerald-600"
                  }`}
                />
              </div>

              {/* Exit Rules */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-black uppercase text-slate-550 tracking-wider">Exit Rules</label>
                <textarea
                  rows={3}
                  value={formData.exitRules}
                  onChange={(e) => setFormData({ ...formData, exitRules: e.target.value })}
                  placeholder="Target triggers / take profit execution..."
                  className={`px-3 py-2 rounded border outline-none font-sans text-xs ${
                    darkMode ? "bg-slate-950 border-slate-800 text-slate-200 focus:border-teal-700" : "bg-slate-50 border-slate-300 text-slate-800 focus:border-emerald-600"
                  }`}
                />
              </div>

              {/* Stop Loss Rules */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-black uppercase text-slate-550 tracking-wider">Stop Loss Rules</label>
                <textarea
                  rows={3}
                  value={formData.stopLossRules}
                  onChange={(e) => setFormData({ ...formData, stopLossRules: e.target.value })}
                  placeholder="Stop loss placement / invalidation thresholds..."
                  className={`px-3 py-2 rounded border outline-none font-sans text-xs ${
                    darkMode ? "bg-slate-950 border-slate-800 text-slate-200 focus:border-teal-700" : "bg-slate-50 border-slate-300 text-slate-800 focus:border-emerald-600"
                  }`}
                />
              </div>

              {/* Confidence Factors */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-black uppercase text-slate-550 tracking-wider">Confidence Factors</label>
                <textarea
                  rows={3}
                  value={formData.confidenceFactors}
                  onChange={(e) => setFormData({ ...formData, confidenceFactors: e.target.value })}
                  placeholder="Confluence checks / what elevates signal probability?..."
                  className={`px-3 py-2 rounded border outline-none font-sans text-xs ${
                    darkMode ? "bg-slate-950 border-slate-800 text-slate-200 focus:border-teal-700" : "bg-slate-50 border-slate-300 text-slate-800 focus:border-emerald-600"
                  }`}
                />
              </div>

              {/* Real Example */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-black uppercase text-slate-550 tracking-wider">Real Example</label>
                <textarea
                  rows={3}
                  value={formData.realExample}
                  onChange={(e) => setFormData({ ...formData, realExample: e.target.value })}
                  placeholder="Historical trade logs showing setup and resolution..."
                  className={`px-3 py-2 rounded border outline-none font-sans text-xs ${
                    darkMode ? "bg-slate-950 border-slate-800 text-slate-200 focus:border-teal-700" : "bg-slate-50 border-slate-300 text-slate-800 focus:border-emerald-600"
                  }`}
                />
              </div>

              {/* Common Mistakes */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-black uppercase text-slate-550 tracking-wider">Common Mistakes</label>
                <textarea
                  rows={3}
                  value={formData.commonMistakes}
                  onChange={(e) => setFormData({ ...formData, commonMistakes: e.target.value })}
                  placeholder="Traps / FOMO triggers / cognitive biases to watch out for..."
                  className={`px-3 py-2 rounded border outline-none font-sans text-xs ${
                    darkMode ? "bg-slate-950 border-slate-800 text-slate-200 focus:border-teal-700" : "bg-slate-50 border-slate-300 text-slate-800 focus:border-emerald-600"
                  }`}
                />
              </div>

              {/* Best Conditions */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-black uppercase text-slate-550 tracking-wider">Best Conditions</label>
                <textarea
                  rows={3}
                  value={formData.bestConditions}
                  onChange={(e) => setFormData({ ...formData, bestConditions: e.target.value })}
                  placeholder="e.g. Trend days, High Volatility, Specific Session Open..."
                  className={`px-3 py-2 rounded border outline-none font-sans text-xs ${
                    darkMode ? "bg-slate-950 border-slate-800 text-slate-200 focus:border-teal-700" : "bg-slate-50 border-slate-300 text-slate-800 focus:border-emerald-600"
                  }`}
                />
              </div>

              {/* Worst Conditions */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-black uppercase text-slate-550 tracking-wider">Worst Conditions</label>
                <textarea
                  rows={3}
                  value={formData.worstConditions}
                  onChange={(e) => setFormData({ ...formData, worstConditions: e.target.value })}
                  placeholder="e.g. Narrow sideways consolidation, Holidays, low ATR..."
                  className={`px-3 py-2 rounded border outline-none font-sans text-xs ${
                    darkMode ? "bg-slate-950 border-slate-800 text-slate-200 focus:border-teal-700" : "bg-slate-50 border-slate-300 text-slate-800 focus:border-emerald-600"
                  }`}
                />
              </div>

              {/* Live Dashboard Integration */}
              <div className="flex flex-col gap-1.5 md:col-span-2">
                <label className="text-[11px] font-black uppercase text-slate-550 tracking-wider">Live Dashboard Integration Notes</label>
                <textarea
                  rows={3}
                  value={formData.liveDashboardIntegration}
                  onChange={(e) => setFormData({ ...formData, liveDashboardIntegration: e.target.value })}
                  placeholder="How is this strategy wired up dynamically on the live dashboard panel?..."
                  className={`px-3 py-2 rounded border outline-none font-sans text-xs ${
                    darkMode ? "bg-slate-955 border-slate-800 text-slate-200 focus:border-teal-700" : "bg-slate-50 border-slate-300 text-slate-800 focus:border-emerald-600"
                  }`}
                />
              </div>

              {/* Custom notes */}
              <div className="flex flex-col gap-1.5 md:col-span-2 border-t pt-3 dark:border-slate-850">
                <label className="text-[11px] font-black uppercase text-teal-400 tracking-wider">Strategy Journal / Private Notes</label>
                <textarea
                  rows={4}
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="Add your execution notes, trading logs, parameters configuration adjustments..."
                  className={`px-3 py-2.5 rounded border outline-none font-sans text-xs leading-relaxed ${
                    darkMode ? "bg-slate-955 border-slate-800 text-slate-200 focus:border-teal-700" : "bg-slate-50 border-slate-300 text-slate-800 focus:border-emerald-600"
                  }`}
                />
              </div>
            </div>
          </form>
        ) : selectedStrategy ? (
          /* ── READ PLAYBOOK VIEW ── */
          <div className="flex flex-col gap-5 w-full max-w-4xl">
            {/* Header controls card */}
            <div className={`p-4 md:p-5 rounded-2xl border shadow-sm flex items-center justify-between ${
              darkMode ? "bg-slate-955 border-slate-850" : "bg-white border-slate-250"
            }`}>
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg md:text-xl font-black">{selectedStrategy.name}</h2>
                  {selectedStrategy.isSystem && (
                    <span className="text-[8px] font-mono tracking-widest font-black uppercase bg-teal-500/10 text-teal-400 border border-teal-500/20 px-1.5 py-0.5 rounded">
                      SYSTEM PRESET
                    </span>
                  )}
                </div>
                <span className="text-[10px] opacity-60 font-mono tracking-wide">ID: {selectedStrategy.id}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={startEdit}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold border rounded cursor-pointer bg-slate-500/10 hover:bg-slate-500/20 transition-colors dark:border-slate-850"
                >
                  <Edit2 size={13} /> Edit Playbook
                </button>
                {!selectedStrategy.isSystem && (
                  <button
                    onClick={handleDelete}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded cursor-pointer transition-colors shadow-sm"
                  >
                    <Trash2 size={13} /> Delete
                  </button>
                )}
              </div>
            </div>

            {/* Playbook reading viewport */}
            <div className={`p-6 md:p-8 rounded-2xl border shadow-md flex flex-col gap-6 select-text ${
              darkMode ? "bg-slate-955 border-slate-850" : "bg-white border-slate-250"
            }`}>
              {/* Objective (Highlight Callout) */}
              <div className="p-4 rounded-xl border border-dashed flex items-start gap-3 bg-teal-500/5 dark:border-teal-500/20 text-teal-50 dark:text-teal-350">
                <Sparkles className="text-teal-400 mt-0.5 flex-shrink-0" size={18} />
                <div className="flex flex-col gap-1">
                  <h4 className="text-[11px] font-black uppercase tracking-wider text-teal-400">Core Strategy Objective</h4>
                  <p className="text-xs md:text-sm font-medium leading-relaxed italic dark:text-slate-200 text-slate-850">
                    "{selectedStrategy.objective}"
                  </p>
                </div>
              </div>

              {/* Two Column details deck */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* 1. Market Logic */}
                <div className="flex flex-col gap-2">
                  <h3 className="font-extrabold text-[12.5px] uppercase tracking-wider text-slate-550 border-b pb-1 dark:border-slate-850 flex items-center gap-1.5">
                    <Info size={14} className="text-teal-400" /> Market Logic & Premise
                  </h3>
                  <p className="text-xs leading-relaxed opacity-90 whitespace-pre-line">{selectedStrategy.marketLogic || "—"}</p>
                </div>

                {/* 2. Entry Rules */}
                <div className="flex flex-col gap-2">
                  <h3 className="font-extrabold text-[12.5px] uppercase tracking-wider text-emerald-500 border-b pb-1 dark:border-slate-850 flex items-center gap-1.5">
                    <CheckCircle size={14} className="text-emerald-500" /> Exact Entry Signals
                  </h3>
                  <p className="text-xs leading-relaxed opacity-90 whitespace-pre-line text-emerald-650 dark:text-emerald-400 bg-emerald-500/5 p-3 rounded-lg border border-emerald-500/10">{selectedStrategy.entryRules || "—"}</p>
                </div>

                {/* 3. Exit Rules */}
                <div className="flex flex-col gap-2">
                  <h3 className="font-extrabold text-[12.5px] uppercase tracking-wider text-teal-450 border-b pb-1 dark:border-slate-850 flex items-center gap-1.5">
                    <CheckCircle size={14} className="text-teal-450" /> Profit Realisation & Exit
                  </h3>
                  <p className="text-xs leading-relaxed opacity-90 whitespace-pre-line bg-teal-500/5 p-3 rounded-lg border border-teal-500/10 text-teal-400">{selectedStrategy.exitRules || "—"}</p>
                </div>

                {/* 4. Stop Loss Rules */}
                <div className="flex flex-col gap-2">
                  <h3 className="font-extrabold text-[12.5px] uppercase tracking-wider text-rose-500 border-b pb-1 dark:border-slate-850 flex items-center gap-1.5">
                    <AlertTriangle size={14} className="text-rose-500" /> Risk Management & Stop Loss
                  </h3>
                  <p className="text-xs leading-relaxed opacity-90 whitespace-pre-line text-rose-600 dark:text-rose-400 bg-rose-500/5 p-3 rounded-lg border border-rose-500/10">{selectedStrategy.stopLossRules || "—"}</p>
                </div>

                {/* 5. Confidence Factors */}
                <div className="flex flex-col gap-2">
                  <h3 className="font-extrabold text-[12.5px] uppercase tracking-wider text-slate-550 border-b pb-1 dark:border-slate-850 flex items-center gap-1.5">
                    <HelpCircle size={14} className="text-indigo-400" /> Confluence Confidence Factors
                  </h3>
                  <p className="text-xs leading-relaxed opacity-90 whitespace-pre-line">{selectedStrategy.confidenceFactors || "—"}</p>
                </div>

                {/* 6. Best Conditions */}
                <div className="flex flex-col gap-2">
                  <h3 className="font-extrabold text-[12.5px] uppercase tracking-wider text-slate-550 border-b pb-1 dark:border-slate-850 flex items-center gap-1.5 text-emerald-500">
                    👍 Optimal Market Conditions
                  </h3>
                  <p className="text-xs leading-relaxed opacity-90 whitespace-pre-line">{selectedStrategy.bestConditions || "—"}</p>
                </div>

                {/* 7. Worst Conditions */}
                <div className="flex flex-col gap-2">
                  <h3 className="font-extrabold text-[12.5px] uppercase tracking-wider text-slate-550 border-b pb-1 dark:border-slate-850 flex items-center gap-1.5 text-rose-500">
                    👎 High-Risk / Avoid Conditions
                  </h3>
                  <p className="text-xs leading-relaxed opacity-90 whitespace-pre-line">{selectedStrategy.worstConditions || "—"}</p>
                </div>

                {/* 8. Common Mistakes */}
                <div className="flex flex-col gap-2">
                  <h3 className="font-extrabold text-[12.5px] uppercase tracking-wider text-slate-550 border-b pb-1 dark:border-slate-850 flex items-center gap-1.5 text-amber-500">
                    ⚠️ Common Trading Mistakes
                  </h3>
                  <p className="text-xs leading-relaxed opacity-90 whitespace-pre-line text-amber-600 dark:text-amber-400 bg-amber-500/5 p-3 rounded-lg border border-amber-500/10">{selectedStrategy.commonMistakes || "—"}</p>
                </div>
              </div>

              {/* 9. Real Example */}
              <div className="flex flex-col gap-2 border-t pt-5 dark:border-slate-850">
                <h3 className="font-extrabold text-[12.5px] uppercase tracking-wider text-teal-400 border-b pb-1 dark:border-slate-850">
                  📈 Historical Real-Trade Examples
                </h3>
                <pre className={`p-4 rounded-xl font-mono text-[11px] leading-relaxed overflow-x-auto whitespace-pre-wrap border ${
                  darkMode ? "bg-slate-900 border-slate-800 text-slate-300" : "bg-slate-50 border-slate-200 text-slate-800"
                }`}>{selectedStrategy.realExample || "—"}</pre>
              </div>

              {/* 10. Live Dashboard Integration */}
              <div className="flex flex-col gap-2 border-t pt-5 dark:border-slate-850">
                <h3 className="font-extrabold text-[12.5px] uppercase tracking-wider text-teal-400 border-b pb-1 dark:border-slate-850">
                  🎯 Live Dashboard Integration & Algorithms
                </h3>
                <p className="text-xs leading-relaxed opacity-90 whitespace-pre-line">{selectedStrategy.liveDashboardIntegration || "—"}</p>
              </div>

              {/* 11. Custom Notes Journal (Persisted user entries) */}
              <div className={`mt-2 p-5 rounded-2xl border flex flex-col gap-3 shadow-inner ${
                darkMode ? "bg-slate-900/50 border-slate-800/80" : "bg-slate-50 border-slate-200/85"
              }`}>
                <h4 className="font-black text-xs uppercase tracking-wider text-teal-400 flex items-center gap-1.5">
                  📝 Playbook Journal / User Notes
                </h4>
                {selectedStrategy.notes ? (
                  <p className="text-xs leading-relaxed opacity-95 whitespace-pre-line italic text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-950 p-4 rounded-xl border border-slate-200 dark:border-slate-850">
                    "{selectedStrategy.notes}"
                  </p>
                ) : (
                  <div className="text-xs opacity-50 italic py-2">
                    No journal entry written for this strategy playbook yet. Click "Edit Playbook" at the top to add notes.
                  </div>
                )}
              </div>

            </div>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-center opacity-60">
            Select a strategy playbook catalog item to get started.
          </div>
        )}

      </div>
    </div>
  );
}
