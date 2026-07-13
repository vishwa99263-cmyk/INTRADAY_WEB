import fs from "fs";
import path from "path";
import { Server as SocketIOServer } from "socket.io";
import { marketState } from "../state/marketState.js";
import {
  buildSmartOrder,
  checkOrderTrigger,
  aiBrainEvaluateOrder,
  SmartPendingOrder,
  OrderStatus,
  DiscountMethod
} from "../../src/engine/smartOrderQueue.js";

const STORAGE_FILE = path.join(process.cwd(), "server", "storage", "smart_orders.json");

class SmartOrderQueueService {
  private orders: SmartPendingOrder[] = [];
  private io: SocketIOServer | null = null;
  private executionCallback: ((order: SmartPendingOrder, params: any) => Promise<void>) | null = null;
  private entryParamsMap = new Map<string, any>();

  constructor() {
    this.loadOrders();
  }

  public setSocketServer(io: SocketIOServer) {
    this.io = io;
    this.broadcast();
  }

  public onExecuteOrder(cb: (order: SmartPendingOrder, params: any) => Promise<void>) {
    this.executionCallback = cb;
  }

  private loadOrders() {
    try {
      if (fs.existsSync(STORAGE_FILE)) {
        const raw = fs.readFileSync(STORAGE_FILE, "utf8");
        this.orders = JSON.parse(raw);
        console.log(`[SmartQueue] Loaded ${this.orders.length} orders from storage.`);
      }
    } catch (e) {
      console.error("[SmartQueue] Failed to load orders:", e);
      this.orders = [];
    }
  }

  private saveOrders() {
    try {
      const dir = path.dirname(STORAGE_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(STORAGE_FILE, JSON.stringify(this.orders, null, 2), "utf8");
    } catch (e) {
      console.error("[SmartQueue] Failed to save orders:", e);
    }
  }

  public getOrders(): SmartPendingOrder[] {
    return this.orders;
  }

  public createOrder(params: any, entryParams: any) {
    const order = buildSmartOrder(params);
    this.orders.push(order);
    this.entryParamsMap.set(order.id, entryParams);
    this.saveOrders();
    this.broadcast();
    console.log(`[SmartQueue] Created pending discount order: ${order.id} for ${order.index} ${order.direction}`);
    return order;
  }

  public cancelOrder(id: string, reason = "Manually cancelled by user") {
    const idx = this.orders.findIndex(o => o.id === id);
    if (idx !== -1) {
      const order = this.orders[idx];
      if (order.status === "QUEUED" || order.status === "MONITORING") {
        order.status = "CANCELLED";
        order.statusMessage = `❌ Cancelled: ${reason}`;
        this.saveOrders();
        this.broadcast();
        console.log(`[SmartQueue] Order ${id} cancelled. Reason: ${reason}`);
      }
    }
  }

  public processTicks(symbol: string, ltp: number) {
    let changed = false;

    // Build LTPSnapshot array for checking
    const ltpSnaps = [{
      symbol,
      ltp,
      timestamp: new Date().toISOString(),
      change: 0,
      changePct: 0,
      volume: 0,
      oi: 0
    }];

    for (const order of this.orders) {
      if (order.status !== "QUEUED" && order.status !== "MONITORING") continue;

      const leg = order.legs[0];
      if (!leg || leg.symbol !== symbol) continue;

      // Update current LTP inside the leg
      leg.currentLTP = ltp;

      // Check trigger conditions
      const result = checkOrderTrigger(order, ltpSnaps);

      if (result.shouldTrigger) {
        order.status = "TRIGGERED";
        order.triggeredAt = new Date().toISOString();
        order.statusMessage = `⚡ Price reached discount ${leg.discountPrice}. Firing order...`;
        changed = true;
        console.log(`[SmartQueue] Triggering order ${order.id} for execution!`);

        // Execute trade asynchronously
        this.executeTrade(order);
      } else if (result.shouldCancel) {
        order.status = "CANCELLED";
        order.statusMessage = `❌ Cancelled: ${result.reason}`;
        changed = true;
        console.log(`[SmartQueue] Order ${order.id} cancelled. Reason: ${result.reason}`);
      } else {
        // Evaluate AI brain watch cancellation rules
        const snap = this.buildMarketSnapshot(order);
        const aiDecision = aiBrainEvaluateOrder(order, snap);
        if (aiDecision.shouldCancel) {
          order.status = "CANCELLED";
          order.statusMessage = `🤖 AI Cancel: ${aiDecision.explanation}`;
          changed = true;
          console.log(`[SmartQueue] Order ${order.id} cancelled by AI Brain. Reason: ${aiDecision.reason}`);
        }
      }
    }

    if (changed) {
      this.saveOrders();
      this.broadcast();
    }
  }

  private async executeTrade(order: SmartPendingOrder) {
    try {
      const leg = order.legs[0];
      if (!leg) return;

      console.log(`[SmartQueue] Executing real/paper trade for order ${order.id}...`);

      // Retrieve preserved entry params
      const params = this.entryParamsMap.get(order.id);
      if (!params && this.executionCallback) {
        console.warn(`[SmartQueue] No entry params mapped for order ${order.id}. Falling back to default execution.`);
      }

      // Update execution status
      order.status = "EXECUTED";
      order.executedAt = new Date().toISOString();
      leg.fillPrice = leg.currentLTP;
      order.totalPremiumPaid = leg.fillPrice * leg.lots * leg.lotSize;
      order.statusMessage = `✅ Order executed at Rs.${leg.fillPrice} (Real LTP touched discount target).`;

      if (this.executionCallback) {
        // Execute actual paper/real trade via callback to autoTradingService
        await this.executionCallback(order, params);
      }

      this.saveOrders();
      this.broadcast();
    } catch (e: any) {
      console.error(`[SmartQueue] Trade execution failed for order ${order.id}:`, e);
      order.status = "REJECTED";
      order.statusMessage = `🚫 Execution failed: ${e.message}`;
      this.saveOrders();
      this.broadcast();
    }
  }

  private buildMarketSnapshot(order: SmartPendingOrder): any {
    const isNifty = order.index === "NIFTY";
    const isBanknifty = order.index === "BANKNIFTY";
    const chain = isNifty
      ? marketState.niftyOptionChain
      : (isBanknifty ? marketState.bankniftyOptionChain : marketState.sensexOptionChain);

    return {
      currentRegime:     order.signalRegime,
      aiConfidence:      order.aiConfidence,
      smartMoneyScore:   order.smartMoneyScore,
      vix:               chain?.indiaVix ?? 14.5,
      vixAtSignal:       chain?.indiaVix ?? 14.0,
      breadthScore:      55,
      underlyingLTP:     chain?.spotPrice ?? order.underlyingCurrentPrice,
      oiWallAbove:       null,
      oiWallBelow:       null,
      pcrCurrent:        (chain?.totalPutOi || 10) / (chain?.totalCallOi || 10),
      pcrAtSignal:       1.0,
      timeNow:           new Date().toISOString()
    };
  }

  public broadcast() {
    if (this.io) {
      this.io.emit("smart-orders-update", this.orders);
    }
  }
}

export const smartOrderQueueService = new SmartOrderQueueService();
