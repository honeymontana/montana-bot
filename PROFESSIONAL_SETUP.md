# Профессиональная разработка Telegram ботов

## Типичная архитектура production ботов

### 1. Три окружения

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│   Development   │      │     Staging     │      │   Production    │
│   (Локально)    │  →   │   (Тестовый)    │  →   │   (Продакшн)    │
├─────────────────┤      ├─────────────────┤      ├─────────────────┤
│ Dev Bot Token   │      │ Staging Token   │      │ Prod Token      │
│ localhost:5432  │      │ staging-db      │      │ prod-db         │
│ test_user       │      │ beta testers    │      │ real users      │
└─────────────────┘      └─────────────────┘      └─────────────────┘
```

### Настройка:

```bash
# .env.development
BOT_TOKEN=<dev_bot>
DB_HOST=localhost
LOG_LEVEL=debug
TEST_MODE=true

# .env.staging
BOT_TOKEN=<staging_bot>
DB_HOST=staging-postgres.internal
LOG_LEVEL=info
TEST_MODE=false

# .env.production
BOT_TOKEN=<prod_bot>
DB_HOST=prod-postgres.internal
LOG_LEVEL=warn
TEST_MODE=false
```

---

## 2. CI/CD Pipeline (GitHub Actions / GitLab CI)

Автоматизация деплоя:

```yaml
# .github/workflows/deploy.yml
name: Deploy Bot

on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run tests
        run: npm test

  deploy-staging:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - name: Deploy to staging
        run: |
          ssh staging-server "cd /app && git pull && docker-compose up -d"

  deploy-production:
    needs: deploy-staging
    runs-on: ubuntu-latest
    environment: production
    steps:
      - name: Deploy to production
        run: |
          ssh prod-server "cd /app && git pull && docker-compose up -d"
```

**Workflow:**
```
1. git push → GitHub
2. Авто-тесты запускаются
3. Деплой на staging
4. Ручная проверка
5. Approve → деплой на production
```

---

## 3. Мониторинг и Логирование

### Sentry для ошибок:

```typescript
import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: "https://your-sentry-dsn",
  environment: process.env.NODE_ENV
});

// В коде:
try {
  await bot.sendMessage(chatId, message);
} catch (error) {
  Sentry.captureException(error);
  log.error('Failed to send message', error);
}
```

### Prometheus + Grafana для метрик:

```typescript
import { Counter, Histogram } from 'prom-client';

const messagesProcessed = new Counter({
  name: 'bot_messages_processed_total',
  help: 'Total messages processed'
});

const responseTime = new Histogram({
  name: 'bot_response_time_seconds',
  help: 'Response time in seconds'
});
```

### ELK Stack (Elasticsearch, Logstash, Kibana):

Централизованные логи со всех серверов.

---

## 4. База данных

### Миграции (уже есть в проекте):

```bash
# Создание миграции:
npm run migration:create add_new_field

# Применение:
npm run migration:run

# Откат:
npm run migration:rollback
```

### Бэкапы:

```bash
# Автоматический бэкап каждую ночь
0 2 * * * pg_dump -U postgres montana_bot > /backups/db_$(date +\%Y\%m\%d).sql
```

### Реплики для масштабирования:

```
┌─────────────┐
│ Primary DB  │ ← Запись
└──────┬──────┘
       │
   ┌───┴────┬──────────┐
   │        │          │
┌──▼──┐ ┌──▼──┐   ┌───▼──┐
│Rep 1│ │Rep 2│   │Rep 3 │ ← Чтение
└─────┘ └─────┘   └──────┘
```

---

## 5. Webhook вместо Polling (для production)

**Polling (разработка):**
- Бот сам спрашивает "есть новые сообщения?"
- Проще, но медленнее

**Webhook (production):**
- Telegram сам отправляет сообщения боту
- Быстрее, масштабируемее

```typescript
// Webhook setup
if (process.env.USE_WEBHOOK === 'true') {
  const app = express();
  app.use(express.json());

  app.post('/webhook', (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  });

  app.listen(3000);

  // Set webhook
  await bot.setWebHook(`https://your-domain.com/webhook`);
} else {
  // Polling для локальной разработки
  bot.startPolling();
}
```

---

## 6. Горизонтальное масштабирование

Для больших ботов (>1M пользователей):

```
                ┌────────────┐
Telegram ──────►│   Nginx    │
                └──────┬─────┘
                       │
        ┌──────────────┼──────────────┐
        │              │              │
   ┌────▼───┐     ┌───▼────┐    ┌───▼────┐
   │ Bot #1 │     │ Bot #2 │    │ Bot #3 │
   └────┬───┘     └────┬───┘    └────┬───┘
        │              │              │
        └──────────────┼──────────────┘
                       │
                  ┌────▼─────┐
                  │ Database │
                  └──────────┘
```

### Redis для синхронизации состояния:

```typescript
import Redis from 'ioredis';

const redis = new Redis();

// Сохранение состояния диалога
await redis.set(`user:${userId}:state`, 'waiting_for_name', 'EX', 3600);

// Получение
const state = await redis.get(`user:${userId}:state`);
```

---

## 7. Rate Limiting и Queue

### Bull Queue для обработки задач:

```typescript
import Queue from 'bull';

const messageQueue = new Queue('messages', {
  redis: { host: 'localhost', port: 6379 }
});

// Добавление в очередь
await messageQueue.add({ userId, message }, {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 }
});

// Обработка
messageQueue.process(async (job) => {
  const { userId, message } = job.data;
  await bot.sendMessage(userId, message);
});
```

### Rate Limiter:

```typescript
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 минута
  max: 30, // 30 запросов
  message: 'Слишком много запросов, попробуйте позже'
});

