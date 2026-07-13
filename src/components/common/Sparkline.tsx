import React from "react";

interface SparklineProps {
  points: number[];
  strokeColor: string;
}

export default function Sparkline({ points, strokeColor }: SparklineProps) {
  if (points.length < 2) {
    return (
      <div className="h-3 flex items-center justify-center text-[6.5px] text-slate-500/70 font-mono italic">
        Waiting...
      </div>
    );
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const padding = 1.0;

  const width = 120;
  const height = 9;

  const pathD = points
    .map((val, idx) => {
      const x = (idx / (points.length - 1)) * (width - padding * 2) + padding;
      const y = height - ((val - min) / range) * (height - padding * 2) - padding;
      return `${idx === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  const fillD = `${pathD} L ${(width - padding).toFixed(1)} ${height} L ${padding.toFixed(1)} ${height} Z`;
  const gradId = `spark-grad-${Math.random().toString(36).slice(2, 6)}`;

  return (
    <div className="w-full h-3.5 flex items-center justify-center mt-0.5 opacity-90 hover:opacity-100 transition-opacity px-1 pb-0.5">
      <svg className="w-full h-full overflow-visible" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={strokeColor} stopOpacity="0.15" />
            <stop offset="100%" stopColor={strokeColor} stopOpacity="0.00" />
          </linearGradient>
        </defs>
        {min < 0 && max > 0 && (
          <line
            x1={0}
            y1={height - ((0 - min) / range) * (height - padding * 2) - padding}
            x2={width}
            y2={height - ((0 - min) / range) * (height - padding * 2) - padding}
            stroke="rgba(255, 255, 255, 0.10)"
            strokeDasharray="1,1"
            strokeWidth="0.3"
          />
        )}
        <path
          d={fillD}
          fill={`url(#${gradId})`}
        />
        <path
          d={pathD}
          fill="none"
          stroke={strokeColor}
          strokeWidth="1.0"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle
          cx={width - padding}
          cy={height - ((points[points.length - 1] - min) / range) * (height - padding * 2) - padding}
          r="0.8"
          fill={strokeColor}
        />
      </svg>
    </div>
  );
}
