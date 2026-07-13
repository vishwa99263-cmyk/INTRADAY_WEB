// Shared chart types used by RealtimeChart.tsx and ChartsDashboard.tsx

export type ChartInstrument =
  | "NIFTY_SPOT"
  | "SENSEX_SPOT"
  | "CE_PREMIUM"
  | "PE_PREMIUM"
  | "NET_SCORE"
  | "PCR"
  | "OI_DIFF"
  | "MOMENTUM";

export type Timeframe = "1m" | "5m" | "15m";

export interface OHLCVCandle {
  time:   number;
  open:   number;
  high:   number;
  low:    number;
  close:  number;
  volume: number;
}

export interface ChartUpdatePayload {
  instrument: ChartInstrument;
  tf:         Timeframe;
  candles:    OHLCVCandle[];
}

export interface AllCandlesPayload {
  [instrument: string]: Record<Timeframe, OHLCVCandle[]>;
}
