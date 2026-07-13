module.exports = {
  apps: [{
    name: "tradingbot",
    script: "./dist/server.cjs",
    cwd: __dirname,
    watch: false,
    autorestart: true,
    max_restarts: 10,
    restart_delay: 5000,
    env: {
      NODE_ENV: "production",
      PORT: 3000
    }
  }]
};
