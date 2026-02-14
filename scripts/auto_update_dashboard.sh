#!/bin/bash
# Автоматическое обновление дашборда из Telegram экспорта

# Конфигурация
EXPORT_DIR="/Users/nick/Downloads/Telegram Desktop"
SCRIPT_DIR="/Users/nick/montana-tg-bot"
LOG_FILE="/tmp/montana-dashboard-update.log"

echo "=================================================" >> "$LOG_FILE"
echo "[$(date)] Начало обновления дашборда" >> "$LOG_FILE"
echo "=================================================" >> "$LOG_FILE"

# Найти последний экспорт
LATEST_EXPORT=$(find "$EXPORT_DIR" -name "ChatExport_*" -type d | sort -r | head -1)

if [ -z "$LATEST_EXPORT" ]; then
    echo "[$(date)] ❌ Экспорт не найден в $EXPORT_DIR" >> "$LOG_FILE"
    exit 1
fi

RESULT_JSON="$LATEST_EXPORT/result.json"

if [ ! -f "$RESULT_JSON" ]; then
    echo "[$(date)] ❌ Файл result.json не найден: $RESULT_JSON" >> "$LOG_FILE"
    exit 1
fi

echo "[$(date)] ✅ Найден экспорт: $LATEST_EXPORT" >> "$LOG_FILE"
echo "[$(date)] 📄 Файл: $RESULT_JSON" >> "$LOG_FILE"

# Обновить путь в скрипте импорта
cd "$SCRIPT_DIR"

# Создать временный скрипт с правильным путём
cat > /tmp/import_temp.py << EOF
#!/usr/bin/env python3
import sys
sys.path.insert(0, '$SCRIPT_DIR/scripts')

# Изменить путь к файлу
import reimport_with_cancellations
reimport_with_cancellations.EXPORT_FILE = '$RESULT_JSON'
reimport_with_cancellations.main()
EOF

# Запустить импорт
echo "[$(date)] 🔄 Запуск импорта..." >> "$LOG_FILE"
python3 /tmp/import_temp.py >> "$LOG_FILE" 2>&1

if [ $? -eq 0 ]; then
    echo "[$(date)] ✅ Импорт успешно завершён" >> "$LOG_FILE"
    echo "[$(date)] 📊 Дашборд обновлён" >> "$LOG_FILE"
else
    echo "[$(date)] ❌ Ошибка импорта" >> "$LOG_FILE"
    exit 1
fi

# Очистка
rm -f /tmp/import_temp.py

echo "[$(date)] 🎉 Обновление завершено" >> "$LOG_FILE"
echo "" >> "$LOG_FILE"
