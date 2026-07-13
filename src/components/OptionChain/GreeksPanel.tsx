import React, { useMemo } from "react";
import { motion } from "framer-motion";
import { OptionStrikeRow, getOiBuildUp, BuildUpType } from "./optionUtils.js";
import { ShieldCheck, Info, BarChart2 } from "lucide-react";

interface GreeksPanelProps {
  rows: OptionStrikeRow[];
  resistance: number;
  support: number;
}

export default function GreeksPanel({ rows, resistance, support }: GreeksPanelProps) {
  
  // Calculate Build-up summaries
  const buildUpStats = useMemo(() => {
    let callLBU = 0, callSBU = 0, callLUW = 0, callSCV = 0;
    let putLBU = 0, putSBU = 0, putLUW = 0, putSCV = 0;

    rows.forEach(row => {
      // CE build up
      const ceType = getOiBuildUp(row.ceLtpChgPct, row.ceOIChange);
      if (ceType === "Long Build-up") callLBU++;
      else if (ceType === "Short Build-up") callSBU++;
      else if (ceType === "Long Unwinding") callLUW++;
      else if (ceType === "Short Covering") callSCV++;

      // PE build up
      const peType = getOiBuildUp(row.peLtpChgPct, row.peOIChange);
      if (peType === "Long Build-up") putLBU++;
      else if (peType === "Short Build-up") putSBU++;
      else if (peType === "Long Unwinding") putLUW++;
      else if (peType === "Short Covering") putSCV++;
    });

    return {
      call: { LBU: callLBU, SBU: callSBU, LUW: callLUW, SCV: callSCV },
      put: { LBU: putLBU, SBU: putSBU, LUW: putLUW, SCV: putSCV }
    };
  }, [rows]);

  const topCallOiRows = useMemo(() => {
    return [...rows].sort((a, b) => b.ceOI - a.ceOI).slice(0, 3);
  }, [rows]);

  const topPutOiRows = useMemo(() => {
    return [...rows].sort((a, b) => b.peOI - a.peOI).slice(0, 3);
  }, [rows]);

  const formatOi = (oi: number) => {
    if (!oi) return "0";
    if (oi >= 1e7) return `${(oi / 1e7).toFixed(2)}Cr`;
    if (oi >= 1e5) return `${(oi / 1e5).toFixed(1)}L`;
    return oi.toLocaleString("en-IN");
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
      {/* Left: OI Build-up Distribution */}
      <div className="lg:col-span-6 p-4 rounded-xl border border-slate-800 bg-slate-900">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5 mb-3">
          <BarChart2 size={14} className="text-teal-400" />
          OI Build-up Distribution (Strikes Count)
        </h3>

        <div className="grid grid-cols-2 gap-4">
          {/* Call Options Build-up */}
          <div className="space-y-2">
            <span className="text-[10px] font-bold text-rose-400 uppercase tracking-wider block border-b border-rose-900/30 pb-1">Calls (CE)</span>
            <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
              <div className="bg-emerald-950/20 border border-emerald-900/30 p-1.5 rounded flex flex-col justify-between">
                <span className="text-emerald-500 font-bold">Long BU</span>
                <span className="text-sm font-black text-white mt-0.5">{buildUpStats.call.LBU}</span>
              </div>
              <div className="bg-rose-950/20 border border-rose-900/30 p-1.5 rounded flex flex-col justify-between">
                <span className="text-rose-500 font-bold">Short BU</span>
                <span className="text-sm font-black text-white mt-0.5">{buildUpStats.call.SBU}</span>
              </div>
              <div className="bg-amber-950/15 border border-amber-900/30 p-1.5 rounded flex flex-col justify-between">
                <span className="text-amber-500 font-bold">Long Unwind</span>
                <span className="text-sm font-black text-white mt-0.5">{buildUpStats.call.LUW}</span>
              </div>
              <div className="bg-teal-950/20 border border-teal-900/30 p-1.5 rounded flex flex-col justify-between">
                <span className="text-teal-400 font-bold">Short Cover</span>
                <span className="text-sm font-black text-white mt-0.5">{buildUpStats.call.SCV}</span>
              </div>
            </div>
          </div>

          {/* Put Options Build-up */}
          <div className="space-y-2">
            <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider block border-b border-emerald-900/30 pb-1">Puts (PE)</span>
            <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
              <div className="bg-emerald-950/20 border border-emerald-900/30 p-1.5 rounded flex flex-col justify-between">
                <span className="text-emerald-500 font-bold">Long BU</span>
                <span className="text-sm font-black text-white mt-0.5">{buildUpStats.put.LBU}</span>
              </div>
              <div className="bg-rose-950/20 border border-rose-900/30 p-1.5 rounded flex flex-col justify-between">
                <span className="text-rose-500 font-bold">Short BU</span>
                <span className="text-sm font-black text-white mt-0.5">{buildUpStats.put.SBU}</span>
              </div>
              <div className="bg-amber-950/15 border border-amber-900/30 p-1.5 rounded flex flex-col justify-between">
                <span className="text-amber-500 font-bold">Long Unwind</span>
                <span className="text-sm font-black text-white mt-0.5">{buildUpStats.put.LUW}</span>
              </div>
              <div className="bg-teal-950/20 border border-teal-900/30 p-1.5 rounded flex flex-col justify-between">
                <span className="text-teal-400 font-bold">Short Cover</span>
                <span className="text-sm font-black text-white mt-0.5">{buildUpStats.put.SCV}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right: Key Resistance & Support Zones */}
      <div className="lg:col-span-6 p-4 rounded-xl border border-slate-800 bg-slate-900">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5 mb-3">
          <ShieldCheck size={14} className="text-teal-400" />
          Major Support & Resistance Zones (Top OI)
        </h3>

        <div className="grid grid-cols-2 gap-4 text-[10px] font-mono">
          {/* Top Resistance Strikes */}
          <div className="space-y-1.5">
            <span className="text-[10px] font-bold text-rose-400 uppercase tracking-wider block border-b border-rose-900/30 pb-1 mb-2">RESISTANCE ZONES</span>
            {topCallOiRows.map((row, idx) => {
              const isMain = row.strikePrice === resistance;
              return (
                <div key={row.strikePrice} className={`flex justify-between items-center p-1.5 rounded border transition-colors ${
                  isMain ? "bg-rose-950/30 border-rose-900/50" : "bg-slate-950/50 border-slate-800"
                }`}>
                  <div className="flex items-center gap-1">
                    <span className="text-slate-500">#{idx + 1}</span>
                    <span className={`font-black ${isMain ? "text-rose-400" : "text-slate-300"}`}>
                      {row.strikePrice}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-slate-400 font-bold">OI: {formatOi(row.ceOI)}</span>
                    <span className={row.ceOIChange >= 0 ? "text-emerald-500" : "text-rose-500"}>
                      {row.ceOIChange >= 0 ? "+" : ""}{formatOi(row.ceOIChange)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Top Support Strikes */}
          <div className="space-y-1.5">
            <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider block border-b border-emerald-900/30 pb-1 mb-2">SUPPORT ZONES</span>
            {topPutOiRows.map((row, idx) => {
              const isMain = row.strikePrice === support;
              return (
                <div key={row.strikePrice} className={`flex justify-between items-center p-1.5 rounded border transition-colors ${
                  isMain ? "bg-emerald-950/30 border-emerald-900/50" : "bg-slate-950/50 border-slate-800"
                }`}>
                  <div className="flex items-center gap-1">
                    <span className="text-slate-500">#{idx + 1}</span>
                    <span className={`font-black ${isMain ? "text-emerald-400" : "text-slate-300"}`}>
                      {row.strikePrice}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-slate-400 font-bold">OI: {formatOi(row.peOI)}</span>
                    <span className={row.peOIChange >= 0 ? "text-emerald-500" : "text-rose-500"}>
                      {row.peOIChange >= 0 ? "+" : ""}{formatOi(row.peOIChange)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
