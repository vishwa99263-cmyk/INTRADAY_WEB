const express = require("express");
const { fyersModel } = require("fyers-api-v3");

const router = express.Router();

const fyers = new fyersModel();
fyers.setAppId(process.env.FYERS_APP_ID);

// Login
router.get("/login", (req, res) => {

    const loginUrl =
        `https://api-t1.fyers.in/api/v3/generate-authcode?` +
        `client_id=${process.env.FYERS_APP_ID}` +
        `&redirect_uri=${encodeURIComponent(process.env.FYERS_REDIRECT_URI)}` +
        `&response_type=code` +
        `&state=amex`;

    res.redirect(loginUrl);

});

// Callback
router.get("/callback", async (req, res) => {

    const auth_code = req.query.auth_code;

    if (!auth_code) {
        return res.send("Auth code missing");
    }

    try {

        const response = await fyers.generate_access_token({
            client_id: process.env.FYERS_APP_ID,
            secret_key: process.env.FYERS_SECRET_KEY,
            auth_code: auth_code
        });

        console.log(response);
        res.json(response);

    } catch (error) {

        console.log(error);
        res.send(error);

    }

});

module.exports = router;