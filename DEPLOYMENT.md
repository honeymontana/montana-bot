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
