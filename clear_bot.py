#!/usr/bin/env python3
"""
Скрипт для сброса статуса Telegram бота
"""

import requests
import time
import sys

# Токен бота (из переменной окружения или напрямую)
BOT_TOKEN = "7831132623:AAEaBX-1eOFRtYFXt3BN2xpitg5D7hBs24A"
BASE_URL = f"https://api.telegram.org/bot{BOT_TOKEN}"

def get_webhook_info():
    """Получить информацию о вебхуке"""
    response = requests.get(f"{BASE_URL}/getWebhookInfo")
    data = response.json()
    print(f"Webhook Info: {data}")
    return data

def delete_webhook():
    """Удалить вебхук"""
    response = requests.get(f"{BASE_URL}/deleteWebhook?drop_pending_updates=true")
    data = response.json()
    print(f"Delete Webhook: {data}")
    return data

def get_me():
    """Получить информацию о боте"""
    response = requests.get(f"{BASE_URL}/getMe")
    data = response.json()
    print(f"Bot Info: {data}")
    return data

if __name__ == "__main__":
    print("=== Проверка статуса Telegram бота ===\n")

    print("1. Получаем информацию о боте...")
    try:
        bot_info = get_me()
        if bot_info.get("ok"):
            print(f"✅ Бот активен: @{bot_info['result']['username']}\n")
        else:
            print(f"❌ Ошибка: {bot_info.get('description', 'Unknown error')}\n")
            sys.exit(1)
    except Exception as e:
        print(f"❌ Не удалось получить информацию о боте: {e}\n")
        sys.exit(1)

    print("2. Проверяем webhook...")
    webhook_info = get_webhook_info()
    print()

    print("3. Удаляем webhook (если есть)...")
    delete_result = delete_webhook()
    print()

    print("4. Ждём 5 секунд для применения изменений...")
    time.sleep(5)
    print()

    print("5. Проверяем webhook ещё раз...")
    webhook_info = get_webhook_info()
    print()

    print("✅ Готово! Теперь можно запускать бота.")
