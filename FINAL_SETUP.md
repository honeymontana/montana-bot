# Montana Bot Dashboard - Финальная настройка

## Что готово ✅

1. **База данных** с историей подписок и метриками CHURN
2. **Разделение** на подписки Montana.dll (канал) и другие товары
3. **Веб-дашборд** с красивой аналитикой и графиками
4. **API** для программного доступа
5. **Автоматическая синхронизация** через Python скрипты
6. **3,154 событий** уже импортировано из Telegram

---

## Текущая статистика

### Канал Montana.dll
- **€1.00**: 1 подписчик
- **€3.00**: 249 подписчиков
- **€4.00**: 12 подписчиков
- **€5.00**: 1,017 подписчиков ⭐
- **€9.00**: 199 подписчиков

**Всего по каналу: 1,478 подписчиков**

### Другие товары
- €19 - €99: 90 покупателей

---

## Быстрый доступ

### Открыть дашборд
```bash
http://localhost:3000
```

API ключ: `montana-secret-key-2026`

### Проверить что дашборд работает
```bash
curl -H "X-API-Key: montana-secret-key-2026" \
  http://localhost:3000/api/metrics/overview
```

---

## Использование дашборда

### 1. Открой http://localhost:3000

Ты увидишь:
- **4 карточки** с общими метриками
- **Вкладки "Канал Montana.dll"** и "Другие товары"
- **Графики** CHURN и доходов
- **Таблицы** всех подписчиков
- **Управление группами** бота

### 2. Вкладка "Канал Montana.dll"

Показывает:
- CHURN по тарифам €1, €3, €5, €9
- Сколько подписчиков активных/отменили
- Среднее количество продлений
- Общий доход по каждому тарифу

### 3. Вкладка "Другие товары"

Показывает:
- Статистику по товарам (€19+)
- Отдельно от подписок на канал

---

## Автоматическая синхронизация

### Вариант 1: Вручную (когда нужно)

```bash
# Импортировать новые данные из экспорта Telegram
python3 scripts/import_telegram_export.py
```

### Вариант 2: Автоматически (cron)

Добавь в crontab:
```bash
crontab -e
```

Вставь:
```cron
# Синхронизация каждый день в 3:00
0 3 * * * cd /Users/nick/montana-tg-bot && python3 scripts/auto_sync.py >> /tmp/montana-sync.log 2>&1
```

Проверь:
```bash
python3 scripts/auto_sync.py
tail -f /tmp/montana-sync.log
```

---

## API Endpoints (примеры)

### Получить статистику по каналу
```bash
curl -H "X-API-Key: montana-secret-key-2026" \
  http://localhost:3000/api/metrics/overview \
  | jq '.by_amount[] | select(.product_type == "channel")'
```

### Получить топ-10 самых ценных подписчиков
```bash
curl -H "X-API-Key: montana-secret-key-2026" \
  "http://localhost:3000/api/metrics/subscribers?limit=10" \
  | jq '.subscribers | sort_by(.lifetime_value) | reverse | .[] | {user_id, ltv: .lifetime_value}'
```

### CHURN за последние 7 дней
```bash
curl -H "X-API-Key: montana-secret-key-2026" \
  "http://localhost:3000/api/metrics/churn-history?days=7&amount=5"
```

### Доходы за последний месяц
```bash
curl -H "X-API-Key: montana-secret-key-2026" \
  "http://localhost:3000/api/metrics/revenue?days=30"
```

---

## Управление

### Запустить дашборд
```bash
node dashboard_server.js
```

### Запустить в фоне
```bash
nohup node dashboard_server.js > /tmp/dashboard.log 2>&1 &
```

### Остановить
```bash
pkill -f "node dashboard_server.js"
```

### С Docker
```bash
# Запустить всё
docker-compose up -d

# Только дашборд
docker-compose up -d postgres dashboard

# Логи
docker-compose logs -f dashboard

# Остановить
docker-compose stop dashboard
```

---

## Обновление данных из нового экспорта

Когда получишь новый экспорт из Telegram:

```bash
# 1. Обнови путь в скрипте
nano scripts/import_telegram_export.py
# Измени EXPORT_FILE на путь к новому result.json

# 2. Импортируй
python3 scripts/import_telegram_export.py

# 3. Обнови страницу дашборда
# Метрики автоматически пересчитаются
```

---

## Продакшн

### Nginx (если нужен внешний доступ)
```nginx
server {
    listen 80;
    server_name dashboard.montana.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### Systemd (автозапуск)
```bash
sudo nano /etc/systemd/system/montana-dashboard.service
```

```ini
[Unit]
Description=Montana Dashboard
After=network.target

[Service]
Type=simple
User=nick
WorkingDirectory=/Users/nick/montana-tg-bot
ExecStart=/usr/bin/node dashboard_server.js
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable montana-dashboard
sudo systemctl start montana-dashboard
```

---

## Безопасность

### Сменить API ключ
```bash
# В .env
echo "DASHBOARD_API_KEY=$(openssl rand -hex 32)" >> .env

# Или вручную
export DASHBOARD_API_KEY="твой-секретный-ключ"
node dashboard_server.js
```

### Ограничить доступ
```bash
# Только с локального IP
sudo ufw allow from 192.168.1.0/24 to any port 3000
```

---

## Файлы

```
montana-tg-bot/
├── dashboard_server.js              # Веб-сервер дашборда
├── dashboard/dist/index.html        # HTML интерфейс
├── scripts/
│   ├── import_telegram_export.py   # Импорт из Telegram
│   ├── auto_sync.py                # Автосинхронизация
│   └── crontab.example             # Примеры cron
├── migrations/
│   ├── 006_add_subscription_analytics.sql
│   └── 007_add_product_type.sql
├── QUICK_START.md
├── DASHBOARD_GUIDE.md
└── analyze_subscriptions.py         # Первый анализ (не нужен больше)
```

---

## Что дальше?

1. ✅ Дашборд запущен и работает
2. ✅ Данные импортированы (3,154 события)
3. ✅ Разделение на канал и товары работает
4. 🔄 Настроить cron для автоматического обновления
5. 🌐 (Опционально) Настроить доступ извне через nginx
6. 🔒 (Опционально) Сменить API ключ на более безопасный

---

## Полезные команды

```bash
# Проверить БД
docker exec montana-postgres psql -U montana -d montana_bot -c "SELECT COUNT(*) FROM subscription_events;"

# Посмотреть разделение
docker exec montana-postgres psql -U montana -d montana_bot -c "SELECT product_type, COUNT(*) FROM subscription_events GROUP BY product_type;"

# Топ подписчики по LTV
docker exec montana-postgres psql -U montana -d montana_bot -c "SELECT user_id, lifetime_value FROM user_subscription_stats ORDER BY lifetime_value DESC LIMIT 10;"

# Обновить анализ
python3 scripts/import_telegram_export.py
```

---

**🎉 Готово! Дашборд полностью настроен и готов к использованию!**

Открывай **http://localhost:3000** и наслаждайся аналитикой!
