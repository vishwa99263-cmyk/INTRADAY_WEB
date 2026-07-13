/**
 * TradingViewPage.tsx
 *
 * Full-page wrapper that mounts TradingViewDashboard and wires it to the
 * app's existing socket-driven option-chain data.
 *
 * Drop this as a new tab or route in App.tsx.
 *
 * Usage in App.tsx:
 *   import TradingViewPage from './components/charts/TradingViewPage';
 *   <TradingViewPage darkMode={darkMode} optionChainState={optionChainState} socket={socket} />
 */

import React, { useRef, useCallback } from "react";
import TradingViewDashboard, {
  TradingViewDashboardRef,
  IndexSymbol,
} from "./TradingViewDashboard";
import LiveOptionChain from "../OptionChain/LiveOptionChain";
import type { OptionChainState } from "../../types";

interface TradingViewPageProps {
  darkMode?: boolean;
  optionChainState: OptionChainState;
  onSelectExpiry?: (expiry: string) => void;
  fyersAuthorized?: boolean;
  spotPrices?: Record<IndexSymbol, number>;
  spotChanges?: Record<IndexSymbol, number>;
}

export default function TradingViewPage({
  darkMode = true,
  optionChainState,
  onSelectExpiry,
  fyersAuthorized = false,
  spotPrices,
  spotChanges,
}: TradingViewPageProps) {
  const dashRef = useRef<TradingViewDashboardRef>(null);

  /**
   * renderOptionChain — called by TradingViewDashboard whenever the active index
   * changes.  We always render LiveOptionChain; the parent's optionChainState
   * is already keyed to the user-selected expiry.
   */
  const renderOptionChain = useCallback(
    (_activeIndex: IndexSymbol) => (
      <LiveOptionChain
        fyersAuthorized={fyersAuthorized}
        darkMode={darkMode}
        optionChainState={optionChainState}
        onSelectExpiry={onSelectExpiry ?? (() => {})}
      />
    ),
    [darkMode, fyersAuthorized, optionChainState, onSelectExpiry]
  );

  return (
    <div style={{ width: "100%", height: "100%", minHeight: 0 }}>
      <TradingViewDashboard
        ref={dashRef}
        darkMode={darkMode}
        renderOptionChain={renderOptionChain}
        spotPrices={spotPrices}
        spotChanges={spotChanges}
        defaultIndex="NIFTY"
      />
    </div>
  );
}

/**
 * ─── Programmatic Paper Trade API ─────────────────────────────────────────────
 *
 * From any parent component that holds a ref to TradingViewPage (or directly to
 * TradingViewDashboard), you can call:
 *
 *   const dashRef = useRef<TradingViewDashboardRef>(null);
 *
 *   // Draw a BUY entry at 24,500
 *   dashRef.current?.plotEntryLine(24500, 'BUY');
 *
 *   // Draw Take Profit at 24,700
 *   dashRef.current?.plotTPLine(24700);
 *
 *   // Draw Stop Loss at 24,300
 *   dashRef.current?.plotSLLine(24300);
 *
 *   // Clear all overlays
 *   dashRef.current?.clearPaperTrades();
 *
 *   // Switch index programmatically
 *   dashRef.current?.switchIndex('BANKNIFTY');
 *
 * All three line types render as colored dashed horizontal lines with price-pill
 * labels on the right edge of the chart canvas, sitting above the TradingView
 * iframe (pointer-events: none so TV tools remain fully functional).
 */
