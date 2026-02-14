# Настройка Discord OAuth для Montana Bot

## 1. Создание Discord приложения

1. Перейди на https://discord.com/developers/applications
2. Нажми **"New Application"**
3. Введи название (например, "Montana Helper")
4. Нажми **"Create"**

## 2. Настройка Bot

1. В левом меню выбери **"Bot"**
2. Нажми **"Reset Token"** (или "Add Bot" если бота ещё нет)
3. **Скопируй токен** (формат: `MTIzNDU2Nzg5MDEyMzQ1Njc4OQ.GaBcDe.AbCdEfGhIjKlMnOpQrStUvWxYz`)
4. Включи следующие настройки:
   - ✅ **Presence Intent**
   - ✅ **Server Members Intent**
   - ✅ **Message Content Intent**
5. В разделе **Authorization Flow:**
   - ✅ **PUBLIC BOT** (выключить, если хочешь чтобы только ты мог добавлять бота)
6. Нажми **"Save Changes"**

## 3. Настройка OAuth2

1. В левом меню выбери **"OAuth2"** → **"General"**
2. **Client ID** - скопируй (это просто Application ID)
3. Нажми **"Reset Secret"** и **скопируй Client Secret**
4. В разделе **"Redirects"** добавь:
   ```
   http://localhost:8080/auth/discord/callback
   ```
   (или твой публичный домен если есть)
5. Нажми **"Save Changes"**

## 4. Добавление бота на сервер

1. В левом меню выбери **"OAuth2"** → **"URL Generator"**
2. В **SCOPES** выбери:
   - ✅ `bot`
   - ✅ `identify`
   - ✅ `guilds`
3. В **BOT PERMISSIONS** выбери:
   - ✅ **Manage Roles** (для выдачи ролей)
   - ✅ **View Channels**
   - ✅ **Send Messages**
4. Скопируй **Generated URL** внизу и открой в браузере
5. Выбери свой сервер и нажми **"Authorize"**

## 5. Получение Guild ID и Role ID

### Guild ID (ID сервера):
1. Открой Discord
2. **User Settings** → **Advanced** → включи **"Developer Mode"**
3. ПКМ на название сервера → **"Copy Server ID"**

### Role ID (ID роли для Montana участников):
1. На сервере: **Server Settings** → **Roles**
2. Создай роль (например, "Montana Member") или выбери существующую
3. ПКМ на роль → **"Copy Role ID"**
4. **Важно:** Роль бота должна быть **выше** роли Montana Member в иерархии!

## 6. Обновление .env файла

Вставь полученные значения в `.env`:

```bash
# Discord Integration
DISCORD_ENABLED=true
DISCORD_BOT_TOKEN=<токен из шага 2>
DISCORD_CLIENT_ID=<Application ID из шага 3>
DISCORD_CLIENT_SECRET=<Client Secret из шага 3>
DISCORD_GUILD_ID=<Guild ID из шага 5>
DISCORD_MEMBER_ROLE_ID=<Role ID из шага 5>
DISCORD_REDIRECT_URI=http://localhost:8080/auth/discord/callback
OAUTH_PORT=8080
```

## 7. Перезапуск бота

После обновления `.env` перезапусти бота:
```bash
# Останови текущий процесс (Ctrl+C)
# Затем запусти заново:
npm run dev
```

## Проверка

После перезапуска в логах должно появиться:
```
✅ Discord integration initialized successfully
✅ Discord OAuth server started on port 8080
```

Теперь можно использовать `/linkdiscord` в Telegram боте!

## Troubleshooting

### Ошибка "An invalid token was provided"
- Проверь что `DISCORD_BOT_TOKEN` правильный (начинается с букв и цифр, содержит точки)
- Убедись что скопировал весь токен полностью
- Попробуй сгенерировать новый токен

### OAuth сервер не запускается
- Проверь что порт 8080 свободен: `lsof -i :8080`
- Убедись что `DISCORD_ENABLED=true`

### Роль не выдаётся автоматически
- Убедись что роль бота выше роли Montana Member в Server Settings → Roles
- Проверь что бот имеет право "Manage Roles"
