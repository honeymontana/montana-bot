/**
 * Точка входа для запуска дашборда
 */

import dotenv from 'dotenv';
import { startDashboardServer } from './api/DashboardAPI';
import { query as dbQuery, closeDatabase } from './database/connection';

// Wrapper для совместимости
const db = {
  query: dbQuery,
  end: closeDatabase
};

// Загружаем переменные окружения
dotenv.config();

async function main() {
  console.log('🚀 Запуск Montana Bot Dashboard...\n');

  // Проверяем подключение к базе данных
  try {
    await db.query('SELECT NOW()');
    console.log('✅ База данных подключена');
  } catch (error) {
    console.error('❌ Ошибка подключения к базе данных:', error);
    process.exit(1);
  }

  // Запускаем веб-сервер
  const port = parseInt(process.env.DASHBOARD_PORT || '3000');
  startDashboardServer(port);
}

// Запускаем приложение
main().catch(error => {
  console.error('❌ Критическая ошибка:', error);
  process.exit(1);
});

// Обработка завершения
process.on('SIGINT', async () => {
  console.log('\n👋 Завершение работы дашборда...');
  await db.end();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n👋 Завершение работы дашборда...');
  await db.end();
  process.exit(0);
});
