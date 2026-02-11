// PM2 ecosystem config — alternative to Docker
// Install PM2: npm install -g pm2
// Start: pm2 start ecosystem.config.js
// Logs:  pm2 logs pokeflix
// Stop:  pm2 stop pokeflix
module.exports = {
  apps: [
    {
      name: 'pokeflix',
      script: 'addon.js',
      env: {
        NODE_ENV: 'production',
        PORT: 7515,
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      // Restart if it crashes, with exponential backoff
      exp_backoff_restart_delay: 100,
    },
  ],
};
