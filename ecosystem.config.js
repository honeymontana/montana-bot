module.exports = {
  apps: [
    {
      name: 'montana-bot-dev',
      script: './dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'development',
        PORT: 3000
      },
      error_file: './logs/pm2-dev-error.log',
      out_file: './logs/pm2-dev-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      listen_timeout: 3000,
      kill_timeout: 5000
    },
    {
      name: 'montana-bot-staging',
      script: './dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'staging',
        PORT: 3001
      },
      error_file: './logs/pm2-staging-error.log',
      out_file: './logs/pm2-staging-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      listen_timeout: 3000,
      kill_timeout: 5000
    },
    {
      name: 'montana-bot-prod',
      script: './dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3002
      },
      error_file: './logs/pm2-prod-error.log',
      out_file: './logs/pm2-prod-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      listen_timeout: 3000,
      kill_timeout: 5000,
      // Production-specific settings
      node_args: '--max-old-space-size=2048'
    }
  ]
};
