import { Router } from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import https from "https";
import { marketState } from "../state/marketState.js";
import { startFyersSocket, resubscribeOptionSymbols } from "../services/fyersSocket.js";
import { fetchInitialChain } from "../services/optionChainStream.js";

const router = Router();

function sha256(appId: string, secretKey: string): string {
  return crypto.createHash("sha256").update(`${appId}:${secretKey}`).digest("hex");
}

function requestViaHttps(hostname: string, appIdHash: string, authCode: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      grant_type: "authorization_code",
      code: authCode,
      appIdHash: appIdHash,
    });

    const req = https.request({
      hostname,
      port: 443,
      path: "/api/v3/validate-authcode",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        "User-Agent": "AMEX-OS/1.0",
      },
      timeout: 10000,
    }, (res) => {
      let body = "";
      res.on("data", (chunk) => body += chunk);
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`Invalid JSON response: ${body.slice(0, 100)}`));
        }
      });
    });

    req.on("error", (err) => reject(err));
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Connection timed out"));
    });

    req.write(payload);
    req.end();
  });
}

export async function exchangeFyersAuthCode(appId: string, secretKey: string, authCode: string): Promise<any> {
  const appIdHash = sha256(appId, secretKey);

  // Attempt 1: Node native HTTPS request to api-t1.fyers.in
  try {
    const data = await requestViaHttps("api-t1.fyers.in", appIdHash, authCode);
    if (data && (data.s === "ok" || data.access_token)) return data;
    if (data && data.message) console.warn("[FyersAuth] api-t1 response:", data.message);
  } catch (e1: any) {
    console.warn("[FyersAuth] HTTPS api-t1 attempt failed:", e1.message);
  }

  // Attempt 2: Node native HTTPS request to api.fyers.in
  try {
    const data = await requestViaHttps("api.fyers.in", appIdHash, authCode);
    if (data && (data.s === "ok" || data.access_token)) return data;
  } catch (e2: any) {
    console.warn("[FyersAuth] HTTPS api attempt failed:", e2.message);
  }

  // Attempt 3: Native global fetch fallback
  const response = await fetch("https://api-t1.fyers.in/api/v3/validate-authcode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code: authCode,
      appIdHash: appIdHash,
    }),
  });

  return await response.json();
}

