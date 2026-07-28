const riskConfig = {

    maxTradeValue: 50000,
    maxDailyLoss: 5000,
    cooldownSeconds: 30

};


function checkRisk(orderData) {


    if (!orderData.quantity || orderData.quantity <= 0) {

        return {
            allowed: false,
            reason: "Invalid quantity"
        };

    }


    if (!orderData.instrument) {

        return {
            allowed: false,
            reason: "Instrument missing"
        };

    }


    return {
        allowed: true,
        reason: "Risk check passed"
    };


}


module.exports = {
    checkRisk,
    riskConfig
};