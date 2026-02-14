# Montana Bot Dashboard - Руководство пользователя

## Обзор

Веб-дашборд для полного управления Montana Telegram ботом с аналитикой подписок, CHURN метриками и автоматической синхронизацией данных.

## Возможности

### 📊 Аналитика
- **CHURN Rate** по суммам подписок (€1, €3, €5, €9)
- **Retention Rate** и статистика удержания
- **История CHURN** с графиками по датам
- **Анализ доходов** по дням и суммам
- **Детальная статистика** по каждому подписчику
- **LTV (Lifetime Value)** расчёт

### 🔄 Автоматизация
- Автоматический импорт данных из Telegram экспорта
- Webhook для получения событий от Tribute
- Периодическая синхронизация метрик
- Обновление статистики в реальном времени

### 🎛️ Управление
- Добавление/удаление групп
- Настройка типов групп (обычная/постоянная)
- Управление временем доступа
- Синхронизация членства в группах
- Мониторинг статуса бота

---

## Быстрый старт

### 1. Запуск локально (разработка)

```bash
# Установить зависимости (если ещё не установлены)
npm install

# Применить миграции базы данных
npm run migration:run

# Импортировать исторические данные
node -e "
const { tributeService } = require('./dist/services/TributeService');
tributeService.importFromTelegramExport('/путь/к/result.json');
"

# Запустить дашборд в режиме разработки
npm run dashboard
```

Дашборд будет доступен на: **http://localhost:3000**

### 2. Запуск с Docker

```bash
# Добавить переменные в .env
echo "DASHBOARD_PORT=3000" >> .env
echo "DASHBOARD_API_KEY=твой-секретный-ключ" >> .env

# Запустить все сервисы (бот + дашборд + БД)
docker-compose up -d

# Посмотреть логи
docker-compose logs -f dashboard
```

Дашборд будет доступен на: **http://localhost:3000**

### 3. Только дашборд (без бота)

```bash
# Запустить только БД и дашборд
docker-compose up -d postgres dashboard
```

---

## API Endpoints

### Аутентификация
Все запросы требуют API ключ в заголовке:
```
X-API-Key: твой-секретный-ключ
```

### Основные endpoints

#### Метрики и аналитика

**GET /api/metrics/overview**
```bash
curl -H "X-API-Key: montana-secret-key-2026" \
  http://localhost:3000/api/metrics/overview
```
Возвращает общую статистику по всем подпискам.

**GET /api/metrics/churn-history?days=30&amount=5**
```bash
curl -H "X-API-Key: montana-secret-key-2026" \
  "http://localhost:3000/api/metrics/churn-history?days=30"
```
История CHURN за последние N дней.

**GET /api/metrics/subscribers?amount=5&active=true&limit=50&offset=0**
```bash
curl -H "X-API-Key: montana-secret-key-2026" \
  "http://localhost:3000/api/metrics/subscribers?active=true"
```
Список подписчиков с фильтрацией.

**GET /api/metrics/revenue?days=30**
```bash
curl -H "X-API-Key: montana-secret-key-2026" \
  "http://localhost:3000/api/metrics/revenue?days=30"
```
Статистика по доходам.

#### Управление группами

**GET /api/groups**
```bash
curl -H "X-API-Key: montana-secret-key-2026" \
  http://localhost:3000/api/groups
```
Список всех управляемых групп.

**POST /api/groups**
```bash
curl -X POST -H "X-API-Key: montana-secret-key-2026" \
  -H "Content-Type: application/json" \
  -d '{"chat_id": "-1001234567890", "is_permanent": false, "access_window_hours": 24}' \
  http://localhost:3000/api/groups
```
Добавить новую группу.

**DELETE /api/groups/:chatId**
```bash
curl -X DELETE -H "X-API-Key: montana-secret-key-2026" \
  http://localhost:3000/api/groups/-1001234567890
```
Удалить группу.

#### Управление ботом

**GET /api/bot/status**
```bash
curl -H "X-API-Key: montana-secret-key-2026" \
  http://localhost:3000/api/bot/status
```
Текущий статус бота.

**POST /api/bot/sync**
```bash
curl -X POST -H "X-API-Key: montana-secret-key-2026" \
  -H "Content-Type: application/json" \
  -d '{"type": "basic"}' \
  http://localhost:3000/api/bot/sync
```
Запустить синхронизацию (types: `basic` или `full`).

#### Импорт данных

**POST /api/import/tribute-export**
```bash
curl -X POST -H "X-API-Key: montana-secret-key-2026" \
  -H "Content-Type: application/json" \
  -d '{"file_path": "/путь/к/result.json"}' \
  http://localhost:3000/api/import/tribute-export
```
Импортировать данные из экспорта Telegram.

#### Webhook для Tribute

**POST /api/webhooks/tribute**
```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "type": "subscription.created",
    "user_id": "@username",
    "amount": 5.00,
    "currency": "EUR",
    "channel_id": "montana",
    "timestamp": "2026-02-12T12:00:00Z"
  }' \
  http://localhost:3000/api/webhooks/tribute
```

---

## Автоматическая синхронизация

### Настройка webhook в Tribute

