# Деплой Montana Bot на сервер

## Проблема: Только один экземпляр бота может работать одновременно

Telegram Bot API не позволяет нескольким экземплярам получать обновления одновременно.

## Решение 1: Два разных бота (Рекомендуется)

### Dev бот (локально):
```bash
# В @BotFather создай второй бот: /newbot
# Назови его Montana Helper Dev Bot

# В .env укажи DEV токен:
BOT_TOKEN=<dev_bot_token>
MAIN_GROUP_ID=<тестовая группа>

# Запускай локально:
npm run dev
```

### Production бот (на сервере):
```bash
# Используй основной токен
BOT_TOKEN=<production_token>
MAIN_GROUP_ID=<основная Montana группа>

# Запускай через Docker:
docker-compose up -d
```

**Плюсы:**
- ✅ Безопасно тестировать изменения
- ✅ Не трогаешь production данные
- ✅ Можно разрабатывать не останавливая production

---

## Решение 2: Webhook на сервере (для одного бота)

Если хочешь использовать один токен:

### На сервере (webhook):

1. **Измени docker-compose.yml:**
```yaml
services:
  bot:
    environment:
      - USE_WEBHOOK=true
      - WEBHOOK_DOMAIN=https://your-domain.com
      - WEBHOOK_PATH=/webhook
      - PORT=3000
```

2. **Добавь Nginx/Caddy для HTTPS:**
```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location /webhook {
        proxy_pass http://localhost:3000/webhook;
    }
}
```

3. **Установи webhook:**
```bash
curl -F "url=https://your-domain.com/webhook" \
     https://api.telegram.org/bot<TOKEN>/setWebhook
```

### Локально (polling):

```bash
# Перед запуском локально - удали webhook:
curl https://api.telegram.org/bot<TOKEN>/deleteWebhook

# Запускай локально:
npm run dev

# После окончания работы - верни webhook:
curl -F "url=https://your-domain.com/webhook" \
     https://api.telegram.org/bot<TOKEN>/setWebhook
```

**Минусы:**
- ❌ Нужно помнить переключать webhook
- ❌ Может сломать production если забыл

---

## Решение 3: Только production (самое простое)

Разрабатывай на сервере через SSH:

```bash
# Подключись к серверу:
ssh user@your-server

# Останови production:
docker-compose down

# Запусти в dev режиме:
npm run dev

# Тестируй изменения...

# Останови dev:
Ctrl+C

# Запусти production:
docker-compose up -d
```

---

## Рекомендация

**Используй Решение 1 (два бота)** - это стандартная практика:

```bash
# Создай .env.local для разработки
cat > .env.local << 'EOF'
BOT_TOKEN=<dev_bot_token>
DB_HOST=localhost
DB_NAME=montana_bot_dev
MAIN_GROUP_ID=<тестовая группа>
TEST_MODE=true
DISCORD_ENABLED=false
EOF

# Создай .env.production для сервера
cat > .env.production << 'EOF'
BOT_TOKEN=<production_token>
DB_HOST=postgres
DB_NAME=montana_bot
MAIN_GROUP_ID=-1002467355671
TEST_MODE=false
DISCORD_ENABLED=true
EOF

# Локально:
cp .env.local .env
npm run dev

# На сервере:
cp .env.production .env
docker-compose up -d
```

## Проверка текущего режима бота

```bash
# Проверь какой бот запущен:
curl https://api.telegram.org/bot<TOKEN>/getWebhookInfo

# Если url пустой - работает polling (локально)
# Если url заполнен - работает webhook (на сервере)
```

## Безопасный деплой на production

```bash
# 1. Закоммить изменения
git add .
git commit -m "Your changes"
git push

# 2. На сервере:
ssh user@server
cd /path/to/montana-tg-bot
git pull
docker-compose down
docker-compose build
docker-compose up -d

# 3. Проверь логи:
docker-compose logs -f bot
```

---

## PM2 Deployment (Recommended for Production)

