import React, { FC } from 'react';

type GlowColor = 'green' | 'red' | 'yellow' | 'blue' | 'none';

interface TECardProps {
  title: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  headerRight?: React.ReactNode;
  glow?: GlowColor;
}

const glowStyles: Record<GlowColor, string> = {
  green:  'shadow-[0_0_18px_2px_rgba(34,197,94,0.18)] border-green-700/40',
  red:    'shadow-[0_0_18px_2px_rgba(239,68,68,0.18)] border-red-700/40',
  yellow: 'shadow-[0_0_18px_2px_rgba(234,179,8,0.18)] border-yellow-600/40',
  blue:   'shadow-[0_0_18px_2px_rgba(59,130,246,0.18)] border-blue-700/40',
  none:   'border-slate-700/30',
};

const TECard: FC<TECardProps> = ({
  title,
  badge,
  children,
  className = '',
  headerRight,
  glow = 'none',
}) => {
  const glowClass = glowStyles[glow];

  return (
    <div
      className={`
        relative bg-slate-900/95 backdrop-blur-sm rounded-xl border
        ${glowClass}
        overflow-hidden
        ${className}
      `}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/30 bg-slate-950/40">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-200 tracking-wide">
            {title}
          </span>
          {badge && <span>{badge}</span>}
        </div>
        {headerRight && (
          <div className="flex items-center gap-2">{headerRight}</div>
        )}
      </div>

      {/* Content */}
      <div className="p-4">{children}</div>
    </div>
  );
};

export default TECard;

