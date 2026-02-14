/**
 * API для веб-дашборда управления ботом
 */

import express, { Request, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import cors from 'cors';
import { query as dbQuery } from '../database/connection';
import { tributeService } from '../services/TributeService';
import { performHealthCheck, checkReadiness, checkLiveness } from '../utils/healthCheck';
import { errorHandler, RateLimitError } from '../utils/errors';
import { log } from '../utils/logger';
import path from 'path';

// Wrapper для совместимости
const db = {
  query: dbQuery,
  end: async () => {},
};

const router = express.Router();

/**
 * Rate limiting configuration
 */
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: (req, res) => {
    const error = new RateLimitError('Too many requests, please try again later', 900);
    res.status(429).json({
      error: error.message,
      statusCode: error.statusCode,
      retryAfter: error.retryAfter,
    });
  },
});

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10, // Stricter limit for sensitive operations
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    const error = new RateLimitError('Too many requests, please try again later', 900);
    res.status(429).json({
      error: error.message,
      statusCode: error.statusCode,
      retryAfter: error.retryAfter,
    });
  },
});

/**
 * Middleware для проверки авторизации
 * Security: Only accepts API key via header (not query params)
 * Security: No fallback - DASHBOARD_API_KEY must be set in environment
 */
const authenticate = (req: Request, res: Response, next: Function) => {
  const apiKey = req.headers['x-api-key'] as string | undefined;
  const validApiKey = process.env.DASHBOARD_API_KEY;

  if (!validApiKey) {
    log.error('DASHBOARD_API_KEY environment variable is not set');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  // Optional: IP whitelisting for production
  const allowedIPs = process.env.API_ALLOWED_IPS?.split(',') || [];
  if (process.env.NODE_ENV === 'production' && allowedIPs.length > 0) {
    const clientIP = req.ip || req.socket.remoteAddress || '';
    if (!allowedIPs.includes(clientIP)) {
      log.warn(`Unauthorized IP attempt: ${clientIP}`);
      return res.status(403).json({ error: 'Forbidden' });
    }
  }

  if (apiKey && apiKey === validApiKey) {
    return next();
  } else {
    log.warn(`Failed authentication attempt from ${req.ip}`);
    return res.status(401).json({ error: 'Unauthorized' });
  }
};

// =============================================================================
// HEALTH CHECKS (Kubernetes-compatible endpoints)
// =============================================================================

/**
 * GET /api/health
 * Comprehensive health check - returns detailed status
 */
router.get('/health', async (req: Request, res: Response) => {
  try {
    const health = await performHealthCheck();
    const statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 200 : 503;
    res.status(statusCode).json(health);
  } catch (error) {
    log.error('Health check failed', error);
    res.status(503).json({
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Health check failed',
    });
  }
});

/**
 * GET /api/ready
 * Readiness probe - is the service ready to accept traffic?
 */
router.get('/ready', async (req: Request, res: Response) => {
  try {
    const ready = await checkReadiness();
    if (ready) {
      res.status(200).json({ ready: true, message: 'Service is ready' });
    } else {
      res.status(503).json({ ready: false, message: 'Service is not ready' });
    }
  } catch (error) {
    log.error('Readiness check failed', error);
    res.status(503).json({ ready: false, error: 'Readiness check failed' });
  }
});

/**
 * GET /api/live
 * Liveness probe - is the service alive?
 */
router.get('/live', (req: Request, res: Response) => {
  const alive = checkLiveness();
  res.status(200).json({ alive, message: 'Service is alive' });
});

// =============================================================================
// АНАЛИТИКА И МЕТРИКИ
// =============================================================================

/**
 * GET /api/metrics/overview
 * Общая статистика по всем подпискам
 */
router.get('/metrics/overview', authenticate, async (req: Request, res: Response) => {
  try {
    const query = `SELECT * FROM current_subscription_metrics ORDER BY amount`;
    const result = await db.query(query);

    // Получаем общую статистику
    const totalQuery = `
      SELECT
        COUNT(DISTINCT user_id) as total_users,
        COUNT(DISTINCT user_id) FILTER (WHERE is_active = TRUE) as active_users,
        COUNT(DISTINCT user_id) FILTER (WHERE is_active = FALSE) as churned_users,
        AVG(total_renewals) as avg_renewals,
        SUM(lifetime_value) as total_revenue
      FROM user_subscription_stats
    `;
    const totalResult = await db.query(totalQuery);

    res.json({
      by_amount: result.rows,
      total: totalResult.rows[0],
    });
  } catch (error) {
    log.error('Error fetching overview:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/metrics/churn-history
 * История CHURN по датам
 */
router.get('/metrics/churn-history', authenticate, async (req: Request, res: Response) => {
  try {
    const { days = 30, amount } = req.query;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - Number(days));

    let query = `
      SELECT
        date,
        amount,
        total_users,
        active_users,
        churned_users,
        churn_rate
      FROM churn_metrics
      WHERE date >= $1
    `;
    const params: any[] = [startDate];

    if (amount) {
      query += ` AND amount = $2`;
      params.push(Number(amount));
    }

    query += ` ORDER BY date ASC, amount ASC`;

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (error) {
    log.error('Error fetching churn history:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/metrics/subscribers
 * Список всех подписчиков с детальной статистикой
 */
router.get('/metrics/subscribers', authenticate, async (req: Request, res: Response) => {
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
    const params: any[] = [];
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

    const result = await db.query(query, params);

    // Получаем общее количество для пагинации
    let countQuery = `SELECT COUNT(*) as total FROM user_subscription_stats WHERE 1=1`;
    const countParams: any[] = [];
    let countIndex = 1;

    if (amount) {
      countQuery += ` AND amount = $${countIndex++}`;
      countParams.push(Number(amount));
    }

    if (active !== undefined) {
      countQuery += ` AND is_active = $${countIndex++}`;
      countParams.push(active === 'true');
    }

    const countResult = await db.query(countQuery, countParams);

    res.json({
      subscribers: result.rows,
      total: Number(countResult.rows[0].total),
      limit: Number(limit),
      offset: Number(offset),
    });
  } catch (error) {
    log.error('Error fetching subscribers:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/metrics/revenue
 * Статистика по доходам
 */
router.get('/metrics/revenue', authenticate, async (req: Request, res: Response) => {
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

    const result = await db.query(query, [startDate]);
    res.json(result.rows);
  } catch (error) {
    log.error('Error fetching revenue:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// =============================================================================
// УПРАВЛЕНИЕ ГРУППАМИ
// =============================================================================

/**
 * GET /api/groups
 * Список всех групп
 */
router.get('/groups', authenticate, async (req: Request, res: Response) => {
  try {
    const query = `
      SELECT
        chat_id,
        chat_title,
        is_permanent,
        access_window_hours,
        is_enabled,
        created_at
      FROM managed_groups
      ORDER BY created_at DESC
    `;

    const result = await db.query(query);
    res.json(result.rows);
  } catch (error) {
    log.error('Error fetching groups:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/groups
 * Добавить новую группу
 */
router.post('/groups', strictLimiter, authenticate, async (req: Request, res: Response) => {
  try {
    const { chat_id, is_permanent = false, access_window_hours = 24 } = req.body;

    if (!chat_id) {
      return res.status(400).json({ error: 'chat_id is required' });
    }

    const query = `
      INSERT INTO managed_groups (chat_id, chat_title, is_permanent, access_window_hours)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (chat_id) DO UPDATE SET
        is_permanent = EXCLUDED.is_permanent,
        access_window_hours = EXCLUDED.access_window_hours,
        is_enabled = TRUE
      RETURNING *
    `;

    const result = await db.query(query, [
      chat_id,
      'Unknown Group',
      is_permanent,
      access_window_hours,
    ]);

    return res.json(result.rows[0]);
  } catch (error) {
    log.error('Error adding group:', error);
    return res.status(500).json({ error: 'Failed to add group' });
  }
});

/**
 * DELETE /api/groups/:chatId
 * Удалить группу
 */
router.delete(
  '/groups/:chatId',
  strictLimiter,
  authenticate,
  async (req: Request, res: Response) => {
    try {
      const { chatId } = req.params;

      const query = `
      UPDATE managed_groups
      SET is_enabled = FALSE
      WHERE chat_id = $1
      RETURNING *
    `;

      const result = await db.query(query, [chatId]);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Group not found' });
      }

      return res.json({ success: true, group: result.rows[0] });
    } catch (error) {
      log.error('Error deleting group:', error);
      return res.status(500).json({ error: 'Failed to delete group' });
    }
  }
);

// =============================================================================
// УПРАВЛЕНИЕ БОТОМ
// =============================================================================

/**
 * GET /api/bot/status
 * Статус бота
 */
router.get('/bot/status', authenticate, async (req: Request, res: Response) => {
  try {
    return res.json({
      bot: {
        status: 'running',
        uptime: process.uptime(),
        test_mode: process.env.TEST_MODE === 'true',
      },
    });
  } catch (error) {
    log.error('Error fetching bot status:', error);
    return res.status(500).json({ error: 'Failed to fetch bot status' });
  }
});

/**
 * POST /api/bot/sync
 * Запустить синхронизацию
 */
router.post('/bot/sync', strictLimiter, authenticate, async (req: Request, res: Response) => {
  try {
    const { type = 'basic' } = req.body;

    // Note: This endpoint is a stub. Use the bot commands directly for sync operations.
    return res.json({
      message: 'Sync feature not implemented in API. Use bot commands: /sync or /fullsync',
      type,
    });
  } catch (error) {
    log.error('Error running sync:', error);
    return res.status(500).json({ error: 'Sync failed' });
  }
});

/**
 * POST /api/import/tribute-export
 * Импортировать данные из экспорта Telegram
 */
router.post(
  '/import/tribute-export',
  strictLimiter,
  authenticate,
  async (req: Request, res: Response) => {
    try {
      const { file_path } = req.body;

      if (!file_path) {
        return res.status(400).json({ error: 'file_path is required' });
      }

      await tributeService.importFromTelegramExport(file_path);

      return res.json({ message: 'Import completed successfully' });
    } catch (error) {
      log.error('Error importing data:', error);
      return res.status(500).json({ error: 'Import failed' });
    }
  }
);

// =============================================================================
// WEBHOOK для Tribute
// =============================================================================

/**
 * POST /api/webhooks/tribute
 * Webhook для получения событий от Tribute
 */
router.post('/webhooks/tribute', async (req: Request, res: Response) => {
  try {
    const event = req.body;
    await tributeService.handleWebhookEvent(event);
    res.json({ success: true });
  } catch (error) {
    log.error('Error handling webhook:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

export const dashboardAPI = router;

/**
 * Запустить веб-сервер дашборда
 */
export function startDashboardServer(port: number = 3000) {
  const app = express();

  // Security: Helmet.js for security headers
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'https:'],
        },
      },
    })
  );

  // Security: Proper CORS configuration
  const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS?.split(',') || [
    'http://localhost:3000',
    'http://localhost:5173',
  ];

  app.use(
    cors({
      origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
        // Allow requests with no origin (like mobile apps or curl)
        if (!origin) return callback(null, true);

        if (allowedOrigins.includes(origin) || process.env.NODE_ENV === 'development') {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'X-API-Key'],
    })
  );

  // Middleware
  app.use(express.json({ limit: '10mb' })); // Limit request body size
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Apply rate limiting to all API routes
  app.use('/api', limiter);

  // API routes
  app.use('/api', dashboardAPI);

  // Статические файлы для фронтенда
  app.use(express.static(path.join(__dirname, '../../dashboard/dist')));

  // Все остальные запросы отправляем на index.html (для SPA)
  // Note: Express 5 doesn't support * as a route, using regex instead
  app.get(/^\/(?!api).*/, (req, res) => {
    res.sendFile(path.join(__dirname, '../../dashboard/dist/index.html'));
  });

  // Error handler middleware (must be last)
  app.use(errorHandler);

  app.listen(port, () => {
    log.info(`\n🚀 Dashboard server running on http://localhost:${port}`);
    log.info(`📊 API endpoints: http://localhost:${port}/api`);
    const apiKeySet = process.env.DASHBOARD_API_KEY ? '✓ SET' : '✗ NOT SET';
    log.info(`🔑 API Key: ${apiKeySet}`);
    log.info(`✅ Health checks: /api/health, /api/ready, /api/live`);
    log.info(`🛡️  Rate limiting: 100 requests per 15 minutes\n`);
  });

  return app;
}
