/**
 * Standalone Dashboard Server
 * Простой веб-сервер для дашборда без сложных зависимостей
 */

const express = require('express');
const path = require('path');
const { Pool } = require('pg');

// Конфигурация
const PORT = process.env.DASHBOARD_PORT || 3000;
const API_KEY = process.env.DASHBOARD_API_KEY || 'montana-secret-key-2026';

// PostgreSQL
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'montana_bot',
  user: process.env.DB_USER || 'montana',
  password: process.env.DB_PASSWORD || 'montana_secure_password',
});

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, X-API-Key');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  next();
});

// Auth middleware
const authenticate = (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  if (apiKey === API_KEY) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
};

// =============================================================================
// API ENDPOINTS
// =============================================================================

// GET /api/metrics/overview
app.get('/api/metrics/overview', authenticate, async (req, res) => {
  try {
    const metricsQuery = `SELECT * FROM current_subscription_metrics ORDER BY product_type, amount`;
    const metricsResult = await pool.query(metricsQuery);

    const totalQuery = `
      SELECT
        COUNT(DISTINCT user_id) as total_users,
        COUNT(DISTINCT user_id) FILTER (WHERE is_active = TRUE) as active_users,
        COUNT(DISTINCT user_id) FILTER (WHERE is_active = FALSE) as churned_users,
        AVG(total_renewals) as avg_renewals,
        SUM(lifetime_value) as total_revenue
      FROM user_subscription_stats
    `;
    const totalResult = await pool.query(totalQuery);

    res.json({
      by_amount: metricsResult.rows,
      total: totalResult.rows[0]
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/metrics/churn-history
app.get('/api/metrics/churn-history', authenticate, async (req, res) => {
  try {
    const { days = 30, amount } = req.query;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - Number(days));

    // Упрощенный запрос для получения истории
    let query = `
      WITH daily_stats AS (
        SELECT
          DATE(event_date) as date,
          amount,
          COUNT(DISTINCT user_id) FILTER (WHERE event_type IN ('subscription.created', 'subscription.renewed')) as active,
          COUNT(DISTINCT user_id) FILTER (WHERE event_type = 'subscription.cancelled') as churned
        FROM subscription_events
        WHERE event_date >= $1
        GROUP BY DATE(event_date), amount
      )
      SELECT
        date,
        amount,
        active as active_users,
        churned as churned_users,
        active + churned as total_users,
        CASE
          WHEN (active + churned) > 0
          THEN (churned::float / (active + churned)) * 100
          ELSE 0
        END as churn_rate
      FROM daily_stats
    `;
    const params = [startDate];

    if (amount) {
      query += ` WHERE amount = $2`;
      params.push(Number(amount));
    }

    query += ` ORDER BY date ASC, amount ASC`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/metrics/subscribers
app.get('/api/metrics/subscribers', authenticate, async (req, res) => {
  try {
    const { amount, active, limit = 100, offset = 0 } = req.query;

    let query = `
      SELECT
        user_id,
        username,
        amount,
        total_subscriptions,
        total_renewals,
        is_active,
        first_subscription_date,
        last_activity_date,
        cancelled_at,
        lifetime_value
      FROM user_subscription_stats
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (amount) {
      query += ` AND amount = $${paramIndex++}`;
      params.push(Number(amount));
    }

    if (active !== undefined) {
      query += ` AND is_active = $${paramIndex++}`;
      params.push(active === 'true');
    }

    query += ` ORDER BY last_activity_date DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(Number(limit), Number(offset));

    const result = await pool.query(query, params);

    // Подсчёт общего количества
    let countQuery = `SELECT COUNT(*) as total FROM user_subscription_stats WHERE 1=1`;
    const countParams = [];
    let countIndex = 1;

    if (amount) {
      countQuery += ` AND amount = $${countIndex++}`;
      countParams.push(Number(amount));
    }

    if (active !== undefined) {
      countQuery += ` AND is_active = $${countIndex++}`;
      countParams.push(active === 'true');
    }

    const countResult = await pool.query(countQuery, countParams);

    res.json({
      subscribers: result.rows,
      total: Number(countResult.rows[0].total),
      limit: Number(limit),
      offset: Number(offset)
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/metrics/revenue
app.get('/api/metrics/revenue', authenticate, async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - Number(days));

    const query = `
      SELECT
        DATE(event_date) as date,
        amount,
        COUNT(*) FILTER (WHERE event_type IN ('subscription.created', 'subscription.renewed')) as transactions,
        SUM(amount) FILTER (WHERE event_type IN ('subscription.created', 'subscription.renewed')) as revenue
      FROM subscription_events
      WHERE event_date >= $1
        AND event_type IN ('subscription.created', 'subscription.renewed')
      GROUP BY DATE(event_date), amount
      ORDER BY date ASC, amount ASC
    `;

    const result = await pool.query(query, [startDate]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/bot/status
app.get('/api/bot/status', authenticate, async (req, res) => {
  try {
    res.json({
      bot: {
        username: 'montana_bot'
      },
      uptime: process.uptime(),
      status: 'online'
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Статические файлы
app.use(express.static(path.join(__dirname, 'dashboard/dist')));

// SPA fallback
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard/dist/index.html'));
});

// =============================================================================
// START SERVER
// =============================================================================

async function start() {
  try {
    // Проверка подключения к БД
    await pool.query('SELECT NOW()');
    console.log('✅ База данных подключена');

    app.listen(PORT, () => {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`🚀 Montana Bot Dashboard запущен!`);
      console.log(`${'='.repeat(80)}`);
      console.log(`\n📊 Дашборд:  http://localhost:${PORT}`);
      console.log(`🔌 API:       http://localhost:${PORT}/api`);
      console.log(`🔑 API Key:   ${API_KEY}\n`);
      console.log(`${'='.repeat(80)}\n`);
    });
  } catch (error) {
    console.error('❌ Ошибка запуска:', error);
    process.exit(1);
  }
}

start();

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n👋 Завершение работы...');
  await pool.end();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n👋 Завершение работы...');
  await pool.end();
  process.exit(0);
});