app.use('/webhook', limiter);
```

---

## 8. Тестирование

### Unit тесты:

```typescript
// __tests__/bot.test.ts
describe('MontanaBot', () => {
  it('should approve member from main group', async () => {
    const bot = new MontanaBot();
    const result = await bot.handleJoinRequest(mockRequest);
    expect(result).toBe('approved');
  });
});
```

### Integration тесты:

```typescript
describe('Discord Integration', () => {
  it('should sync roles after linking', async () => {
    await linkDiscordAccount(telegramId, discordId);
    const roles = await getDiscordRoles(discordId);
    expect(roles).toContain('Montana Member');
  });
});
```

### E2E тесты с Telegram Test Server:

```bash
# Telegram предоставляет тестовый сервер
BOT_TOKEN=<test_token> \
API_URL=https://api.telegram.org/test \
npm test
```

---

## 9. Feature Flags

Для постепенного раската фич:

```typescript
const featureFlags = {
  discordIntegration: process.env.FEATURE_DISCORD === 'true',
  betaFeatures: process.env.FEATURE_BETA === 'true'
};

if (featureFlags.discordIntegration) {
  await initializeDiscord();
}
```

Или используй LaunchDarkly / Unleash.

---

## 10. Секреты и конфиги

### Никогда не коммить `.env`!

```bash
# В git только .env.example:
BOT_TOKEN=your_token_here
DB_PASSWORD=your_password_here
```

### На продакшне использовать:

**AWS Secrets Manager / HashiCorp Vault:**
```typescript
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

const client = new SecretsManagerClient({ region: "us-east-1" });
const secret = await client.getSecretValue({ SecretId: "bot-token" });
const BOT_TOKEN = JSON.parse(secret.SecretString).token;
```

**Kubernetes Secrets:**
```yaml
apiVersion: v1
kind: Secret
metadata:
  name: bot-secrets
data:
  bot-token: <base64_encoded_token>
```

---

## 11. Мониторинг здоровья

```typescript
// Health check endpoint
app.get('/health', (req, res) => {
  const health = {
    uptime: process.uptime(),
    database: dbPool.totalCount > 0,
    discord: discordService?.isReady() || false,
    timestamp: Date.now()
  };

  res.json(health);
});

// Readiness check
app.get('/ready', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.status(200).send('OK');
  } catch (error) {
    res.status(503).send('Not ready');
  }
});
```

---

## Итоговая архитектура production бота

```
┌───────────────────────────────────────────────────┐
│                   CloudFlare                      │
│              (DDoS protection, CDN)               │
└────────────────────┬──────────────────────────────┘
                     │
┌────────────────────▼──────────────────────────────┐
│                  Nginx/Caddy                      │
│          (SSL, Load Balancing, Rate Limit)        │
└────────────────────┬──────────────────────────────┘
                     │
        ┌────────────┼────────────┐
        │            │            │
┌───────▼──────┐ ┌──▼────────┐ ┌─▼──────────┐
│  Bot Server  │ │  Bot      │ │  Bot       │
│      #1      │ │ Server #2 │ │ Server #3  │
│              │ │           │ │            │
│  Node.js +   │ │ Node.js + │ │ Node.js +  │
│  TypeScript  │ │TypeScript │ │ TypeScript │
└───────┬──────┘ └──┬────────┘ └─┬──────────┘
        │           │             │
        └───────────┼─────────────┘
                    │
        ┌───────────┼───────────┐
        │           │           │
┌───────▼──────┐ ┌─▼────────┐ ┌▼───────────┐
│  PostgreSQL  │ │  Redis   │ │  S3/Minio  │
│  (Primary +  │ │  (Cache, │ │  (Files,   │
│   Replicas)  │ │  Queue)  │ │   Media)   │
└──────────────┘ └──────────┘ └────────────┘
        │
┌───────▼──────────────────────────────┐
│        Monitoring Stack              │
│  • Prometheus + Grafana (Metrics)    │
│  • ELK Stack (Logs)                  │
│  • Sentry (Errors)                   │
│  • UptimeRobot (Uptime monitoring)   │
└──────────────────────────────────────┘
```

---

## Полезные инструменты

**Разработка:**
- **Nodemon/tsx** - hot reload
- **Prettier/ESLint** - форматирование кода
- **Husky** - git hooks для проверки перед коммитом

**Деплой:**
- **Docker + Docker Compose** - контейнеризация
- **Kubernetes** - оркестрация (для больших проектов)
- **Terraform** - Infrastructure as Code

**Мониторинг:**
- **Grafana** - дашборды
- **Sentry** - отслеживание ошибок
- **New Relic / DataDog** - APM

**Базы данных:**
- **PostgreSQL** - основная БД
- **Redis** - кеш, очереди, сессии
- **ClickHouse** - аналитика (для больших объемов)

---

## Чеклист профессионального бота

✅ Три окружения (dev, staging, prod)
✅ Автоматические тесты (unit, integration, e2e)
✅ CI/CD pipeline
✅ Миграции БД с версионированием
✅ Централизованное логирование
✅ Мониторинг метрик и ошибок
✅ Бэкапы БД (автоматические + тестируемые)
✅ Health checks
✅ Rate limiting
✅ Queue для фоновых задач
✅ Feature flags
✅ Безопасное хранение секретов
✅ Документация API
✅ Rollback план
✅ Алерты в Slack/Telegram при проблемах

---

## Ресурсы для изучения

**Книги:**
- "Designing Data-Intensive Applications" - Martin Kleppmann
- "Site Reliability Engineering" - Google

**Курсы:**
- AWS/GCP/Azure certification courses
- Kubernetes for Developers

**Блоги:**
- https://t.me/bots - официальный канал Telegram
- https://core.telegram.org/bots/api - API документация