1. Откройте настройки канала в Tribute
2. Найдите раздел "Webhooks"
3. Добавьте URL: `https://ваш-домен.com/api/webhooks/tribute`
4. Выберите события:
   - subscription.created
   - subscription.renewed
   - subscription.cancelled

### Периодический импорт из Telegram

Создайте cron job для автоматического импорта:

```bash
# Добавьте в crontab (каждый день в 3:00)
0 3 * * * cd /path/to/montana-tg-bot && node -e "require('./dist/services/TributeService').tributeService.importFromTelegramExport('/path/to/latest-export.json')" >> /var/log/tribute-import.log 2>&1
```

Или используйте Python скрипт для автоматического экспорта и импорта:

```python
#!/usr/bin/env python3
# auto_sync.py - автоматическая синхронизация данных

import subprocess
import json
import requests
from datetime import datetime

# 1. Экспортировать чат из Telegram (используя tdlib или telegram-cli)
# 2. Импортировать в дашборд

API_KEY = "montana-secret-key-2026"
DASHBOARD_URL = "http://localhost:3000"

def import_data(file_path):
    response = requests.post(
        f"{DASHBOARD_URL}/api/import/tribute-export",
        headers={"X-API-Key": API_KEY},
        json={"file_path": file_path}
    )
    print(f"Import status: {response.status_code}")
    print(response.json())

if __name__ == "__main__":
    # Путь к последнему экспорту
    export_file = "/path/to/telegram-export/result.json"
    import_data(export_file)
```

---

## База данных

### Таблицы

#### `subscription_events`
История всех событий подписок:
- `user_id` - ID пользователя
- `username` - Имя пользователя
- `amount` - Сумма подписки
- `event_type` - Тип события (created, renewed, cancelled)
- `event_date` - Дата события

#### `churn_metrics`
Метрики CHURN по датам:
- `date` - Дата
- `amount` - Сумма подписки
- `total_users` - Всего пользователей
- `active_users` - Активных
- `churned_users` - Отменили
- `churn_rate` - Процент CHURN

#### `user_subscription_stats`
Агрегированная статистика по пользователям:
- `user_id` - ID пользователя
- `amount` - Сумма подписки
- `total_subscriptions` - Количество подписок
- `total_renewals` - Количество продлений
- `is_active` - Активен ли
- `lifetime_value` - Общая сумма платежей

### Представления (Views)

**`current_subscription_metrics`**
Текущие метрики по каждой сумме подписки:
```sql
SELECT * FROM current_subscription_metrics;
```

---

## Продакшн деплой

### Nginx конфигурация

```nginx
server {
    listen 80;
    server_name dashboard.montana.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

### Systemd сервис

```ini
# /etc/systemd/system/montana-dashboard.service
[Unit]
Description=Montana Bot Dashboard
After=network.target postgresql.service

[Service]
Type=simple
User=montana
WorkingDirectory=/opt/montana-tg-bot
ExecStart=/usr/bin/npm run dashboard:start
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable montana-dashboard
sudo systemctl start montana-dashboard
sudo systemctl status montana-dashboard
```

---

## Безопасность

1. **Обязательно смените API ключ** в `.env`:
   ```
   DASHBOARD_API_KEY=сгенерируй-сложный-ключ-здесь
   ```

2. **Используйте HTTPS** в продакшене

3. **Ограничьте доступ** через firewall:
   ```bash
   # Разрешить доступ только с вашего IP
   sudo ufw allow from ВАШИ_IP to any port 3000
   ```

4. **Настройте Rate Limiting** в Nginx

---

## Примеры использования

### Получить CHURN за последние 7 дней для €5

```bash
curl -H "X-API-Key: montana-secret-key-2026" \
  "http://localhost:3000/api/metrics/churn-history?days=7&amount=5" \
  | jq '.[] | {date: .date, churn_rate: .churn_rate}'
```

### Найти топ-10 самых ценных подписчиков

```bash
curl -H "X-API-Key: montana-secret-key-2026" \
  "http://localhost:3000/api/metrics/subscribers?limit=10" \
  | jq '.subscribers | sort_by(.lifetime_value) | reverse | .[] | {user_id, lifetime_value, renewals: .total_renewals}'
```

### Экспортировать все данные в CSV

```python
import requests
import csv

API_KEY = "montana-secret-key-2026"
response = requests.get(
    "http://localhost:3000/api/metrics/subscribers?limit=10000",
    headers={"X-API-Key": API_KEY}
)

with open('subscribers.csv', 'w', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=response.json()['subscribers'][0].keys())
    writer.writeheader()
    writer.writerows(response.json()['subscribers'])
```

---

## Поддержка

При возникновении проблем:

1. Проверьте логи:
   ```bash
   docker-compose logs -f dashboard
   ```

2. Проверьте подключение к БД:
   ```bash
   docker-compose exec postgres psql -U montana -d montana_bot -c "SELECT COUNT(*) FROM subscription_events;"
   ```

3. Проверьте миграции:
   ```bash
   npm run migration:run
   ```

---

## Roadmap

- [ ] Telegram Bot для получения уведомлений
- [ ] Экспорт отчётов в PDF/Excel
- [ ] Прогнозирование CHURN с ML
- [ ] Интеграция с другими платформами подписок
- [ ] A/B тестирование цен

---

**Montana Dashboard v1.0 - Built with ❤️ by Claude Code**
