require("dotenv").config();

const { fyersModel, fyersDataSocket } = require("fyers-api-v3");

const marketData = {};


const accessToken = process.env.FYERS_APP_ID + ":" + process.env.FYERS_ACCESS_TOKEN;


const socket = fyersDataSocket.getInstance(accessToken);


socket.on("connect", () => {

    console.log("🔥 WebSocket Connected");

    socket.subscribe([
        "NSE:NIFTY50-INDEX",
        "NSE:NIFTYBANK-INDEX",
        "BSE:SENSEX-INDEX"
    ]);

    socket.mode(socket.LiteMode);

});


socket.on("message", (message) => {

    console.log("LIVE TICK:");
    console.log(message);


    if(message.symbol && message.ltp){

        marketData[message.symbol] = {
            ltp: message.ltp,
            time: message.exch_feed_time
        };

    }

});




socket.on("error", (error) => {

    console.log("ERROR:");
    console.log(error);

});


socket.on("close", () => {

    console.log("WebSocket Closed");

});


socket.connect();

module.exports = marketData;

