#!/usr/bin/env python3
"""
Переимпорт данных с правильной обработкой отмен
"""

import json
import psycopg2
from datetime import datetime
from collections import defaultdict
import os

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
    """Извлечь текст"""
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
    """Извлечь сумму"""
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


def main():
    print("🔄 Переимпорт с учётом отмен...\n")

    # Загрузка данных
    with open(EXPORT_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)

    messages = data.get('messages', [])
    print(f"✅ Загружено {len(messages)} сообщений")

    # Подключение к БД
    conn = psycopg2.connect(**DB_CONFIG)
    cursor = conn.cursor()

    # Очистить старые данные
    print("🗑️  Очистка старых данных...")
    cursor.execute("TRUNCATE TABLE subscription_events CASCADE;")
    cursor.execute("TRUNCATE TABLE user_subscription_stats CASCADE;")
    cursor.execute("TRUNCATE TABLE churn_metrics CASCADE;")
    conn.commit()

    # Сначала собираем всю информацию о пользователях
    user_subscriptions = defaultdict(list)  # {user_id: [(date, amount, event_type)]}

    print("📊 Первый проход: сбор всех событий...")

    for message in messages:
        text = extract_text(message)
        user_id = extract_user_id(message)
        date = message.get('date')

        if not user_id or not date:
            continue

        # Извлечь username
        username = None
        entities = message.get('text_entities', [])
        for entity in entities:
            if entity.get('type') == 'mention':
                username = entity.get('text', '').replace('@', '')
                break

        # Обработка оформления подписки
        if 'оформил подписку' in text:
            amount = extract_amount(message)
            if amount:
                user_subscriptions[user_id].append({
                    'date': date,
                    'amount': amount,
                    'event_type': 'subscription.created',
                    'username': username
                })

        # Обработка продления
        elif 'продлил подписку' in text:
            amount = extract_amount(message)
            if amount:
                user_subscriptions[user_id].append({
                    'date': date,
                    'amount': amount,
                    'event_type': 'subscription.renewed',
                    'username': username
                })

        # Обработка отмены - НЕТ СУММЫ!
        elif 'отменил' in text and 'подписку' in text:
            user_subscriptions[user_id].append({
                'date': date,
                'amount': None,  # Сумму узнаем из последней подписки
                'event_type': 'subscription.cancelled',
                'username': username
            })

    print(f"✅ Собрано событий для {len(user_subscriptions)} пользователей\n")

    # Второй проход: связываем отмены с суммами и вставляем в БД
    print("💾 Второй проход: вставка в БД...")

    imported = 0
    cancellations_matched = 0
    cancellations_unmatched = 0

    for user_id, events in user_subscriptions.items():
        # Сортируем события по дате
        events.sort(key=lambda x: x['date'])

        # Для каждого пользователя отслеживаем его подписки по суммам
        active_amounts = defaultdict(lambda: None)  # {amount: last_subscription_date}

        for event in events:
            if event['event_type'] == 'subscription.created':
                # Запоминаем что пользователь подписался на этот тариф
                active_amounts[event['amount']] = event['date']

                # Вставляем в БД
                cursor.execute("""
                    INSERT INTO subscription_events (
                        user_id, username, amount, event_type, event_date
                    ) VALUES (%s, %s, %s, %s, %s)
                """, (user_id, event['username'], event['amount'], event['event_type'], event['date']))
                imported += 1

            elif event['event_type'] == 'subscription.renewed':
                # Продление - просто вставляем
                cursor.execute("""
                    INSERT INTO subscription_events (
                        user_id, username, amount, event_type, event_date
                    ) VALUES (%s, %s, %s, %s, %s)
                """, (user_id, event['username'], event['amount'], event['event_type'], event['date']))
                imported += 1

            elif event['event_type'] == 'subscription.cancelled':
                # Отмена - нужно найти какую подписку отменил
                # Берём последнюю активную подписку по дате
                if active_amounts:
                    # Находим последнюю подписку (с максимальной датой)
                    last_amount = max(active_amounts.items(), key=lambda x: x[1])[0]

                    # Вставляем отмену для этой суммы
                    cursor.execute("""
                        INSERT INTO subscription_events (
                            user_id, username, amount, event_type, event_date
                        ) VALUES (%s, %s, %s, %s, %s)
                    """, (user_id, event['username'], last_amount, event['event_type'], event['date']))
                    imported += 1
                    cancellations_matched += 1

                    # Удаляем из активных
                    del active_amounts[last_amount]
                else:
                    cancellations_unmatched += 1
                    print(f"⚠️  Не удалось сопоставить отмену для {user_id} на {event['date']}")

    conn.commit()

    print(f"\n✅ Импорт завершён!")
    print(f"   • Всего событий: {imported}")
    print(f"   • Отмен сопоставлено: {cancellations_matched}")
    print(f"   • Отмен не сопоставлено: {cancellations_unmatched}")

    # Статистика
    print("\n📊 Статистика по каналу:")
    cursor.execute("""
        SELECT
            amount,
            COUNT(DISTINCT user_id) as total_users,
            COUNT(DISTINCT user_id) FILTER (WHERE event_type = 'subscription.cancelled') as churned_users,
            ROUND((COUNT(DISTINCT user_id) FILTER (WHERE event_type = 'subscription.cancelled')::numeric /
                   COUNT(DISTINCT user_id) * 100), 2) as churn_rate
        FROM subscription_events
        WHERE amount IN (1, 3, 4, 5, 9)
        GROUP BY amount
        ORDER BY amount
    """)

    for row in cursor.fetchall():
        amount, total, churned, churn_rate = row
        print(f"   • €{amount:.2f}: {total} подписчиков, {churned} отменили, CHURN {churn_rate}%")

    cursor.close()
    conn.close()

    print("\n🎉 Готово! Теперь CHURN считается правильно!")


if __name__ == '__main__':
    main()
