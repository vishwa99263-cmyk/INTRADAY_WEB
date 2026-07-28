const brokerState = {

    NIFTY: false,

    BANKNIFTY: false,

    SENSEX: false

};


function setBrokerSwitch(index, status) {

    brokerState[index] = status;

}


function getBrokerSwitch(index) {

    return brokerState[index];

}


module.exports = {
    brokerState,
    setBrokerSwitch,
    getBrokerSwitch
};