#!/usr/bin/env python3
"""
Автоматическая синхронизация данных подписок
Скрипт для запуска через cron для периодического обновления метрик
"""

import os
import sys
import json
import requests
from datetime import datetime
from pathlib import Path

# Конфигурация
DASHBOARD_URL = os.getenv('DASHBOARD_URL', 'http://localhost:3000')
API_KEY = os.getenv('DASHBOARD_API_KEY', 'montana-secret-key-2026')
EXPORT_PATH = os.getenv('TELEGRAM_EXPORT_PATH', '/Users/nick/Downloads/Telegram Desktop/ChatExport_2026-02-12 (1)/result.json')
LOG_FILE = os.getenv('SYNC_LOG_FILE', '/tmp/montana-sync.log')


def log(message):
    """Записать сообщение в лог"""
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    log_message = f"[{timestamp}] {message}\n"

    print(log_message.strip())

    with open(LOG_FILE, 'a') as f:
        f.write(log_message)


def check_export_file():
    """Проверить существование файла экспорта"""
    if not os.path.exists(EXPORT_PATH):
        log(f"❌ Файл экспорта не найден: {EXPORT_PATH}")
        return False

    # Проверить, что файл был изменён за последние 24 часа
    file_mtime = os.path.getmtime(EXPORT_PATH)
    current_time = datetime.now().timestamp()
    age_hours = (current_time - file_mtime) / 3600

    if age_hours > 24:
        log(f"⚠️  Файл экспорта устарел ({age_hours:.1f} часов назад)")

    return True


def import_data():
    """Импортировать данные через API"""
    try:
        log(f"📥 Начинаем импорт из {EXPORT_PATH}")

        response = requests.post(
            f"{DASHBOARD_URL}/api/import/tribute-export",
            headers={
                'X-API-Key': API_KEY,
                'Content-Type': 'application/json'
            },
            json={'file_path': EXPORT_PATH},
            timeout=300  # 5 минут таймаут
        )

        if response.status_code == 200:
            log(f"✅ Импорт успешно завершён")
            return True
        else:
            log(f"❌ Ошибка импорта: {response.status_code} - {response.text}")
            return False

    except requests.exceptions.RequestException as e:
        log(f"❌ Ошибка подключения к API: {e}")
        return False


def get_current_metrics():
    """Получить текущие метрики и записать в лог"""
    try:
        response = requests.get(
            f"{DASHBOARD_URL}/api/metrics/overview",
            headers={'X-API-Key': API_KEY},
            timeout=30
        )

        if response.status_code == 200:
            data = response.json()
            total = data.get('total', {})

            log(f"📊 Текущие метрики:")
            log(f"   • Всего подписчиков: {total.get('total_users', 0)}")
            log(f"   • Активных: {total.get('active_users', 0)}")
            log(f"   • Общий доход: €{float(total.get('total_revenue', 0)):.2f}")
            log(f"   • Среднее продлений: {float(total.get('avg_renewals', 0)):.2f}")

            # Метрики по суммам
            for amount_data in data.get('by_amount', []):
                amount = float(amount_data.get('amount', 0))
                churn_rate = float(amount_data.get('churn_rate', 0))
                log(f"   • €{amount:.2f}: CHURN {churn_rate:.2f}%")

            return True
        else:
            log(f"❌ Ошибка получения метрик: {response.status_code}")
            return False

    except requests.exceptions.RequestException as e:
        log(f"❌ Ошибка получения метрик: {e}")
        return False


def check_dashboard_health():
    """Проверить доступность дашборда"""
    try:
        response = requests.get(
            f"{DASHBOARD_URL}/api/bot/status",
            headers={'X-API-Key': API_KEY},
            timeout=10
        )

        if response.status_code == 200:
            log(f"✅ Дашборд доступен")
            return True
        else:
            log(f"❌ Дашборд недоступен: {response.status_code}")
            return False

    except requests.exceptions.RequestException as e:
        log(f"❌ Дашборд недоступен: {e}")
        return False


def main():
    """Главная функция"""
    log("=" * 80)
    log("🚀 Запуск автоматической синхронизации Montana Bot")
    log("=" * 80)

    # Проверяем доступность дашборда
    if not check_dashboard_health():
        log("❌ Дашборд недоступен, прерываем синхронизацию")
        sys.exit(1)

    # Проверяем файл экспорта
    if not check_export_file():
        log("❌ Файл экспорта недоступен, прерываем синхронизацию")
        sys.exit(1)

    # Импортируем данные
    if import_data():
        # Получаем и показываем метрики
        get_current_metrics()
        log("✅ Синхронизация успешно завершена")
        log("=" * 80)
        sys.exit(0)
    else:
        log("❌ Синхронизация завершена с ошибками")
        log("=" * 80)
        sys.exit(1)


if __name__ == '__main__':
    main()
