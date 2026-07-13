/**
 * useChartStream.ts — Socket.IO Chart Stream Hook
 *
 * Manages a SINGLE socket connection per instrument.
 * Subscribes to:
 *   "index-chart-candle"   — realtime candle updates
 *   "chart-candle-update"  — alternative update event
 *   "chart-init"           — initial snapshot delivery
 *   "chart-history-loaded" — history ready signal
 *
 * Key design:
 *   - Socket created ONCE (on mount), never recreated on tf change
 *   - onCandle callback stored in ref for zero-stale-closure issues
 *   - onInit callback for receiving full candle snapshot
 *   - Connected status returned for UI
 */

import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

export interface StreamCandle {
  time:   number;
  open:   number;
  high:   number;
  low:    number;
  close:  number;
  volume: number;
}

interface UseChartStreamOptions {
  instrument:  "NIFTY" | "SENSEX" | "BANKNIFTY";
  activeTf:    string;
  onCandle?:   (candle: StreamCandle) => void;
  onInit?:     (data: Record<string, Record<string, StreamCandle[]>>) => void;
  onHistReady?: () => void;
}

export function useChartStream({
  instrument,
  activeTf,
  onCandle,
  onInit,
  onHistReady,
}: UseChartStreamOptions): { connected: boolean; socket: Socket | null } {

  const [connected, setConnected] = useState(false);
  const socketRef   = useRef<Socket | null>(null);

  // Keep callbacks in refs — never recreate socket on callback change
  const activeTfRef     = useRef(activeTf);
  const instrumentRef   = useRef(instrument);
  const onCandleRef     = useRef(onCandle);
  const onInitRef       = useRef(onInit);
  const onHistReadyRef  = useRef(onHistReady);

  useEffect(() => { activeTfRef.current   = activeTf;    }, [activeTf]);
  useEffect(() => { instrumentRef.current = instrument;  }, [instrument]);
  useEffect(() => { onCandleRef.current   = onCandle;    }, [onCandle]);
  useEffect(() => { onInitRef.current     = onInit;      }, [onInit]);
  useEffect(() => { onHistReadyRef.current = onHistReady; }, [onHistReady]);

  useEffect(() => {
    const skt = io("http://localhost:3000", {
      transports:    ["websocket", "polling"],
      reconnection:  true,
      reconnectionAttempts: Infinity,
      reconnectionDelay:    1000,
    });
    socketRef.current = skt;

    skt.on("connect",    () => setConnected(true));
    skt.on("disconnect", () => setConnected(false));

    // Realtime candle tick
    const handleCandle = (payload: { instrument: string; tf: string; candle: StreamCandle }) => {
      if (
        payload.instrument === instrumentRef.current &&
        payload.tf         === activeTfRef.current
      ) {
        onCandleRef.current?.(payload.candle);
      }
    };

    // Alternative event name used by chartStream.ts
    const handleCandleUpdate = (payload: { instrument: string; tf: string; candle: StreamCandle }) => {
      if (
        payload.instrument === instrumentRef.current &&
        payload.tf         === activeTfRef.current
      ) {
        onCandleRef.current?.(payload.candle);
      }
    };

    // Full history snapshot
    const handleInit = (payload: { data: Record<string, Record<string, StreamCandle[]>>; ready: boolean }) => {
      onInitRef.current?.(payload.data);
      if (payload.ready) onHistReadyRef.current?.();
    };

    // History ready signal
    const handleHistReady = () => {
      onHistReadyRef.current?.();
    };

    skt.on("index-chart-candle",  handleCandle);
    skt.on("chart-candle-update", handleCandleUpdate);
    skt.on("chart-init",          handleInit);
    skt.on("chart-history-loaded", handleHistReady);

    return () => {
      skt.off("index-chart-candle",   handleCandle);
      skt.off("chart-candle-update",  handleCandleUpdate);
      skt.off("chart-init",           handleInit);
      skt.off("chart-history-loaded", handleHistReady);
      skt.disconnect();
      socketRef.current = null;
    };
  }, []); // Connect ONCE — never recreated

  return { connected, socket: socketRef.current };
}
