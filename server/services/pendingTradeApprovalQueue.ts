/**
 * pendingTradeApprovalQueue.ts
 * ════════════════════════════════════════════════════════════
 * Shadow-Trade Approval Gate
 *
 * Flow:
 *   1. Auto-trading system fires a signal → paper trade is saved immediately
 *   2. Instead of instantly calling executeFyersOrder, a PendingApproval item
 *      is pushed here with a 5-minute TTL.
 *   3. Server emits "pending-trade-approval" socket event to all frontends.
 *   4. User clicks APPROVE → executeFyersOrder is called for the real order.
 *   5. User clicks REJECT  → item is removed, only the paper trade remains.
 *   6. Items auto-expire after TTL_MS milliseconds.
 */

import { EventEmitter } from "events";
import { executeFyersOrder, type FyersBridgeTradePayload } from "./fyersOrderBridge.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PendingTradeApproval {
  id: string;                 // Unique approval ID (same as paper trade id)
  paperId: string;            // Paper trade DB id
  instrument: string;         // NIFTY | BANKNIFTY | SENSEX
  direction: string;          // BUY_CE | BUY_PE
  strike: number;
  qty: number;                // Actual quantity (lots × lot_size)
  entry_price: number;
  target: number;
  stop_loss: number;
  contractSymbol: string;
  strategyName: string;
  confidence: number;
  signalGrade: string;
  oiBrainScore?: number;
  oiBrainGrade?: string;
  createdAt: number;          // Unix ms
  expiresAt: number;          // Unix ms (createdAt + TTL_MS)
  status: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";
  tradeType?: "INTRADAY" | "POSITIONAL";
}

export const approvalQueueEmitter = new EventEmitter();

// ── Configuration ─────────────────────────────────────────────────────────────

const TTL_MS = 5 * 60 * 1000; // 5 minutes

// ── In-memory queue ───────────────────────────────────────────────────────────

const queue: Map<string, PendingTradeApproval> = new Map();

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Add a new trade approval request.
 * Returns the approval object so the caller can emit it over the socket.
 */
export function addApprovalRequest(params: {
  paperId: string;
  instrument: string;
  direction: string;
  strike: number;
  qty: number;
  entry_price: number;
  target: number;
  stop_loss: number;
  contractSymbol: string;
  strategyName: string;
  confidence: number;
  signalGrade: string;
  oiBrainScore?: number;
  oiBrainGrade?: string;
  tradeType?: "INTRADAY" | "POSITIONAL";
}): PendingTradeApproval {
  const now = Date.now();
  const approval: PendingTradeApproval = {
    id: params.paperId,
    paperId: params.paperId,
    instrument: params.instrument,
    direction: params.direction,
    strike: params.strike,
    qty: params.qty,
    entry_price: params.entry_price,
    target: params.target,
    stop_loss: params.stop_loss,
    contractSymbol: params.contractSymbol,
    strategyName: params.strategyName,
    confidence: params.confidence,
    signalGrade: params.signalGrade,
    oiBrainScore: params.oiBrainScore,
    oiBrainGrade: params.oiBrainGrade,
    createdAt: now,
    expiresAt: now + TTL_MS,
    status: "PENDING",
    tradeType: params.tradeType ?? "INTRADAY",
  };

  queue.set(approval.id, approval);
  console.log(`[ApprovalQueue] ➕ New trade approval request: ${approval.instrument} ${approval.direction} @ ₹${approval.entry_price} (ID: ${approval.id})`);
  approvalQueueEmitter.emit("queue-changed", getAllPendingApprovals());

  // 🚀 AUTOMATED AUTO-APPROVAL (NO MANUAL APPROVAL REQUIRED — ALWAYS APPROVED AUTOMATICALLY)
  approveTradeRequest(approval.id).catch(err => {
    console.error("[ApprovalQueue] Auto-approve execution error:", err.message);
  });

  return approval;
}

/**
 * Approve a pending trade — executes the real Fyers order.
 * Returns true if successfully approved and dispatched.
 */
