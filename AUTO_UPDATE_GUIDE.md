# Автоматическое обновление Montana Dashboard

## 🎯 Цель
Настроить автоматическое обновление данных в дашборде без ручного импорта.

---

## ✅ Способ 1: Автоматический импорт через Cron (РЕКОМЕНДУЕТСЯ)

### Шаг 1: Настроить регулярный экспорт чата

#### Вариант A: Вручную (раз в день/неделю)
1. Открой Telegram Desktop
2. Открой чат с @tribute
3. ⋮ (три точки) → Export chat history
4. Выбери формат: **JSON**
5. Сохрани в: `/Users/nick/Downloads/Telegram Desktop/`

#### Вариант B: Автоматически через Telegram CLI
```bash
# Установить telegram-cli
brew install telegram-cli

# Настроить и запустить
telegram-cli -k server.pub
```

### Шаг 2: Настроить cron для автоматического импорта

```bash
# Открыть crontab
crontab -e
```

Добавить одну из этих строк:

```bash
# Обновлять каждый день в 4:00 утра
0 4 * * * /Users/nick/montana-tg-bot/scripts/auto_update_dashboard.sh

# Обновлять каждые 6 часов
0 */6 * * * /Users/nick/montana-tg-bot/scripts/auto_update_dashboard.sh

# Обновлять каждый час
0 * * * * /Users/nick/montana-tg-bot/scripts/auto_update_dashboard.sh
```

Сохрани и выйди (`:wq` в vim или `Ctrl+X` в nano).

### Шаг 3: Проверить что cron работает

```bash
# Проверить список задач
crontab -l

# Проверить логи
tail -f /tmp/montana-dashboard-update.log

# Запустить вручную для теста
/Users/nick/montana-tg-bot/scripts/auto_update_dashboard.sh
```

---

## 🔥 Способ 2: Real-time обновления через Tribute Webhook

### Если у тебя есть доступ к Tribute API:

#### Шаг 1: Открой дашборд для внешнего доступа

Если дашборд на локальной машине, используй ngrok:

```bash
# Установить ngrok
brew install ngrok

# Запустить туннель
ngrok http 3000
```

Скопируй URL типа: `https://abc123.ngrok.io`

#### Шаг 2: Настроить webhook в Tribute

1. Открой https://app.tribute.tg/creator/settings
2. Найди раздел "Webhooks" или "API"
3. Добавь URL: `https://abc123.ngrok.io/api/webhooks/tribute`
4. Выбери события:
   - ✅ `subscription.created`
   - ✅ `subscription.renewed`
   - ✅ `subscription.cancelled`
5. Сохрани

**Теперь все новые события будут автоматически попадать в дашборд!** 🎉

#### Шаг 3: Проверить webhook

```bash
# Смотреть логи дашборда
tail -f /tmp/dashboard.log

# Проверить что webhook работает
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "type": "subscription.created",
    "user_id": "@test_user",
    "amount": 5.00,
    "currency": "EUR",
    "channel_id": "montana",
    "timestamp": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'"
  }' \
  http://localhost:3000/api/webhooks/tribute
```

---

## ⚡ Способ 3: Автоматический экспорт + импорт (Продвинутый)

### Создать Python скрипт для автоматического экспорта

```bash
nano /Users/nick/montana-tg-bot/scripts/auto_export_and_import.py
```

```python
#!/usr/bin/env python3
"""
Автоматический экспорт из Telegram и импорт в дашборд
Требует: telethon
"""

from telethon.sync import TelegramClient
import os
import json
import subprocess
from datetime import datetime

# Конфигурация
API_ID = os.getenv('TELEGRAM_API_ID')
API_HASH = os.getenv('TELEGRAM_API_HASH')
PHONE = os.getenv('TELEGRAM_PHONE')
SESSION_NAME = 'montana_export_session'

# Tribute bot username
TRIBUTE_BOT = 'tribute'

def export_chat():
    """Экспортировать чат с Tribute"""
    print("🔄 Подключение к Telegram...")

    with TelegramClient(SESSION_NAME, API_ID, API_HASH) as client:
        # Получить чат
        entity = client.get_entity(TRIBUTE_BOT)

        # Экспортировать сообщения
        messages = []
        for message in client.iter_messages(entity, limit=10000):
            messages.append({
                'id': message.id,
                'date': message.date.isoformat(),
                'text': message.text,
                # ... добавить больше полей
            })

        # Сохранить в JSON
        export_path = f'/tmp/tribute_export_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
        with open(export_path, 'w') as f:
            json.dump({'messages': messages}, f)

        print(f"✅ Экспорт сохранён: {export_path}")
        return export_path

def import_to_dashboard(export_path):
    """Импортировать в дашборд"""
    print("📊 Импорт в дашборд...")

    # Обновить путь в скрипте
    script = f"""
import sys
sys.path.insert(0, '/Users/nick/montana-tg-bot/scripts')
import reimport_with_cancellations
reimport_with_cancellations.EXPORT_FILE = '{export_path}'
reimport_with_cancellations.main()
"""

    subprocess.run(['python3', '-c', script], check=True)
    print("✅ Импорт завершён")

def main():
    export_path = export_chat()
    import_to_dashboard(export_path)
    print("🎉 Готово!")

if __name__ == '__main__':
    main()
```

Установить библиотеку:
```bash
pip3 install --break-system-packages telethon
```

