#!/bin/bash
echo "Мониторинг статуса токена бота..."
echo "Нажмите Ctrl+C для остановки"
echo ""

while true; do
    timestamp=$(date '+%H:%M:%S')
    status=$(curl -s "https://api.telegram.org/bot7831132623:AAEaBX-1eOFRtYFXt3BN2xpitg5D7hBs24A/getMe")
    
    if echo "$status" | grep -q '"ok":true'; then
        echo "[$timestamp] ✅ Токен активен! Можно запускать бота."
        exit 0
    elif echo "$status" | grep -q "Logged out"; then
        echo "[$timestamp] ⏳ Токен ещё заблокирован, ждём..."
    else
        echo "[$timestamp] ❓ Неизвестный статус: $status"
    fi
    
    sleep 60
done
