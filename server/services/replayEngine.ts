import { Server as SocketIOServer } from "socket.io";
import { db } from "../storage/db.js";

export interface ReplaySession {
  sessionId: string;
  index: "NIFTY" | "SENSEX";
  currentVirtualTime: number; // Unix timestamp in ms
  playStatus: "PLAYING" | "PAUSED";
  speedFactor: number; // 1x, 5x, 10x, 50x, 100x
  startTime: number;
  endTime: number;
  intervalTimer: ReturnType<typeof setInterval> | null;
}

const activeSessions: Map<string, ReplaySession> = new Map();
const TICK_INTERVAL_MS = 500; // Emit frame every 500ms

/**
 * Initializes a new high-fidelity market replay session.
 * 
 * Configures the virtual replay clock and maps data boundaries.
 */
export function initReplaySession(
  sessionId: string,
  index: "NIFTY" | "SENSEX",
  startTimeMs: number,
  endTimeMs: number
): ReplaySession {
  // Clear any existing session with the same ID
  stopReplaySession(sessionId);

  const session: ReplaySession = {
    sessionId,
    index,
    currentVirtualTime: startTimeMs,
    playStatus: "PAUSED",
    speedFactor: 1,
    startTime: startTimeMs,
    endTime: endTimeMs,
    intervalTimer: null
  };

  activeSessions.set(sessionId, session);
  console.log(`[ReplayEngine] 🎬 Session initialized: ${sessionId} for ${index} starting at ${new Date(startTimeMs).toISOString()}`);
  return session;
}

/** Set virtual clock playback speed factor */
export function setReplaySpeed(sessionId: string, speed: number): void {
  const session = activeSessions.get(sessionId);
  if (!session) return;

  session.speedFactor = Math.max(1, Math.min(100, speed));
  console.log(`[ReplayEngine] Session ${sessionId} speed updated to ${session.speedFactor}x`);
}

/** Start virtual session clock and streaming WebSocket frames */
export function playReplaySession(sessionId: string, io: SocketIOServer): void {
  const session = activeSessions.get(sessionId);
  if (!session || session.playStatus === "PLAYING") return;

  session.playStatus = "PLAYING";
  console.log(`[ReplayEngine] ▶ Playing session: ${sessionId}`);

  session.intervalTimer = setInterval(async () => {
    // Increment virtual clock time proportionally
    // 500ms real interval * speedFactor = virtual seconds elapsed
    const elapsedVirtualMs = TICK_INTERVAL_MS * session.speedFactor;
    session.currentVirtualTime += elapsedVirtualMs;

    if (session.currentVirtualTime >= session.endTime) {
      session.currentVirtualTime = session.endTime;
      pauseReplaySession(sessionId);
      io.to(sessionId).emit("replay-finished", { sessionId });
      console.log(`[ReplayEngine] 🏁 Replay session finished: ${sessionId}`);
      return;
    }

    // Stream synchronized market frame
    await streamReplayFrame(session, io);
  }, TICK_INTERVAL_MS);
}

/** Pause virtual clock ticks */
export function pauseReplaySession(sessionId: string): void {
  const session = activeSessions.get(sessionId);
  if (!session || session.playStatus === "PAUSED") return;

  session.playStatus = "PAUSED";
  if (session.intervalTimer) {
    clearInterval(session.intervalTimer);
    session.intervalTimer = null;
  }
  console.log(`[ReplayEngine] ⏸ Paused session: ${sessionId}`);
}

/** Step virtual clock forward by a single 1-second increment */
export async function stepReplaySession(sessionId: string, io: SocketIOServer, direction: "FORWARD" | "BACKWARD" = "FORWARD"): Promise<void> {
  const session = activeSessions.get(sessionId);
  if (!session) return;

  pauseReplaySession(sessionId);
  const stepMs = 1000; // 1 second step
  if (direction === "FORWARD") {
    session.currentVirtualTime = Math.min(session.endTime, session.currentVirtualTime + stepMs);
  } else {
    session.currentVirtualTime = Math.max(session.startTime, session.currentVirtualTime - stepMs);
  }

  await streamReplayFrame(session, io);
  console.log(`[ReplayEngine] 👣 Stepped ${direction} to virtual time: ${new Date(session.currentVirtualTime).toISOString()}`);
}

/** Clear session and terminate thread timers cleanly */
export function stopReplaySession(sessionId: string): void {
  const session = activeSessions.get(sessionId);
  if (!session) return;

  pauseReplaySession(sessionId);
  activeSessions.delete(sessionId);
  console.log(`[ReplayEngine] 🛑 Session terminated: ${sessionId}`);
}

// ── Frame compiler: fetches and aggregates historical state ────────────────

