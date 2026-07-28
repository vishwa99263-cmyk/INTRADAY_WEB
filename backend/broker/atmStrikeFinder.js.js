function getATMStrike(spotPrice, instrument) {

    if (!spotPrice || !instrument) {
        throw new Error("Spot price or instrument missing");
    }

    let step = 50;

    switch (instrument) {
        case "NIFTY":
            step = 50;
            break;

        case "BANKNIFTY":
            step = 100;
            break;

        case "SENSEX":
            step = 100;
            break;
    }

    return Math.round(spotPrice / step) * step;
}

module.exports = {
    getATMStrike
};