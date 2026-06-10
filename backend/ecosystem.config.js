module.exports = {
  apps: [
    {
      name: 'postly-api',
      script: 'src/processes/api.js',
      exec_mode: 'cluster',
      instances: process.env.CLUSTER_WORKERS || 4,
      wait_ready: true,
      listen_timeout: 10000,
      kill_timeout: 30000,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 4000,
      watch: process.env.NODE_ENV !== 'production'
    },
    {
      name: 'postly-worker',
      script: 'src/processes/worker.js',
      exec_mode: 'fork',
      instances: 1,
      kill_timeout: 30000,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 4000,
      watch: process.env.NODE_ENV !== 'production'
    },
    {
      name: 'postly-bot',
      script: 'src/processes/bot.js',
      exec_mode: 'fork',
      instances: 1,
      kill_timeout: 30000,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 4000,
      watch: process.env.NODE_ENV !== 'production'
    }
  ]
};
