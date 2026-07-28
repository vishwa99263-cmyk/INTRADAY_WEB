const { executeFyersOrder } = require("../broker/fyersOrderBridge");

exports.placeOrder = async (req, res) => {

    try {

        const orderData = {
            instrument: "NIFTY",
            action: "BUY",
            optionType: "CE",
            quantity: 75,
            strategy: "TEST"
        };

        const result = await executeFyersOrder(orderData);

        res.json(result);

    } catch (err) {

        console.log(err);

        res.status(500).json({
            success: false,
            error: err.message
        });

    }

};