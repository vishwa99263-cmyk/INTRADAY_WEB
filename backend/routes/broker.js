const express = require("express");

const router = express.Router();

const {
    setBrokerSwitch,
    brokerState
} = require("../broker/brokerState");


// Get Switch Status
router.get("/broker/status", (req,res)=>{

    res.json(brokerState);

});


// Update Switch
router.post("/broker/switch", (req,res)=>{

    const { index, status } = req.body;


    setBrokerSwitch(index, status);


    res.json({
        success:true,
        message:"Broker switch updated",
        brokerState
    });

});


module.exports = router;