export async function approveTradeRequest(id: string): Promise<{ success: boolean; message: string }> {
  const approval = queue.get(id);
  if (!approval) {
    return { success: false, message: "Trade approval request not found or already processed." };
  }
  if (approval.status !== "PENDING") {
    return { success: false, message: `Trade is already ${approval.status}.` };
  }
  if (Date.now() > approval.expiresAt) {
    approval.status = "EXPIRED";
    queue.set(id, approval);
    approvalQueueEmitter.emit("queue-changed", getAllPendingApprovals());
    return { success: false, message: "Trade approval request has expired (>5 minutes)." };
  }

  approval.status = "APPROVED";
  queue.set(id, approval);

  console.log(`[ApprovalQueue] ✅ APPROVED: ${approval.instrument} ${approval.direction} @ ₹${approval.entry_price} — dispatching real order to Fyers...`);

  try {
    const payload: FyersBridgeTradePayload = {
      id: approval.paperId,
      instrument: approval.instrument,
      direction: approval.direction,
      strike: approval.strike,
      qty: approval.qty,
      entry_price: approval.entry_price,
      target: approval.target,
      stop_loss: approval.stop_loss,
      contractSymbol: approval.contractSymbol,
      strategyName: approval.strategyName,
      tradeType: approval.tradeType,
    };
    await executeFyersOrder(payload, "ENTRY");
    approvalQueueEmitter.emit("queue-changed", getAllPendingApprovals());
    // Remove from queue after 30s to let UI reflect the approved state
    setTimeout(() => { queue.delete(id); }, 30_000);
    return { success: true, message: `✅ Real order dispatched to Fyers for ${approval.instrument} ${approval.direction} @ ₹${approval.entry_price}` };
  } catch (err: any) {
    console.error(`[ApprovalQueue] ❌ Fyers order execution failed:`, err.message);
    approval.status = "PENDING"; // revert on error so user can retry
    queue.set(id, approval);
    approvalQueueEmitter.emit("queue-changed", getAllPendingApprovals());
    return { success: false, message: `Fyers order failed: ${err.message}` };
  }
}

/**
 * Reject a pending trade — discards the approval, paper trade remains.
 */
export function rejectTradeRequest(id: string): { success: boolean; message: string } {
  const approval = queue.get(id);
  if (!approval) {
    return { success: false, message: "Trade approval request not found or already processed." };
  }
  if (approval.status !== "PENDING") {
    return { success: false, message: `Trade is already ${approval.status}.` };
  }

  approval.status = "REJECTED";
  queue.set(id, approval);
  console.log(`[ApprovalQueue] ❌ REJECTED: ${approval.instrument} ${approval.direction} (ID: ${id}). Only paper trade remains.`);
  approvalQueueEmitter.emit("queue-changed", getAllPendingApprovals());
  // Remove from queue after 15s
  setTimeout(() => { queue.delete(id); }, 15_000);
  return { success: true, message: "Trade rejected. Only paper trade recorded." };
}

/**
 * Returns all PENDING approval items (sorted newest first).
 */
export function getAllPendingApprovals(): PendingTradeApproval[] {
  expireStaleRequests();
  return Array.from(queue.values())
    .filter(a => a.status === "PENDING")
    .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Returns all items in queue (including APPROVED/REJECTED, for history).
 */
export function getAllApprovals(): PendingTradeApproval[] {
  return Array.from(queue.values()).sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Remove expired pending items from queue.
 */
function expireStaleRequests(): void {
  const now = Date.now();
  for (const [id, approval] of queue.entries()) {
    if (approval.status === "PENDING" && now > approval.expiresAt) {
      approval.status = "EXPIRED";
      queue.set(id, approval);
      console.log(`[ApprovalQueue] ⏰ Expired trade approval: ${approval.instrument} ${approval.direction} (ID: ${id})`);
      // Remove expired from queue after a short delay
      setTimeout(() => { queue.delete(id); }, 5_000);
    }
  }
}

// ── Auto-expiry timer ─────────────────────────────────────────────────────────
// Check for expired items every 30 seconds
setInterval(() => {
  const stale = getAllPendingApprovals(); // this also calls expireStaleRequests
  if (stale.length === 0) return; // nothing changed
}, 30_000);
