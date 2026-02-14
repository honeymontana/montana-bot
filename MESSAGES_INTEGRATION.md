# 🔧 Интеграция MessageService в Montana Bot

## Что сделано

✅ **Создан конфиг сообщений:** `config/messages.json`
✅ **Создан сервис:** `src/services/MessageService.ts`
✅ **Создана документация:** `config/README.md`

## Как использовать

### Импорт в MontanaBot.ts

```typescript
import { messageService } from '../services/MessageService';
```

### Примеры замены

#### 1. Простое сообщение

**БЫЛО:**
```typescript
await this.bot.sendMessage(chatId, 'У вас нет прав для выполнения этой команды.');
```

**СТАЛО:**
```typescript
await this.bot.sendMessage(chatId, messageService.get('errors.unauthorized'));
```

#### 2. Сообщение с параметрами

**БЫЛО:**
```typescript
await this.bot.sendMessage(
  chatId,
  `✅ Синхронизация завершена. Удалено пользователей: ${usersToRemove.length}`
);
```

**СТАЛО:**
```typescript
await this.bot.sendMessage(
  chatId,
  messageService.get('sync.complete', { count: usersToRemove.length })
);
```

#### 3. Приветственное сообщение

**БЫЛО:**
```typescript
const welcomeMessage = `
👋 Добро пожаловать в Montana Helper Bot!

Я помогаю управлять доступом...
...
`;
await this.bot.sendMessage(chatId, welcomeMessage.trim());
```

**СТАЛО:**
```typescript
await this.bot.sendMessage(chatId, messageService.getWelcomeMessage());
```

#### 4. Справка /help

**БЫЛО:**
```typescript
let helpMessage = `📚 Montana Helper Bot - Справка\n\n...`;
if (isAdmin) {
  helpMessage += `\n*Админ команды:*\n...`;
}
await this.bot.sendMessage(chatId, helpMessage.trim(), { parse_mode: 'Markdown' });
```

**СТАЛО:**
```typescript
const isAdmin = this.isAdmin(userId);
await this.bot.sendMessage(
  chatId,
  messageService.getHelpMessage(isAdmin, config.discord.enabled),
  { parse_mode: 'Markdown' }
);
```

#### 5. Статистика /mystats

**БЫЛО:**
```typescript
let statsMessage = `📊 *Ваша статистика*\n\n`;
statsMessage += `👤 *Профиль:*\n`;
statsMessage += `• User ID: \`${userId}\`\n`;
// ... много строк
```

**СТАЛО:**
```typescript
const message = messageService.getMyStatsMessage({
  userId,
  username: user?.username,
  isInMainGroup,
  permanentGroups,
  regularGroups
});
await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
```

#### 6. Список групп /listgroups

**БЫЛО:**
```typescript
let message = `📋 *Список всех групп*\n\n`;
message += `📊 Всего: ${allGroups.length} групп\n\n`;
// ... куча условий и конкатенаций
```

**СТАЛО:**
```typescript
const message = messageService.getListGroupsMessage({
  mainGroup,
  permanentGroups,
  regularGroups,
  inactiveGroups,
  total: allGroups.length
});
await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
```

## Полный пример рефакторинга

### handleHelp() - ДО

```typescript
private async handleHelp(msg: TelegramBot.Message): Promise<void> {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;

  if (!userId) return;

  const isAdmin = this.isAdmin(userId);

  let helpMessage = `
📚 *Montana Helper Bot - Справка*

*Доступные команды:*

🏠 /start - Начать работу с ботом
📊 /status - Проверить статус подписки
📈 /mystats - Ваша персональная статистика
❓ /help - Показать эту справку`;

  if (config.discord.enabled) {
    helpMessage += `

*Discord интеграция:*
🔗 /linkdiscord - Привязать Discord через OAuth
// ... ещё 20 строк
`;
  }

  if (isAdmin) {
    helpMessage += `

*Админ команды:*
🔄 /sync - Синхронизация членства
// ... ещё 30 строк
`;
  }

  await this.bot.sendMessage(chatId, helpMessage.trim(), { parse_mode: 'Markdown' });
}
```

### handleHelp() - ПОСЛЕ

```typescript
private async handleHelp(msg: TelegramBot.Message): Promise<void> {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;

  if (!userId) return;

  const isAdmin = this.isAdmin(userId);
  const message = messageService.getHelpMessage(isAdmin, config.discord.enabled);

  await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
}
```

**Результат:** С 50+ строк до 10 строк! 🎉

## Список методов MessageService

### Базовые методы

```typescript
// Получить сообщение по пути
messageService.get('path.to.message')
messageService.get('path.to.message', { param: 'value' })

