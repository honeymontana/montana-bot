import { MontanaBot } from './bot/MontanaBot';
import { closeDatabase } from './database/connection';
import { log } from './utils/logger';
import * as fs from 'fs';
import * as path from 'path';

// Ensure logs directory exists
const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

let bot: MontanaBot | null = null;

async function startBot(): Promise<void> {
  try {
    log.info('Starting Montana Helper Bot...');

    bot = new MontanaBot();
    await bot.start();

    log.info('Bot is running');
  } catch (error) {
    log.error('Failed to start bot', error);
    process.exit(1);
  }
}

async function gracefulShutdown(signal: string): Promise<void> {
  log.info(`Received ${signal}, starting graceful shutdown...`);

  try {
    // Stop the bot
    if (bot) {
      await bot.stop();
    }

    // Close database connection
    await closeDatabase();

    log.info('Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    log.error('Error during graceful shutdown', error);
    process.exit(1);
  }
}

// Handle process signals
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  log.error('Uncaught exception', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  log.error('Unhandled rejection', { reason, promise });
  process.exit(1);
});

// Start the bot
startBot().catch((error) => {
  log.error('Failed to start bot', error);
  process.exit(1);
});