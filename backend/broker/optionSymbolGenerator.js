function getOptionSymbol(orderData) {

    const {
        instrument,
        strike,
        optionType,
        expiry
    } = orderData;

    if (!instrument || !strike || !optionType || !expiry) {

        throw new Error("Missing option data");

    }

    return `NSE:${instrument}${expiry}${strike}${optionType}`;

}

module.exports = {
    getOptionSymbol
};