// Приветствие
messageService.getWelcomeMessage()

// Справка
messageService.getHelpMessage(isAdmin, discordEnabled)

// Статистика пользователя
messageService.getMyStatsMessage({
  userId,
  username?,
  isInMainGroup,
  permanentGroups,
  regularGroups
})

// Список групп
messageService.getListGroupsMessage({
  mainGroup?,
  permanentGroups,
  regularGroups,
  inactiveGroups,
  total
})
```

## Путь к сообщениям

Структура `messages.json`:

```
welcome.*         - Приветствие
help.*            - Справка
status.*          - Статус
mystats.*         - Статистика
listgroups.*      - Список групп
sync.*            - Синхронизация
checkremoval.*    - Проверка удалений
addgroup.*        - Добавление группы
addpermanentgroup.* - Добавление постоянной группы
removegroup.*     - Удаление группы
updategroup.*     - Обновление группы
syncgroup.*       - Синхронизация группы
fullsync.*        - Полная синхронизация
discord.*         - Discord команды
errors.*          - Ошибки
notifications.*   - Уведомления
```

## План рефакторинга

### Этап 1: Простые замены (30 минут)
1. ✅ Импортировать `messageService`
2. Заменить `errors.unauthorized`
3. Заменить `sync.start`, `sync.complete`
4. Заменить `checkremoval.checking`, `checkremoval.all_good`

### Этап 2: Команды (1 час)
5. Рефакторить `handleHelp()`
6. Рефакторить `handleMyStats()`
7. Рефакторить `handleListGroups()`
8. Рефакторить `handleStart()`

### Этап 3: Сложные сообщения (1 час)
9. Рефакторить `handleAddGroup()`
10. Рефакторить `handleAddPermanentGroup()`
11. Рефакторить `handleUpdateGroup()`
12. Рефакторить Discord команды

### Этап 4: Тестирование (30 минут)
13. Протестировать все команды
14. Проверить параметры
15. Убедиться что эмодзи отображаются

## Преимущества

✅ **Удобное редактирование** - тексты в одном файле
✅ **Чистый код** - меньше конкатенации строк
✅ **Переводы** - легко добавить другие языки
✅ **Поддержка** - не нужно искать тексты в коде
✅ **Тестирование** - можно менять тексты без пересборки

## Следующие шаги

### Опционально: Поддержка языков

Можно расширить до мультиязычности:

```
config/
  messages.ru.json  ← Русский (текущий)
  messages.en.json  ← Английский
```

```typescript
class MessageService {
  constructor(lang: 'ru' | 'en' = 'ru') {
    const messagesPath = path.join(__dirname, `../../config/messages.${lang}.json`);
    // ...
  }
}
```

### Опционально: Markdown хелперы

Добавить удобные форматтеры:

```typescript
class MessageService {
  bold(text: string): string {
    return `*${text}*`;
  }

  code(text: string): string {
    return `\`${text}\``;
  }

  link(text: string, url: string): string {
    return `[${text}](${url})`;
  }
}
```

---

**Готово! 🎉**

Теперь все тексты бота можно редактировать в `config/messages.json` без изменения кода!
