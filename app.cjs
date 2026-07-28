const { fyersModel } = require("fyers-api-v3");

const fyers = new fyersModel();

fyers.setAppId("2YUVRX36LG-100");

// Yahan baad me Access Token dalenge
fyers.setAccessToken("2YUVRX36LG-100:eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOlsieDowIl0sImF0X2hhc2giOiJnQUFBQUFCcVlRc2tXaTdJSXRiRm1kX3dXdXY5amt5UTRCemFKZkdaaks0bE85RUVZdDl0TE1HWTkwTHM5UUctYUZKSnNsVXNBb3dpT2dNY0VGZ083NGg0T01vQXh0SXVQV2k0VUNfS1o1WTJ5X2pBeVZ3LUpCMD0iLCJkaXNwbGF5X25hbWUiOiIiLCJvbXMiOiJLMSIsImhzbV9rZXkiOiJlODBlMzcyNjU2ZWJjMmZlNjA3MTk1ODcwZTIzYWI2MDdhYzM5MWY0YTlkYTMxMGMyYzhlMTA3OCIsImlzRGRwaUVuYWJsZWQiOiJOIiwiaXNNdGZFbmFibGVkIjoiTiIsImZ5X2lkIjoiRkFKOTc5MzEiLCJhcHBUeXBlIjoxMDAsImV4cCI6MTc4NDc2NjYwMCwiaWF0IjoxNzg0NzQ0NzQwLCJpc3MiOiJhcGkuZnllcnMuaW4iLCJuYmYiOjE3ODQ3NDQ3NDAsInN1YiI6ImFjY2Vzc190b2tlbiJ9.AQ3laaX0Y_j5yGqEK5oqlQ1HRVOLd63GGgCVIGVW6RQ");

fyers.get_profile()
.then((res) => {
    console.log("SUCCESS");
    console.log(res);
})
.catch((err) => {
    console.log("ERROR");
    console.log(err);
});