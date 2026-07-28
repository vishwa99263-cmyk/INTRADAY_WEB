require("dotenv").config();
const express = require("express");
const { fyersModel } = require("fyers-api-v3");
const marketData = require("./live");
const orderRoutes = require("./routes/order");	
const authRoutes = require("./routes/auth");
const brokerRoutes = require("./routes/broker");

const app = express();

app.use(express.json());

const fyers = new fyersModel();

fyers.setAppId(process.env.FYERS_APP_ID);

app.get("/", (req, res) => {
    res.send("AMEX Backend Running Successfully 🚀");
});


// Market Data
app.get("/market", async (req, res) => {

    try {

        fyers.setAccessToken(process.env.FYERS_ACCESS_TOKEN);

        const data = await fyers.getQuotes([
            "NSE:NIFTY50-INDEX",
            "NSE:NIFTYBANK-INDEX",
            "BSE:SENSEX-INDEX"
        ]);

        res.json(data);

    } catch (error) {

        console.log(error);
        res.send(error);

    }

});


// Funds API
app.get("/funds", async (req, res) => {

    try {

        fyers.setAccessToken(process.env.FYERS_ACCESS_TOKEN);

        const data = await fyers.get_funds();

        res.json(data);

    } catch (error) {

        console.log(error);
        res.send(error);

    }

});


// Profile API
app.get("/profile", async (req, res) => {

    try {

        fyers.setAccessToken(process.env.FYERS_ACCESS_TOKEN);

        const data = await fyers.get_profile();

        res.json(data);

    } catch (error) {

        console.log(error);
        res.send(error);

    }

});


// Quote API
app.get("/quote", async (req, res) => {

    try {

        fyers.setAccessToken(process.env.FYERS_ACCESS_TOKEN);

        const data = await fyers.getQuotes([
            "NSE:NIFTY50-INDEX"
        ]);

        res.json(data);

    } catch (error) {

        console.log(error);
        res.send(error);

    }

});


// Live WebSocket Data API
app.get("/live", (req, res) => {
res.json(marketData);
});

app.use("/", authRoutes);
app.use("/", orderRoutes);
app.use("/", brokerRoutes);

app.listen(3000, () => {
    console.log("Server running on http://localhost:3000");
});