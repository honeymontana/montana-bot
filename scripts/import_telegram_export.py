#!/usr/bin/env python3
"""
Импорт данных из экспорта Telegram напрямую в PostgreSQL
"""

import json
import psycopg2
from datetime import datetime
import os
import sys

# Конфигурация БД
DB_CONFIG = {
    'host': os.getenv('DB_HOST', 'localhost'),
    'port': int(os.getenv('DB_PORT', '5432')),
    'database': os.getenv('DB_NAME', 'montana_bot'),
    'user': os.getenv('DB_USER', 'montana'),
    'password': os.getenv('DB_PASSWORD', 'montana_secure_password')
}

EXPORT_FILE = '/Users/nick/Downloads/Telegram Desktop/ChatExport_2026-02-12 (1)/result.json'


def extract_text(message):
    """Извлечь текст из сообщения"""
    text = message.get('text', '')
    if isinstance(text, str):
        return text
    if isinstance(text, list):
        return ''.join([
            item if isinstance(item, str) else item.get('text', '')
            for item in text
        ])
    return ''


def extract_user_id(message):
    """Извлечь ID пользователя"""
    entities = message.get('text_entities', [])
    for entity in entities:
        if entity.get('type') == 'mention':
            return entity.get('text', '').strip()
        elif entity.get('type') == 'mention_name':
            user_id = entity.get('user_id')
            if user_id:
                return f"user_{user_id}"
    return None


def extract_amount(message):
    """Извлечь сумму платежа"""
    entities = message.get('text_entities', [])
    for entity in entities:
        if entity.get('type') == 'bold':
            text = entity.get('text', '')
            if text.startswith('€'):
                try:
                    return float(text.replace('€', '').replace(',', '.'))
                except ValueError:
                    pass
    return None


def import_data():
    """Импортировать данные"""
    print(f"📥 Загрузка данных из {EXPORT_FILE}...")

    with open(EXPORT_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)

    messages = data.get('messages', [])
    print(f"✅ Загружено {len(messages)} сообщений")

    # Подключение к БД
    print("🔌 Подключение к PostgreSQL...")
    conn = psycopg2.connect(**DB_CONFIG)
    cursor = conn.cursor()

    imported = 0
    skipped = 0

    print("📊 Обработка сообщений...")

    for message in messages:
        text = extract_text(message)
        user_id = extract_user_id(message)
        amount = extract_amount(message)
        date = message.get('date')

        if not user_id or not amount or not date:
            continue

        # Определить тип события
        event_type = None
        if 'оформил подписку' in text:
            event_type = 'subscription.created'
        elif 'продлил подписку' in text:
            event_type = 'subscription.renewed'
        elif 'отменил' in text and 'подписку' in text:
            event_type = 'subscription.cancelled'
        else:
            continue

        # Извлечь username если есть
        username = None
        entities = message.get('text_entities', [])
        for entity in entities:
            if entity.get('type') == 'mention':
                username = entity.get('text', '').replace('@', '')
                break

        # Вставить в БД
        try:
            cursor.execute("""
                INSERT INTO subscription_events (
                    user_id, username, amount, event_type, event_date
                ) VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT DO NOTHING
            """, (user_id, username, amount, event_type, date))

            if cursor.rowcount > 0:
                imported += 1
            else:
                skipped += 1

        except Exception as e:
            print(f"⚠️  Ошибка вставки: {e}")
            continue

    # Коммит
    conn.commit()

    print(f"\n✅ Импорт завершён!")
    print(f"   • Импортировано: {imported} событий")
    print(f"   • Пропущено (дубликаты): {skipped}")
    print(f"   • Всего обработано: {imported + skipped}")

    # Обновить метрики
    print("\n📊 Обновление метрик...")

    # Подсчитать текущие метрики
    cursor.execute("""
        SELECT
            amount,
            COUNT(DISTINCT user_id) FILTER (WHERE event_type = 'subscription.created') as total_users,
            COUNT(DISTINCT user_id) FILTER (WHERE event_type = 'subscription.cancelled') as churned_users
        FROM subscription_events
        GROUP BY amount
    """)

    for row in cursor.fetchall():
        amount, total_users, churned_users = row
        active_users = total_users - churned_users
        churn_rate = (churned_users / total_users * 100) if total_users > 0 else 0

        print(f"   • €{amount:.2f}: {total_users} подписчиков, CHURN {churn_rate:.2f}%")

    cursor.close()
    conn.close()

    print("\n🎉 Готово!")


if __name__ == '__main__':
    try:
        import_data()
    except FileNotFoundError:
        print(f"❌ Файл не найден: {EXPORT_FILE}")
        print("Укажите правильный путь к result.json")
        sys.exit(1)
    except psycopg2.Error as e:
        print(f"❌ Ошибка БД: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"❌ Ошибка: {e}")
        sys.exit(1)