async function streamReplayFrame(session: ReplaySession, io: SocketIOServer) {
  const targetTime = new Date(session.currentVirtualTime);
  const isNifty = session.index === "NIFTY";
  const indexSymbol = isNifty ? "NSE:NIFTY50-INDEX" : "BSE:SENSEX-INDEX";

  try {
    // 1. Fetch closest raw spot tick record
    const spotQuery = `
      SELECT ltp, volume, oi, vwap
      FROM raw_ticks
      WHERE symbol = $1 AND timestamp <= $2
      ORDER BY timestamp DESC
      LIMIT 1
    `;
    const spotRes = await db.query(spotQuery, [indexSymbol, targetTime]);
    const spot = spotRes.rows[0] || { ltp: 0, volume: 0, oi: 0, vwap: 0 };

    // 2. Fetch closest Option Chain Snapshot
    const snapQuery = `
      SELECT atm_strike, pcr, max_pain, support_zone, resistance_zone, total_call_oi, total_put_oi
      FROM option_chain_snapshots
      WHERE index_symbol = $1 AND timestamp <= $2
      ORDER BY timestamp DESC
      LIMIT 1
    `;
    const snapRes = await db.query(snapQuery, [indexSymbol, targetTime]);
    const snap = snapRes.rows[0] || { atm_strike: 0, pcr: 1.0, max_pain: 0, support_zone: 0, resistance_zone: 0, total_call_oi: 0, total_put_oi: 0 };

    // 3. Fetch closest detailed strike matrix array
    const strikesQuery = `
      SELECT strike_price as "strikePrice", ce_ltp as "ceLtp", ce_oi as "ceOI", ce_oi_change as "ceOIChange",
             ce_volume as "ceVolume", ce_iv as "ceIV", pe_ltp as "peLtp", pe_oi as "peOI",
             pe_oi_change as "peOIChange", pe_volume as "peVolume", pe_iv as "peIV"
      FROM option_strike_details
      WHERE index_symbol = $1 AND timestamp = (
        SELECT timestamp FROM option_strike_details
        WHERE index_symbol = $1 AND timestamp <= $2
        ORDER BY timestamp DESC
        LIMIT 1
      )
      ORDER BY strike_price ASC
    `;
    const strikesRes = await db.query(strikesQuery, [indexSymbol, targetTime]);

    // 4. Fetch closest heavyweight stock point contributions
    const hwQuery = `
      SELECT stock_symbol as "symbol", ltp, weightage, contribution_points as "points",
             contribution_pct as "pct", momentum_score as "momentum", acceleration_score as "acceleration",
             divergence_score as "divergence"
      FROM heavyweight_contributions
      WHERE index_symbol = $1 AND timestamp = (
        SELECT timestamp FROM heavyweight_contributions
        WHERE index_symbol = $1 AND timestamp <= $2
        ORDER BY timestamp DESC
        LIMIT 1
      )
      ORDER BY contribution_points DESC
    `;
    const hwRes = await db.query(hwQuery, [indexSymbol, targetTime]);

    // 5. Fetch closest custom momentum scores
    const scoreQuery = `
      SELECT top10_pos_sum as "top10Pos", top10_neg_sum as "top10Neg", top25_pos_sum as "top25Pos",
             top25_neg_sum as "top25Neg", live_momentum_diff as "momentumDiff",
             heavyweight_net_score as "heavyweightScore", confidence_score as "confidence",
             market_strength as "strength", internal_breadth as "breadth"
      FROM custom_score_warehouse
      WHERE index_symbol = $1 AND timestamp <= $2
      ORDER BY timestamp DESC
      LIMIT 1
    `;
    const scoreRes = await db.query(scoreQuery, [indexSymbol, targetTime]);
    const score = scoreRes.rows[0] || { top10Pos: 0, top10Neg: 0, top25Pos: 0, top25Neg: 0, momentumDiff: 0, heavyweightScore: 0, confidence: 50, strength: 50, breadth: 50 };

    // Compile fully synchronized historical replay frame
    const frame = {
      sessionId: session.sessionId,
      index: session.index,
      virtualTime: session.currentVirtualTime,
      virtualTimeISO: targetTime.toISOString(),
      spotPrice: Number(spot.ltp),
      spotVolume: Number(spot.volume),
      spotOi: Number(spot.oi),
      spotVwap: Number(spot.vwap),
      optionChain: {
        atmStrike: Number(snap.atm_strike),
        pcr: Number(snap.pcr),
        maxPain: Number(snap.max_pain),
        supportStrike: Number(snap.support_zone),
        resistanceStrike: Number(snap.resistance_zone),
        totalCallOi: Number(snap.total_call_oi),
        totalPutOi: Number(snap.total_put_oi),
        strikes: strikesRes.rows
      },
      heavyweights: hwRes.rows,
      scores: score,
    };

    // Broadcast frame to the specific socket room (session room)
    io.to(session.sessionId).emit("replay-frame", frame);

  } catch (err: any) {
    console.error(`[ReplayEngine] ❌ Error compiling replay frame:`, err.message);
  }
}
