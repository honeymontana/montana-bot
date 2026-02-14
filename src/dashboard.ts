/**
 * Точка входа для запуска дашборда
 */

import dotenv from 'dotenv';
import { startDashboardServer } from './api/DashboardAPI';
import { query as dbQuery, closeDatabase } from './database/connection';
import { log } from './utils/logger';

// Wrapper для совместимости
const db = {
  query: dbQuery,
  end: closeDatabase,
};

// Загружаем переменные окружения
dotenv.config();

async function main() {
  log.info('Starting Montana Bot Dashboard...');

  // Проверяем подключение к базе данных
  try {
    await db.query('SELECT NOW()');
    log.info('Database connection established successfully');
  } catch (error) {
    log.error('Failed to connect to database', error);
    process.exit(1);
  }

  // Запускаем веб-сервер
  const port = parseInt(process.env.DASHBOARD_PORT || '3000');
  startDashboardServer(port);
}

// Запускаем приложение
main().catch((error) => {
  log.error('Critical error during dashboard startup', error);
  process.exit(1);
});

// Обработка завершения
process.on('SIGINT', async () => {
  log.info('Received SIGINT signal, shutting down dashboard gracefully...');
  await db.end();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  log.info('Received SIGTERM signal, shutting down dashboard gracefully...');
  await db.end();
  process.exit(0);
});
