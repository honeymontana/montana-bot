# Чеклист для деплоя Montana Telegram Bot

## Перед деплоем

### 1. Настройка окружения
- [ ] Скопировать `.env.example` в `.env`
- [ ] Заполнить `BOT_TOKEN` от @BotFather
- [ ] Указать `MAIN_GROUP_ID` основной группы Montana
- [ ] Добавить `ADMIN_IDS` (ваш Telegram ID)
- [ ] Настроить параметры базы данных (если нужно)
- [ ] **ВАЖНО:** Установить `TEST_MODE=false` для продакшна

### 2. Telegram Bot настройки
- [ ] Создать бота через @BotFather
- [ ] Добавить бота администратором в основную группу Montana
- [ ] Добавить бота администратором во все управляемые группы
- [ ] Убедиться что у бота есть права:
  - Удалять сообщения
  - Банить пользователей
  - Одобрять заявки на вступление
  - Создавать invite links

### 3. База данных
- [ ] PostgreSQL 16+ установлен
- [ ] База данных создана
- [ ] Схема инициализирована из `init-db.sql`
- [ ] Проверены права доступа
- [ ] Если обновление существующей БД - выполнить миграции из `migrations/`

### 4. MTProto API (опционально для /fullsync)
- [ ] Получить API_ID и API_HASH с https://my.telegram.org/apps
- [ ] Указать телефон в TELEGRAM_PHONE_NUMBER
- [ ] При первом запуске ввести код подтверждения

## Деплой

### Вариант 1: Docker Compose (рекомендуется)

```bash
# 1. Клонировать репозиторий
git clone <repository-url>
cd montana-tg-bot

# 2. Настроить .env
cp .env.example .env
nano .env

# 3. Запустить
docker-compose up -d

# 4. Проверить логи
docker-compose logs -f bot
```

### Вариант 2: Локальный запуск

```bash
# 1. Установить зависимости
yarn install

# 2. Запустить PostgreSQL отдельно
docker-compose -f docker-compose.dev.yml up -d

# 3. Настроить .env (изменить DB_HOST на localhost)
cp .env.example .env
nano .env

# 4. Инициализировать базу данных
psql -U montana -d montana_bot -f init-db.sql

# 5. Запустить бота
yarn build
yarn start
```

## После деплоя

### 1. Проверка работоспособности
- [ ] Бот отвечает на команду /start
- [ ] Основная группа определяется корректно
- [ ] Команда /status показывает правильные данные
- [ ] Админские команды доступны только админам

### 2. Добавление групп
В каждой группе, которую нужно управлять:
```
/addgroup              - для обычной группы
/addgroup 48           - с окном доступа 48 часов
```

Или через ЛС с ботом:
```
/addgroup -1001234567890           - без ограничения времени
/addgroup -1001234567890 48        - с окном доступа 48 часов
```

### 3. Обновление настроек группы
Если нужно изменить ограничение по времени:
```
/updategroup -1001234567890 unlimited   - снять ограничение времени
/updategroup -1001234567890 72          - установить новое окно 72 часа
```

### 4. Тестирование
- [ ] Попросить тестового пользователя вступить в Montana
- [ ] Проверить автоматическое одобрение в управляемую группу
- [ ] Попросить тестового пользователя выйти из Montana
- [ ] Проверить автоматическое удаление (если TEST_MODE=false)

### 5. Мониторинг
```bash
# Логи
docker-compose logs -f bot

# Статус контейнеров
docker-compose ps

# Проверка БД
docker-compose exec postgres psql -U montana -d montana_bot
```

## Обновление

```bash
# Остановить бота
docker-compose down

# Получить обновления
git pull

# Применить миграции базы данных (если есть новые)
docker-compose exec postgres psql -U montana montana_bot -f /migrations/001_add_group_access_features.sql

# Или локально:
# psql -U montana -d montana_bot -f migrations/001_add_group_access_features.sql

# Перезапустить
docker-compose up -d --build

# Проверить логи
docker-compose logs -f bot
```

## Откат

```bash
# Вернуться к предыдущей версии
git log --oneline
git checkout <previous-commit-hash>
docker-compose up -d --build
```

## Бэкап базы данных

```bash
# Создать бэкап
docker-compose exec postgres pg_dump -U montana montana_bot > backup_$(date +%Y%m%d).sql

# Восстановить из бэкапа
docker-compose exec -T postgres psql -U montana montana_bot < backup_20260113.sql
```

## Важные замечания

⚠️ **TEST_MODE**
- В тестовом режиме пользователи НЕ удаляются
- Используйте `/checkremoval` для проверки
- Переключите на `TEST_MODE=false` только после тестирования

⚠️ **Права бота**
- Бот должен быть администратором во ВСЕХ группах
- Без прав администратора функционал не работает

⚠️ **Постоянные группы**
- Пользователи НЕ удаляются даже при выходе из Montana
- Используйте только для контента с пожизненным доступом

⚠️ **Ограничение времени доступа**
- `access_duration_hours` - это окно для ВСТУПЛЕНИЯ
- После вступления пользователь не удаляется по истечению времени
- Время считается с момента добавления группы в систему
