import React, { FC } from 'react';
import { TrendingUp, TrendingDown, Minus, X } from 'lucide-react';

type SignalType = 'BUY_CE' | 'BUY_PE' | 'WAIT' | 'NO_TRADE';
type SizeVariant = 'sm' | 'md' | 'lg';

interface SignalBadgeProps {
  signal: SignalType;
  size?: SizeVariant;
}

interface SignalConfig {
  label: string;
  bg: string;
  text: string;
  border: string;
  icon: React.ReactNode;
  pulse: boolean;
}

const sizeClasses: Record<SizeVariant, { wrap: string; text: string; icon: number; px: string; py: string }> = {
  sm: { wrap: 'gap-1 rounded-md',   text: 'text-sm font-semibold', icon: 12, px: 'px-2', py: 'py-0.5' },
  md: { wrap: 'gap-1.5 rounded-lg', text: 'text-sm font-semibold', icon: 14, px: 'px-3', py: 'py-1' },
  lg: { wrap: 'gap-2 rounded-xl',   text: 'text-base font-bold',   icon: 16, px: 'px-4', py: 'py-1.5' },
};

const getConfig = (signal: SignalType, iconSize: number): SignalConfig => {
  switch (signal) {
    case 'BUY_CE':
      return {
        label: 'BUY CE',
        bg: 'bg-green-900/80',
        text: 'text-green-100',
        border: 'border border-green-600/50',
        icon: <TrendingUp size={iconSize} className="text-green-300" />,
        pulse: true,
      };
    case 'BUY_PE':
      return {
        label: 'BUY PE',
        bg: 'bg-red-900/80',
        text: 'text-red-100',
        border: 'border border-red-600/50',
        icon: <TrendingDown size={iconSize} className="text-red-300" />,
        pulse: true,
      };
    case 'WAIT':
      return {
        label: 'WAIT',
        bg: 'bg-amber-500/20',
        text: 'text-amber-200',
        border: 'border border-amber-500/40',
        icon: <Minus size={iconSize} className="text-amber-300" />,
        pulse: false,
      };
    case 'NO_TRADE':
      return {
        label: 'NO TRADE',
        bg: 'bg-slate-700/60',
        text: 'text-slate-400',
        border: 'border border-slate-600/40',
        icon: <X size={iconSize} className="text-slate-500" />,
        pulse: false,
      };
  }
};

const SignalBadge: FC<SignalBadgeProps> = ({ signal, size = 'md' }) => {
  const s = sizeClasses[size];
  const config = getConfig(signal, s.icon);

  return (
    <span
      className={`
        relative inline-flex items-center
        ${s.wrap} ${s.px} ${s.py}
        ${config.bg} ${config.text} ${config.border}
        backdrop-blur-sm select-none
        transition-all duration-200
      `}
    >
      {/* Pulse ring for active signals */}
      {config.pulse && (
        <span
          className={`
            absolute inset-0 rounded-[inherit]
            ${signal === 'BUY_CE' ? 'bg-green-500/20' : 'bg-red-500/20'}
            animate-ping
          `}
          style={{ animationDuration: '1.8s' }}
        />
      )}

      <span className="relative flex items-center gap-1.5">
        {config.icon}
        <span className={s.text}>{config.label}</span>
      </span>
    </span>
  );
};

export default SignalBadge;

