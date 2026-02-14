#!/usr/bin/env python3
"""
Анализатор подписок из экспорта Telegram
Считает CHURN, среднее количество продлений и другую статистику
"""

import json
from collections import defaultdict
from datetime import datetime
from typing import Dict, List, Set


def extract_user_id(message: dict) -> str:
    """Извлекает уникальный идентификатор пользователя из сообщения"""
    text_entities = message.get('text_entities', [])

    for entity in text_entities:
        # Ищем mention или mention_name
        if entity.get('type') == 'mention':
            return entity.get('text', '').strip()
        elif entity.get('type') == 'mention_name':
            user_id = entity.get('user_id')
            if user_id:
                return f"user_{user_id}"

    return None


def extract_amount(message: dict) -> float:
    """Извлекает сумму платежа из сообщения"""
    text_entities = message.get('text_entities', [])

    for entity in text_entities:
        if entity.get('type') == 'bold':
            text = entity.get('text', '')
            if text.startswith('€'):
                try:
                    return float(text.replace('€', '').replace(',', '.'))
                except ValueError:
                    pass

    return None


def analyze_subscriptions(file_path: str):
    """Анализирует подписки из JSON файла"""

    print(f"📊 Загрузка данных из {file_path}...")
    with open(file_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    messages = data.get('messages', [])
    print(f"✅ Загружено {len(messages)} сообщений\n")

    # Структуры для хранения данных
    # {user_id: {amount: {'subscriptions': [dates], 'renewals': [dates], 'cancelled': date}}}
    user_data = defaultdict(lambda: defaultdict(lambda: {
        'subscriptions': [],
        'renewals': [],
        'cancelled': None
    }))

    subscriptions_count = 0
    renewals_count = 0
    cancellations_count = 0

    print("🔍 Обработка сообщений...")

    for message in messages:
        text = message.get('text', '')

        # Конвертируем text в строку, если это список
        if isinstance(text, list):
            text_str = ''
            for item in text:
                if isinstance(item, str):
                    text_str += item
                elif isinstance(item, dict):
                    text_str += item.get('text', '')
            text = text_str

        user_id = extract_user_id(message)
        if not user_id:
            continue

        date = message.get('date', '')

        # Обработка оформления подписки
        if 'оформил подписку' in text:
            amount = extract_amount(message)
            if amount:
                user_data[user_id][amount]['subscriptions'].append(date)
                subscriptions_count += 1

        # Обработка продления подписки
        elif 'продлил подписку' in text:
            amount = extract_amount(message)
            if amount:
                user_data[user_id][amount]['renewals'].append(date)
                renewals_count += 1

        # Обработка отмены подписки
        elif 'отменил' in text and 'подписку' in text:
            # Отмена не содержит сумму, поэтому помечаем все подписки пользователя
            user_data[user_id]['_cancelled'] = date
            cancellations_count += 1

    print(f"✅ Обработано:")
    print(f"   • Новых подписок: {subscriptions_count}")
    print(f"   • Продлений: {renewals_count}")
    print(f"   • Отмен: {cancellations_count}\n")

    # Группировка по суммам
    amounts = [1.0, 3.0, 5.0, 9.0]

    print("=" * 80)
    print("📈 ДЕТАЛЬНАЯ АНАЛИТИКА ПО СУММАМ ПОДПИСОК")
    print("=" * 80)

    total_users_all = set()
    total_cancelled_all = set()
    total_renewals_all = []

    for amount in amounts:
        print(f"\n💶 ПОДПИСКА ЗА €{amount:.2f}")
        print("-" * 80)

        users_with_amount = set()
        users_cancelled = set()
        renewals_per_user = []

        for user_id, amounts_data in user_data.items():
            if amount in amounts_data:
                user_info = amounts_data[amount]

                # Считаем только если была хотя бы одна подписка
                if user_info['subscriptions']:
                    users_with_amount.add(user_id)
                    total_users_all.add(user_id)

                    # Количество продлений для этого пользователя
                    renewals = len(user_info['renewals'])
                    renewals_per_user.append(renewals)
                    total_renewals_all.append(renewals)

                    # Проверяем, отменил ли пользователь
                    if '_cancelled' in amounts_data:
                        users_cancelled.add(user_id)
                        total_cancelled_all.add(user_id)

        total_users = len(users_with_amount)
        total_cancelled = len(users_cancelled)
        active_users = total_users - total_cancelled

        if total_users > 0:
            churn_rate = (total_cancelled / total_users) * 100
            retention_rate = ((total_users - total_cancelled) / total_users) * 100
            avg_renewals = sum(renewals_per_user) / len(renewals_per_user) if renewals_per_user else 0
        else:
            churn_rate = 0
            retention_rate = 0
            avg_renewals = 0

        print(f"Всего подписчиков:        {total_users}")
        print(f"Активных подписчиков:     {active_users}")
        print(f"Отменили подписку:        {total_cancelled}")
        print(f"\n📊 CHURN RATE:             {churn_rate:.2f}%")
        print(f"📊 RETENTION RATE:         {retention_rate:.2f}%")
        print(f"📊 Среднее продлений:      {avg_renewals:.2f}")

        if renewals_per_user:
            print(f"\nРаспределение продлений:")
            print(f"  • Минимум:               {min(renewals_per_user)}")
            print(f"  • Максимум:              {max(renewals_per_user)}")
            print(f"  • Медиана:               {sorted(renewals_per_user)[len(renewals_per_user)//2]}")

            # Подсчёт по категориям
            no_renewals = sum(1 for r in renewals_per_user if r == 0)
            one_renewal = sum(1 for r in renewals_per_user if r == 1)
            multiple_renewals = sum(1 for r in renewals_per_user if r > 1)

            print(f"\nКатегории подписчиков:")
            print(f"  • Без продлений (0):     {no_renewals} ({no_renewals/total_users*100:.1f}%)")
            print(f"  • Одно продление (1):    {one_renewal} ({one_renewal/total_users*100:.1f}%)")
            print(f"  • Несколько (>1):        {multiple_renewals} ({multiple_renewals/total_users*100:.1f}%)")

    # Общая статистика
    print("\n" + "=" * 80)
    print("📊 ОБЩАЯ СТАТИСТИКА ПО ВСЕМ ПОДПИСКАМ")
    print("=" * 80)

    total_unique_users = len(total_users_all)
    total_unique_cancelled = len(total_cancelled_all)
    total_unique_active = total_unique_users - total_unique_cancelled

    if total_unique_users > 0:
        overall_churn = (total_unique_cancelled / total_unique_users) * 100
        overall_retention = ((total_unique_users - total_unique_cancelled) / total_unique_users) * 100
        overall_avg_renewals = sum(total_renewals_all) / len(total_renewals_all) if total_renewals_all else 0
    else:
        overall_churn = 0
        overall_retention = 0
        overall_avg_renewals = 0

    print(f"\nВсего уникальных подписчиков:  {total_unique_users}")
    print(f"Активных подписчиков:           {total_unique_active}")
    print(f"Отменили подписку:              {total_unique_cancelled}")
    print(f"\n📊 ОБЩИЙ CHURN RATE:            {overall_churn:.2f}%")
    print(f"📊 ОБЩИЙ RETENTION RATE:        {overall_retention:.2f}%")
    print(f"📊 Среднее продлений (общее):   {overall_avg_renewals:.2f}")

    print("\n" + "=" * 80)
    print("✅ Анализ завершён!")
    print("=" * 80 + "\n")


if __name__ == '__main__':
    file_path = '/Users/nick/Downloads/Telegram Desktop/ChatExport_2026-02-12 (1)/result.json'
    analyze_subscriptions(file_path)
