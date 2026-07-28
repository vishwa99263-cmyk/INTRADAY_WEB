const { fyersModel } = require("fyers-api-v3");

const { getBrokerSwitch } = require("./brokerState");
const { checkRisk } = require("./riskManager");

const fyers = new fyersModel();

fyers.setAppId(process.env.FYERS_APP_ID);


async function executeFyersOrder(orderData) {
const risk = checkRisk(orderData);

if (!risk.allowed) {

    return {
        success: false,
        message: risk.reason
    };

}

    const instrument = orderData.instrument;

    const isLiveEnabled = getBrokerSwitch(instrument);


    if (!isLiveEnabled) {

        console.log("⚠️ FYERS LIVE OFF - Paper Trade Only");

        return {
            success: true,
            broker: "FYERS",
            live: false,
            message: "Live switch OFF. Paper trade saved.",
            order: orderData
        };

    }


    fyers.setAccessToken(process.env.FYERS_ACCESS_TOKEN);


    console.log("🔥 FYERS LIVE ORDER ENABLED");

    console.log(orderData);


    // अभी real order नहीं भेजेंगे
    // पहले validation और risk manager जोड़ेंगे


    return {
        success: true,
        broker: "FYERS",
        live: true,
        simulated: true,
        message: "Live switch ON but execution pending",
        order: orderData
    };

}


module.exports = {
    executeFyersOrder
};