PM2 обеспечивает автоматический рестарт при падении, сбор логов, мониторинг и zero-downtime deploys.

### Установка и настройка

PM2 уже установлен как dev dependency. Все настройки в `ecosystem.config.js`.

### Быстрый деплой

```bash
# Development
./deploy.sh dev

# Staging
./deploy.sh staging

# Production
./deploy.sh prod
```

Скрипт `deploy.sh` автоматически:
- Останавливает текущий инстанс
- Устанавливает зависимости
- Запускает миграции БД
- Билдит TypeScript
- Запускает тесты (для staging/prod)
- Стартует бота через PM2

### Ручное управление PM2

```bash
# Запуск
npm run pm2:dev        # Разработка
npm run pm2:staging    # Staging
npm run pm2:prod       # Production

# Остановка
npm run pm2:stop:dev
npm run pm2:stop:staging
npm run pm2:stop:prod

# Рестарт
npm run pm2:restart:dev
npm run pm2:restart:staging
npm run pm2:restart:prod

# Логи
npm run pm2:logs:dev
npm run pm2:logs:staging
npm run pm2:logs:prod

# Мониторинг
npm run pm2:monit      # Real-time monitoring
npm run pm2:status     # Status overview
```

### Где хранятся логи

**PM2 логи (stdout/stderr):**
- Development: `./logs/pm2-dev-out.log`, `./logs/pm2-dev-error.log`
- Staging: `./logs/pm2-staging-out.log`, `./logs/pm2-staging-error.log`
- Production: `./logs/pm2-prod-out.log`, `./logs/pm2-prod-error.log`

**Winston логи (приложение):**
- Все ошибки: `./logs/error.log`
- Все логи: `./logs/combined.log`

### Автоматический рестарт при падении

PM2 настроен на:
- Автоматический рестарт при крашах
- Максимум 10 рестартов подряд
- Минимальное время работы: 10 секунд
- Рестарт при превышении памяти:
  - Dev/Staging: 500MB
  - Production: 1GB

### Анализ логов после падения

```bash
# Последние ошибки из PM2
npm run pm2:logs:prod | grep -i error

# Последние ошибки из Winston
tail -100 logs/error.log

# Полные логи за последний час
tail -1000 logs/combined.log

# Проверка когда был последний рестарт
npm run pm2:status
# Смотри колонку "uptime" - если маленькое значение, был рестарт
```

### Production deployment workflow

```bash
# 1. Убедись что все изменения закоммичены
git status

# 2. Запуш на GitHub
git add .
git commit -m "Add PM2 deployment setup"
git push

# 3. На production сервере
ssh user@server
cd /path/to/montana-tg-bot

# 4. Получи последние изменения
git pull

# 5. Задеплой
./deploy.sh prod

# 6. Проверь статус
npm run pm2:status
npm run pm2:logs:prod
```

### Troubleshooting

**Бот не стартует:**
```bash
# Проверь PM2 логи
npm run pm2:logs:prod

# Проверь есть ли .env файл
ls -la .env

# Проверь что БД доступна
npm run migration:run

# Попробуй запустить напрямую
npm run build
node dist/index.js
```

**Бот падает сразу после старта:**
```bash
# Смотри логи ошибок
cat logs/error.log
cat logs/pm2-prod-error.log

# Проверь переменные окружения
grep BOT_TOKEN .env
grep DB_HOST .env
```

**Слишком много рестартов:**
```bash
# Проверь количество рестартов
npm run pm2:status
# Смотри колонку "restart"

# Если > 5 рестартов - смотри error.log
cat logs/error.log | tail -200

# Останови, исправь проблему, запусти снова
npm run pm2:stop:prod
# ... fix issue ...
npm run pm2:prod
```

### Мониторинг в production

```bash
# Real-time CPU/Memory usage
npm run pm2:monit

# Проверка здоровья
curl http://localhost:3002/health

# Dashboard (если настроен)
open http://localhost:3002
```