async function fetchInitialChainsSequentially() {
  const symbols = [
    "NSE:NIFTY50-INDEX",
    "BSE:SENSEX-INDEX",
    "NSE:NIFTYBANK-INDEX",
    "NSE:HDFCBANK-EQ",
    "NSE:RELIANCE-EQ",
    "NSE:ICICIBANK-EQ"
  ];
  console.log("[FyersAuth] 🚀 Starting initial option chain fetch...");
  let someLoaded = false;
  for (const sym of symbols) {
    try {
      const loaded = await fetchInitialChain(sym, "");
      if (loaded) someLoaded = true;
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (e: any) {
      console.error(`[FyersAuth] Error fetching chain for ${sym}:`, e.message);
    }
  }
  if (someLoaded) {
    resubscribeOptionSymbols();
  }
}

/**
 * GET /auth/fyers or GET /api/fyers/login
 * Redirects user to FYERS OAuth login page
 */
router.get("/auth/fyers", (req, res) => {
  const appId = marketState.fyersConfig.app_id || process.env.FYERS_APP_ID || "2YUVRX36LG-100";
  const redirectUri = marketState.fyersConfig.redirect_uri || process.env.FYERS_REDIRECT_URI || "http://127.0.0.1:3000/callback";

  const loginUrl =
    `https://api-t1.fyers.in/api/v3/generate-authcode?` +
    `client_id=${encodeURIComponent(appId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&state=amex`;

  console.log(`[FyersAuth] 🔑 Initiating OAuth login -> ${loginUrl}`);
  res.redirect(loginUrl);
});

router.get("/api/fyers/login", (req, res) => {
  const appId = marketState.fyersConfig.app_id || process.env.FYERS_APP_ID || "2YUVRX36LG-100";
  const redirectUri = marketState.fyersConfig.redirect_uri || process.env.FYERS_REDIRECT_URI || "http://127.0.0.1:3000/callback";

  const loginUrl =
    `https://api-t1.fyers.in/api/v3/generate-authcode?` +
    `client_id=${encodeURIComponent(appId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&state=amex`;

  res.json({ s: "ok", loginUrl });
});

/**
 * GET /callback & GET /api/fyers/callback
 * FYERS OAuth callback handler
 */
export async function handleFyersCallback(req: any, res: any, io?: any) {
  const authCode = (req.query.auth_code || req.query.code || req.query.authorization_code) as string;

  if (!authCode) {
    console.warn("[FyersAuth] ⚠️ Callback received without auth_code:", req.query);
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>AMEX-OS - FYERS Authentication</title></head>
      <body style="font-family: sans-serif; background: #0f172a; color: #f87171; text-align: center; padding: 60px 20px;">
        <div style="max-width: 520px; margin: 0 auto; background: #1e293b; padding: 40px; border-radius: 12px; border: 1px solid #334155;">
          <div style="font-size: 44px; margin-bottom: 16px;">🔑</div>
          <h2 style="color: #38bdf8; margin-bottom: 12px;">Authorize FYERS API Access</h2>
          <p style="color: #94a3b8; font-size: 14px; line-height: 1.6; margin-bottom: 24px;">
            To stream live market feeds and option chain data, click the button below to authorize AMEX-OS on FYERS.
          </p>
          <a href="/auth/fyers" style="display: inline-block; background: #2563eb; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: bold; font-size: 15px;">
            ⚡ Authorize FYERS Now →
          </a>
          <div style="margin-top: 24px;">
            <a href="/" style="color: #64748b; text-decoration: none; font-size: 13px;">← Return to AMEX-OS Dashboard</a>
          </div>
        </div>
      </body>
      </html>
    `);
  }

  const appId = marketState.fyersConfig.app_id || process.env.FYERS_APP_ID || "2YUVRX36LG-100";
  const secretKey = marketState.fyersConfig.secret_key || process.env.FYERS_SECRET_KEY || "XPAUO64UAG";

  if (!appId || !secretKey) {
    return res.status(400).send(`
      <!DOCTYPE html>
      <html>
      <head><title>FYERS Config Error</title></head>
      <body style="font-family: sans-serif; background: #0f172a; color: #f87171; text-align: center; padding: 50px;">
        <h2>❌ Missing FYERS App ID or Secret Key</h2>
        <p>Please configure App ID and Secret Key in server configuration.</p>
        <a href="/" style="color: #38bdf8; text-decoration: none;">← Back to AMEX-OS Dashboard</a>
      </body>
      </html>
    `);
  }

  try {
    console.log(`[FyersAuth] 🔄 Exchanging auth_code (${authCode.slice(0, 10)}...) for access_token...`);
    const data = await exchangeFyersAuthCode(appId, secretKey, authCode);

    if (data.s !== "ok" || !data.access_token) {
      throw new Error(data.message || data.errmsg || "Token exchange failed: " + JSON.stringify(data));
    }

    const accessToken = data.access_token;
    marketState.fyersConfig.access_token = accessToken;
    marketState.fyersAuthorized = true;
    marketState.isSimulating = false;
    marketState.lastFyersError = "";

    // Save to fyers_config.json
    try {
      const configPath = path.join(process.cwd(), "fyers_config.json");
      const currentConfig = {
        app_id: appId,
        secret_key: secretKey,
        redirect_uri: marketState.fyersConfig.redirect_uri || "http://127.0.0.1:3000/callback",
        access_token: accessToken,
        updated_at: new Date().toISOString()
      };
      fs.writeFileSync(configPath, JSON.stringify(currentConfig, null, 2), "utf8");
      console.log("[FyersAuth] ✅ fyers_config.json updated with new access token");
    } catch (e: any) {
      console.error("[FyersAuth] Failed to write fyers_config.json:", e.message);
    }

    // Start WebSocket & Option Chain fetch
    if (io) {
      startFyersSocket(accessToken, io);
    }
    fetchInitialChainsSequentially().catch(console.error);

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>AMEX-OS - FYERS Connected</title>
        <meta http-equiv="refresh" content="2;url=/" />
      </head>
      <body style="font-family: sans-serif; background: #090d16; color: #10b981; text-align: center; padding: 80px 20px;">
        <div style="max-width: 500px; margin: 0 auto; background: #131b2e; padding: 40px; border-radius: 12px; border: 1px solid #1e293b; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
          <div style="font-size: 48px; margin-bottom: 20px;">✅</div>
          <h2 style="color: #38bdf8; margin-bottom: 10px;">FYERS Authorized Successfully!</h2>
          <p style="color: #94a3b8; font-size: 14px; line-height: 1.6;">
            Access token generated & active.<br>
            WebSocket feed & option chain streaming starting...
          </p>
          <div style="margin-top: 30px;">
            <a href="/" style="display: inline-block; background: #3b82f6; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 600;">
              Go to Dashboard Now →
            </a>
          </div>
        </div>
      </body>
      </html>
    `);
  } catch (err: any) {
    console.error("[FyersAuth] ❌ Token exchange error:", err.message);
    marketState.lastFyersError = err.message;
    marketState.fyersAuthorized = false;
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head><title>AMEX-OS - Token Exchange Error</title></head>
      <body style="font-family: sans-serif; background: #0f172a; color: #ef4444; text-align: center; padding: 50px;">
        <h2>❌ Token Exchange Error</h2>
        <p style="color: #cbd5e1;">${err.message}</p>
        <div style="margin-top: 20px;">
          <a href="/auth/fyers" style="display: inline-block; background: #2563eb; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; margin-right: 10px;">Retry Authorization</a>
          <a href="/" style="color: #38bdf8; text-decoration: none;">Back to Dashboard</a>
        </div>
      </body>
      </html>
    `);
  }
}

router.get("/callback", (req, res) => handleFyersCallback(req, res));
router.get("/api/fyers/callback", (req, res) => handleFyersCallback(req, res));

export default router;
