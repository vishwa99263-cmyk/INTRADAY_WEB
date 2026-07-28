// test_fyers_token.cjs - Test karo ki saved token valid hai ya nahi
const { fyersModel } = require("fyers-api-v3");
const fs = require("fs");

// Load saved config
const config = JSON.parse(fs.readFileSync("fyers_config.json", "utf8"));

console.log("App ID:", config.app_id);
console.log("Token saved at:", config.updated_at);
console.log("Testing token...\n");

const fyers = new fyersModel({ enableLogging: false });
fyers.setAppId(config.app_id);
fyers.setRedirectUrl(config.redirect_uri || "http://127.0.0.1:3000");
fyers.setAccessToken(config.access_token);

// Test 1: Profile
fyers.get_profile().then((res) => {
  if (res.s === "ok") {
    console.log("✅ TOKEN VALID!");
    console.log("Name:", res.data?.name);
    console.log("Fyers ID:", res.data?.fy_id);
    console.log("Email:", res.data?.email_id);
  } else {
    console.log("❌ TOKEN INVALID:", res.message || res);
  }
}).catch((err) => {
  console.log("❌ ERROR:", err.message || err);
});

// Test 2: Funds (balance)
fyers.get_funds().then((res) => {
  if (res.s === "ok") {
    const funds = res.fund_limit || [];
    const available = funds.find(f => f.title?.toLowerCase().includes("available"));
    const total = funds.find(f => f.title?.toLowerCase().includes("total"));
    console.log("\n✅ FUNDS:");
    console.log("Available:", available?.equityAmount ?? "N/A");
    console.log("Total Balance:", total?.equityAmount ?? "N/A");
    // Print all
    funds.forEach(f => console.log(` ${f.title}: ₹${f.equityAmount}`));
  } else {
    console.log("\n❌ FUNDS FAILED:", res.message || res);
  }
}).catch((err) => {
  console.log("\n❌ FUNDS ERROR:", err.message || err);
});
