import React, { FC, useEffect, useState } from 'react';

type ColorScheme = 'auto' | 'green' | 'red' | 'yellow';

interface ConfidenceMeterProps {
  value: number;
  size?: number;
  label?: string;
  colorScheme?: ColorScheme;
}

const resolveColor = (value: number, scheme: ColorScheme): string => {
  if (scheme === 'green') return '#22c55e';
  if (scheme === 'red') return '#ef4444';
  if (scheme === 'yellow') return '#eab308';
  // auto
  if (value < 40) return '#ef4444';
  if (value <= 65) return '#eab308';
  return '#22c55e';
};

const resolveGlow = (value: number, scheme: ColorScheme): string => {
  if (scheme === 'green') return 'drop-shadow(0 0 4px rgba(34,197,94,0.55))';
  if (scheme === 'red') return 'drop-shadow(0 0 4px rgba(239,68,68,0.55))';
  if (scheme === 'yellow') return 'drop-shadow(0 0 4px rgba(234,179,8,0.55))';
  if (value < 40) return 'drop-shadow(0 0 4px rgba(239,68,68,0.55))';
  if (value <= 65) return 'drop-shadow(0 0 4px rgba(234,179,8,0.55))';
  return 'drop-shadow(0 0 4px rgba(34,197,94,0.55))';
};

const ConfidenceMeter: FC<ConfidenceMeterProps> = ({
  value,
  size = 80,
  label,
  colorScheme = 'auto' as ColorScheme,
}) => {
  const clamped = Math.min(100, Math.max(0, value));
  const strokeWidth = size * 0.1;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const cx = size / 2;
  const cy = size / 2;

  // Animate dashoffset on mount / value change
  const [offset, setOffset] = useState(circumference);

  useEffect(() => {
    // Allow a short delay so CSS transition plays on mount
    const raf = requestAnimationFrame(() => {
      setOffset(circumference - (clamped / 100) * circumference);
    });
    return () => cancelAnimationFrame(raf);
  }, [clamped, circumference]);

  const arcColor = resolveColor(clamped, colorScheme);
  const glowFilter = resolveGlow(clamped, colorScheme);

  const fontSize = size * 0.2;
  const labelFontSize = size * 0.14;

  return (
    <div className="flex flex-col items-center gap-1 select-none">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="block"
        style={{ filter: glowFilter }}
      >
        {/* Background ring */}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke="rgba(100,116,139,0.25)"
          strokeWidth={strokeWidth}
        />
        {/* Colored arc */}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke={arcColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${cx} ${cy})`}
          style={{
            transition: 'stroke-dashoffset 0.7s cubic-bezier(0.4,0,0.2,1), stroke 0.4s ease',
          }}
        />
        {/* Center value */}
        <text
          x={cx}
          y={cy + fontSize * 0.38}
          textAnchor="middle"
          fill="white"
          fontSize={fontSize}
          fontWeight="700"
          fontFamily="inherit"
        >
          {clamped}%
        </text>
      </svg>

      {label && (
        <span
          className="text-slate-400 font-medium tracking-wide text-center leading-tight"
          style={{ fontSize: labelFontSize }}
        >
          {label}
        </span>
      )}
    </div>
  );
};

export default ConfidenceMeter;

