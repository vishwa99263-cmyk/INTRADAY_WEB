import React, { useState } from "react";
import { Sliders } from "lucide-react";

interface ResizableBoxProps {
  id: string;
  defaultWidth?: string;
  defaultHeight?: string;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  editMode: boolean;
  className?: string;
  children: React.ReactNode;
}

export default function ResizableBox({
  id,
  defaultWidth = "100%",
  defaultHeight = "auto",
  minWidth = 10,
  maxWidth = 100,
  minHeight = 50,
  maxHeight = 1200,
  editMode,
  className = "",
  children
}: ResizableBoxProps) {
  const [width, setWidth] = useState(() => {
    return localStorage.getItem(`box-w-${id}`) || defaultWidth;
  });
  const [height, setHeight] = useState(() => {
    return localStorage.getItem(`box-h-${id}`) || defaultHeight;
  });

  const handleWidthChange = (val: number) => {
    const w = `${val}%`;
    setWidth(w);
    localStorage.setItem(`box-w-${id}`, w);
  };

  const handleHeightChange = (val: number) => {
    const h = val === 0 ? "auto" : `${val}px`;
    setHeight(h);
    localStorage.setItem(`box-h-${id}`, h);
  };

  const handleReset = () => {
    setWidth(defaultWidth);
    setHeight(defaultHeight);
    localStorage.removeItem(`box-w-${id}`);
    localStorage.removeItem(`box-h-${id}`);
  };

  // Convert width percent to number for slider (default 100%)
  const widthVal = width.endsWith("%") ? parseInt(width) : 100;
  // Convert height px to number for slider (default 0 for auto)
  const heightVal = height === "auto" ? 0 : parseInt(height);

  return (
    <div 
      style={{ 
        width: width, 
        height: height === "auto" ? undefined : height,
      }}
      className={`relative transition-all duration-150 flex flex-col ${className}`}
    >
      {editMode && (
        <div className="absolute top-1.5 right-1.5 z-[100] bg-slate-900/90 border border-slate-700 rounded-lg p-2.5 text-white font-mono text-[9px] shadow-2xl flex flex-col gap-2 w-48 backdrop-blur-sm select-none">
          <div className="flex items-center justify-between border-b border-slate-700 pb-1.5 font-bold text-teal-400">
            <span className="flex items-center gap-1.5"><Sliders size={11} /> RESIZE CARD</span>
            <button 
              onClick={handleReset}
              className="px-1.5 py-0.5 bg-rose-900/60 hover:bg-rose-900 border border-rose-700 rounded text-[7px] cursor-pointer font-bold uppercase transition-colors"
            >
              Reset
            </button>
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex justify-between font-bold">
              <span>BREADTH (W):</span>
              <span className="text-teal-350">{width}</span>
            </div>
            <input 
              type="range" 
              min={minWidth} 
              max={maxWidth} 
              value={widthVal}
              onChange={(e) => handleWidthChange(Number(e.target.value))}
              className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-teal-400"
            />
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex justify-between font-bold">
              <span>LENGTH (H):</span>
              <span className="text-teal-350">{height}</span>
            </div>
            <input 
              type="range" 
              min={0} 
              max={maxHeight} 
              step={10}
              value={heightVal}
              onChange={(e) => handleHeightChange(Number(e.target.value))}
              className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-teal-400"
            />
            <span className="text-[7px] text-slate-400 italic">0 = Auto (Content Height)</span>
          </div>
        </div>
      )}
      {children}
    </div>
  );
}