Добавить в cron:
```bash
# Каждый день в 3:00
0 3 * * * cd /Users/nick/montana-tg-bot && python3 scripts/auto_export_and_import.py >> /tmp/auto-export.log 2>&1
```

---

## 📊 Способ 4: Мониторинг файловой системы (macOS)

Автоматически импортировать когда появляется новый экспорт:

```bash
# Создать скрипт наблюдателя
nano /Users/nick/montana-tg-bot/scripts/watch_exports.sh
```

```bash
#!/bin/bash
# Следить за новыми экспортами

WATCH_DIR="/Users/nick/Downloads/Telegram Desktop"
SCRIPT="/Users/nick/montana-tg-bot/scripts/auto_update_dashboard.sh"

echo "👀 Наблюдение за $WATCH_DIR"

fswatch -0 "$WATCH_DIR" | while read -d "" event; do
    if [[ "$event" == *"result.json"* ]]; then
        echo "[$(date)] 📥 Обнаружен новый экспорт: $event"
        sleep 5  # Подождать завершения записи
        $SCRIPT
    fi
done
```

Установить fswatch:
```bash
brew install fswatch
```

Запустить в фоне:
```bash
chmod +x scripts/watch_exports.sh
nohup scripts/watch_exports.sh > /tmp/watch-exports.log 2>&1 &
```

---

## 🔧 Проверка и отладка

### Проверить что всё работает

```bash
# 1. Проверить cron
crontab -l

# 2. Проверить логи автообновления
tail -f /tmp/montana-dashboard-update.log

# 3. Проверить логи дашборда
tail -f /tmp/dashboard.log

# 4. Проверить что дашборд запущен
lsof -ti:3000

# 5. Проверить последние данные в БД
docker exec montana-postgres psql -U montana -d montana_bot -c "
SELECT MAX(event_date) as last_event, COUNT(*) as total
FROM subscription_events;
"

# 6. Проверить метрики
curl -s -H "X-API-Key: montana-secret-key-2026" \
  http://localhost:3000/api/metrics/overview | jq '.total'
```

---

## 📱 Уведомления об обновлениях

### Отправлять уведомление в Telegram после обновления

Добавь в конец `auto_update_dashboard.sh`:

```bash
# Отправить уведомление
curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
  -d "chat_id=${ADMIN_CHAT_ID}" \
  -d "text=✅ Дашборд Montana обновлён! $(date)" \
  > /dev/null
```

Добавь в `.env`:
```bash
BOT_TOKEN=твой_токен_бота
ADMIN_CHAT_ID=твой_chat_id
```

---

## 🎛️ Автоматический запуск дашборда

### Чтобы дашборд автоматически запускался после перезагрузки:

#### macOS (LaunchAgent)

```bash
# Создать plist файл
nano ~/Library/LaunchAgents/com.montana.dashboard.plist
```

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.montana.dashboard</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/Users/nick/montana-tg-bot/dashboard_server.js</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/montana-dashboard.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/montana-dashboard-error.log</string>
    <key>WorkingDirectory</key>
    <string>/Users/nick/montana-tg-bot</string>
</dict>
</plist>
```

Загрузить:
```bash
launchctl load ~/Library/LaunchAgents/com.montana.dashboard.plist
launchctl start com.montana.dashboard
```

Проверить:
```bash
launchctl list | grep montana
```

---

## ⏰ Рекомендуемое расписание

Для оптимальной работы:

```bash
# 1. Экспорт чата: раз в сутки в 3:00
0 3 * * * telegram-cli -e "export_chat @tribute" > /tmp/export.log 2>&1

# 2. Импорт данных: в 4:00 (после экспорта)
0 4 * * * /Users/nick/montana-tg-bot/scripts/auto_update_dashboard.sh

# 3. Очистка старых логов: каждое воскресенье
0 2 * * 0 find /tmp -name "montana-*.log" -mtime +7 -delete
```

---

## 🎉 Итого

После настройки у тебя будет:
- ✅ Автоматический импорт данных из Telegram
- ✅ Обновление дашборда по расписанию
- ✅ Real-time обновления через webhook (опционально)
- ✅ Автозапуск дашборда после перезагрузки
- ✅ Логирование всех операций
- ✅ Уведомления об обновлениях

**Дашборд будет обновляться автоматически без твоего участия!** 🚀

---

## 🆘 Проблемы и решения

### Cron не работает
```bash
# Проверить что cron запущен
sudo launchctl list | grep cron

# Добавить разрешение в System Preferences
# System Preferences → Security & Privacy → Full Disk Access → Terminal
```

### Данные не обновляются
```bash
# Проверить последнее время импорта
tail /tmp/montana-dashboard-update.log

# Запустить вручную
/Users/nick/montana-tg-bot/scripts/auto_update_dashboard.sh
```

### Webhook не работает
```bash
# Проверить что дашборд доступен
curl http://localhost:3000/api/bot/status

# Проверить ngrok
ngrok http 3000
```

---

## 📚 Дополнительно

### Backup базы данных

Добавь в cron:
```bash
# Backup каждый день в 2:00
0 2 * * * docker exec montana-postgres pg_dump -U montana montana_bot | gzip > /backups/montana_$(date +\%Y\%m\%d).sql.gz
```

### Мониторинг uptime
```bash
# Проверять каждые 5 минут
*/5 * * * * curl -sf http://localhost:3000/api/bot/status > /dev/null || echo "Dashboard DOWN!" | mail -s "Montana Alert" admin@example.com
```
