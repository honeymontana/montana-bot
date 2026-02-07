import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config';
import { log } from '../utils/logger';
import { MembershipService } from '../services/MembershipService';
import { GroupRepository } from '../repositories/GroupRepository';
import { UserRepository } from '../repositories/UserRepository';
import { DiscordRepository } from '../repositories/DiscordRepository';
import { DiscordService } from '../services/DiscordService';
import { DiscordOAuthServer } from '../services/DiscordOAuthServer';
import { testConnection } from '../database/connection';
import { UserToRemove } from '../types';

export class MontanaBot {
  private bot: TelegramBot;
  private membershipService: MembershipService;
  private groupRepo: GroupRepository;
  private userRepo: UserRepository;
  private discordRepo: DiscordRepository;
  private discordService: DiscordService | null = null;
  private discordOAuthServer: DiscordOAuthServer | null = null;
  private syncInterval: NodeJS.Timeout | null = null;
  private discordSyncInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.bot = new TelegramBot(config.bot.token, {
      polling: config.bot.polling
    });

    this.membershipService = new MembershipService(this.bot);
    this.groupRepo = new GroupRepository();
    this.userRepo = new UserRepository();
    this.discordRepo = new DiscordRepository();
  }

  async start(): Promise<void> {
    // Test database connection
    const dbConnected = await testConnection();
    if (!dbConnected) {
      throw new Error('Failed to connect to database');
    }

    // Initialize main group
    await this.initializeMainGroup();

    // Initialize Discord integration if enabled
    await this.initializeDiscord();

    // Register event handlers
    this.registerHandlers();

    // Start periodic sync
    this.startPeriodicSync();

    // Set bot commands
    await this.setBotCommands();

    log.info('Montana Helper Bot started successfully');
  }

  private async initializeDiscord(): Promise<void> {
    if (!config.discord.enabled) {
      log.info('Discord integration is disabled');
      return;
    }

    try {
      // Initialize Discord service
      this.discordService = new DiscordService();
      const connected = await this.discordService.connect();

      if (!connected) {
        log.error('Failed to connect Discord service');
        return;
      }

      // Initialize OAuth server
      this.discordOAuthServer = new DiscordOAuthServer(this.bot, this.discordService);
      this.discordOAuthServer.start();

      // Start periodic Discord role sync
      this.startDiscordRoleSync();

      log.info('Discord integration initialized successfully');
    } catch (error) {
      log.error('Failed to initialize Discord integration', error);
    }
  }

  private async initializeMainGroup(): Promise<void> {
    try {
      const mainGroupId = parseInt(config.telegram.mainGroupId);
      const chat = await this.bot.getChat(mainGroupId);

      await this.groupRepo.create({
        chat_id: mainGroupId,
        title: chat.title || 'Main Group',
        username: chat.username,
        description: chat.description,
        is_active: true,
        is_main_group: true,
      });

      log.info('Main group initialized', {
        chatId: mainGroupId,
        title: chat.title
      });
    } catch (error) {
      log.error('Failed to initialize main group', error);
    }
  }

  private registerHandlers(): void {
    // Log all incoming messages for debugging
    this.bot.on('message', (msg) => {
      if (msg.text && msg.text.startsWith('/')) {
        log.info('Command received', {
          command: msg.text,
          userId: msg.from?.id,
          username: msg.from?.username,
          chatId: msg.chat.id,
          chatType: msg.chat.type
        });
      }
    });

    // Command: /start
    this.bot.onText(/^\/start/, async (msg) => {
      await this.handleStart(msg);
    });

    // Command: /status
    this.bot.onText(/^\/status/, async (msg) => {
      await this.handleStatus(msg);
    });

    // Admin command: /sync
    this.bot.onText(/^\/sync/, async (msg) => {
      await this.handleSync(msg);
    });

    // Admin command: /checkremoval
    this.bot.onText(/^\/checkremoval/, async (msg) => {
      await this.handleCheckRemoval(msg);
    });

    // Admin command: /addgroup [chat_id] [hours]
    this.bot.onText(/^\/addgroup(?:\s+(.+))?/, async (msg, match) => {
      await this.handleAddGroup(msg, match?.[1]);
    });

    // Admin command: /removegroup
    this.bot.onText(/^\/removegroup (.+)/, async (msg, match) => {
      await this.handleRemoveGroup(msg, match![1]);
    });

    // Admin command: /syncgroup
    this.bot.onText(/^\/syncgroup/, async (msg) => {
      await this.handleSyncGroup(msg);
    });

    // Admin command: /fullsync
    this.bot.onText(/^\/fullsync/, async (msg) => {
      await this.handleFullSync(msg);
    });

    // Admin command: /updategroup <chat_id> [hours|unlimited]
    this.bot.onText(/^\/updategroup(?:\s+(.+))?/, async (msg, match) => {
      await this.handleUpdateGroup(msg, match?.[1]);
    });

    // Discord command: /linkdiscord
    this.bot.onText(/^\/linkdiscord/, async (msg) => {
      await this.handleLinkDiscord(msg);
    });

    // Discord command: /unlinkdiscord
    this.bot.onText(/^\/unlinkdiscord/, async (msg) => {
      await this.handleUnlinkDiscord(msg);
    });

    // Discord command: /discordstatus
    this.bot.onText(/^\/discordstatus/, async (msg) => {
      await this.handleDiscordStatus(msg);
    });

    // Handle join requests
    this.bot.on('chat_join_request', async (request) => {
      await this.handleJoinRequest(request);
    });

    // Handle member left/kicked from chat
    this.bot.on('left_chat_member', async (msg) => {
      await this.handleMemberLeft(msg);
    });

    // Error handling
    this.bot.on('polling_error', (error) => {
      log.error('Polling error', error);
    });

    this.bot.on('error', (error) => {
      log.error('Bot error', error);
    });
  }

  private async handleStart(msg: TelegramBot.Message): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (!userId) return;

    // Save user to database
    await this.userRepo.create({
      id: userId,
      username: msg.from?.username,
      first_name: msg.from?.first_name,
      last_name: msg.from?.last_name,
      is_bot: msg.from?.is_bot || false,
      language_code: msg.from?.language_code,
      is_premium: (msg.from as any)?.is_premium,
    });

    const welcomeMessage = `
Добро пожаловать в Montana Helper Bot! 🤖

Я автоматически управляю доступом к чатам на основе вашей подписки в группе Montana.

Доступные команды:
/status - Проверить ваш статус подписки

Как это работает:
1. Состоите в Montana - автоматически одобряется заявка на вступление в чат
2. Выходите из Montana - автоматически удаляетесь из всех чатов
3. Нет подписки - заявки отклоняются
    `;

    await this.bot.sendMessage(chatId, welcomeMessage.trim());
  }


  private async handleStatus(msg: TelegramBot.Message): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (!userId) return;

    const { isInMainGroup, user } = await this.membershipService.checkMainGroupMembership(userId);
    const userGroups = await this.userRepo.getUserGroups(userId);

    let statusMessage = `📊 Ваш статус:\n\n`;
    statusMessage += `Основная группа: ${isInMainGroup ? '✅ Участник' : '❌ Не участник'}\n`;

    if (userGroups.length > 0) {
      statusMessage += `\nВаши группы:\n`;
      for (const group of userGroups) {
        statusMessage += `• ${group.title}\n`;
      }
    } else {
      statusMessage += `\nВы не состоите в дополнительных группах.`;
    }

    await this.bot.sendMessage(chatId, statusMessage);
  }

  private async handleSync(msg: TelegramBot.Message): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (!userId || !this.isAdmin(userId)) {
      log.warn('Unauthorized /sync attempt', { userId, chatId, username: msg.from?.username });
      await this.bot.sendMessage(chatId, 'У вас нет прав для выполнения этой команды.');
      return;
    }

    await this.bot.sendMessage(chatId, 'Начинаю синхронизацию членства...');
    const usersToRemove = await this.membershipService.syncMemberships();

    if (config.telegram.testMode && usersToRemove.length > 0) {
      const message = this.formatRemovalList(usersToRemove);
      await this.bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
    } else if (config.telegram.testMode) {
      await this.bot.sendMessage(chatId, '✅ Синхронизация завершена (ТЕСТ). Пользователей для удаления не найдено.');
    } else {
      await this.bot.sendMessage(chatId, `✅ Синхронизация завершена. Удалено пользователей: ${usersToRemove.length}`);
    }
  }

  private async handleAddGroup(msg: TelegramBot.Message, params?: string): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (!userId || !this.isAdmin(userId)) {
      await this.bot.sendMessage(chatId, 'У вас нет прав для выполнения этой команды.');
      return;
    }

    // Parse parameters: <chat_id> [hours]
    let targetChatId: number;
    let accessDurationHours: number | null = null;

    if (msg.chat.type === 'private') {
      // In private chat, chat_id is required
      if (!params) {
        await this.bot.sendMessage(
          chatId,
          'Использование: /addgroup <chat_id> [часы]\n\n' +
          'Примеры:\n' +
          '/addgroup -1001234567890 - добавить группу без ограничения времени\n' +
          '/addgroup -1001234567890 48 - доступ только 48 часов с момента добавления'
        );
        return;
      }

      const parts = params.trim().split(/\s+/);
      targetChatId = parseInt(parts[0]);
      if (parts[1]) {
        accessDurationHours = parseInt(parts[1]);
      }

      if (isNaN(targetChatId)) {
        await this.bot.sendMessage(chatId, '❌ Некорректный ID группы.');
        return;
      }
    } else {
      // In group chat, use current chat
      targetChatId = chatId;

      // Parse hours if provided
      if (params) {
        const hours = parseInt(params.trim());
        if (!isNaN(hours)) {
          accessDurationHours = hours;
        }
      }
    }

    try {
      const chat = await this.bot.getChat(targetChatId);
      const group = await this.groupRepo.create({
        chat_id: targetChatId,
        title: chat.title || 'Unknown',
        username: chat.username,
        description: chat.description,
        is_active: true,
        is_main_group: false,
        is_permanent: false,
        access_duration_hours: accessDurationHours,
      });

      let responseMsg = `✅ Группа "${group.title}" добавлена в систему управления.`;
      if (accessDurationHours) {
        responseMsg += `\n\n⏰ Доступ ограничен: ${accessDurationHours} часов с момента добавления.`;
      }

      await this.bot.sendMessage(chatId, responseMsg);
    } catch (error) {
      log.error('Failed to add group', { chatId: targetChatId, error });
      await this.bot.sendMessage(
        chatId,
        '❌ Не удалось добавить группу. Проверьте права бота и корректность ID группы.'
      );
    }
  }

  private async handleAddPermanentGroup(msg: TelegramBot.Message, params?: string): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (!userId || !this.isAdmin(userId)) {
      log.warn('Unauthorized /addpermanentgroup attempt', { userId, chatId, username: msg.from?.username });
      await this.bot.sendMessage(chatId, 'У вас нет прав для выполнения этой команды.');
      return;
    }

    // Parse parameters: <chat_id> [hours]
    let targetChatId: number;
    let accessDurationHours: number | null = null;

    if (msg.chat.type === 'private') {
      // In private chat, chat_id is required
      if (!params) {
        await this.bot.sendMessage(
          chatId,
          'Использование: /addpermanentgroup <chat_id> [часы]\n\n' +
          'Примеры:\n' +
          '/addpermanentgroup -1001234567890 - постоянная группа без ограничения времени\n' +
          '/addpermanentgroup -1001234567890 48 - окно для вступления 48 часов'
        );
        return;
      }

      const parts = params.trim().split(/\s+/);
      targetChatId = parseInt(parts[0]);
      if (parts[1]) {
        accessDurationHours = parseInt(parts[1]);
      }

      if (isNaN(targetChatId)) {
        await this.bot.sendMessage(chatId, '❌ Некорректный ID группы.');
        return;
      }
    } else {
      // In group chat, use current chat
      targetChatId = chatId;

      // Parse hours if provided
      if (params) {
        const hours = parseInt(params.trim());
        if (!isNaN(hours)) {
          accessDurationHours = hours;
        }
      }
    }

    try {
      const chat = await this.bot.getChat(targetChatId);
      const group = await this.groupRepo.create({
        chat_id: targetChatId,
        title: chat.title || 'Unknown',
        username: chat.username,
        description: chat.description,
        is_active: true,
        is_main_group: false,
        is_permanent: true,
        access_duration_hours: accessDurationHours,
      });

      let responseMsg = `✅ Группа "${group.title}" добавлена как ПОСТОЯННАЯ.\n\n🔒 Пользователи получат пожизненный доступ после проверки членства в Montana.\n💡 Даже если пользователь выйдет из Montana, он останется в этой группе.`;

      if (accessDurationHours) {
        responseMsg += `\n\n⏰ Окно для вступления: ${accessDurationHours} часов с момента добавления группы.`;
      }

      await this.bot.sendMessage(chatId, responseMsg);

      log.info('Permanent group added', { chatId: targetChatId, title: group.title, accessDurationHours });
    } catch (error) {
      log.error('Failed to add permanent group', { chatId: targetChatId, error });
      await this.bot.sendMessage(
        chatId,
        '❌ Не удалось добавить группу. Проверьте права бота и корректность ID группы.'
      );
    }
  }

  private async handleRemoveGroup(msg: TelegramBot.Message, groupId: string): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (!userId || !this.isAdmin(userId)) {
      await this.bot.sendMessage(chatId, 'У вас нет прав для выполнения этой команды.');
      return;
    }

    const success = await this.groupRepo.setActive(groupId, false);

    if (success) {
      await this.bot.sendMessage(chatId, '✅ Группа деактивирована.');
    } else {
      await this.bot.sendMessage(chatId, '❌ Группа не найдена.');
    }
  }

  private async handleUpdateGroup(msg: TelegramBot.Message, params?: string): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (!userId || !this.isAdmin(userId)) {
      await this.bot.sendMessage(chatId, 'У вас нет прав для выполнения этой команды.');
      return;
    }

    if (!params) {
      await this.bot.sendMessage(
        chatId,
        'Использование: /updategroup <chat_id> [часы|unlimited]\n\n' +
        'Примеры:\n' +
        '/updategroup -1001234567890 unlimited - убрать ограничение времени\n' +
        '/updategroup -1001234567890 72 - установить окно доступа 72 часа с текущего момента'
      );
      return;
    }

    const parts = params.trim().split(/\s+/);
    const targetChatId = parseInt(parts[0]);

    if (isNaN(targetChatId)) {
      await this.bot.sendMessage(chatId, '❌ Неверный формат chat_id');
      return;
    }

    const group = await this.groupRepo.findByChatId(targetChatId);
    if (!group) {
      await this.bot.sendMessage(chatId, '❌ Группа не найдена в базе данных. Сначала добавьте её через /addgroup');
      return;
    }

    let accessDurationHours: number | null = null;
    if (parts[1]) {
      if (parts[1].toLowerCase() === 'unlimited') {
        accessDurationHours = null;
      } else {
        accessDurationHours = parseInt(parts[1]);
        if (isNaN(accessDurationHours)) {
          await this.bot.sendMessage(chatId, '❌ Неверный формат времени. Используйте число или "unlimited"');
          return;
        }
      }
    }

    // Update group with new access duration and reset created_at to NOW
    await this.groupRepo.update(group.id, {
      access_duration_hours: accessDurationHours
    });

    // Also reset created_at to current timestamp to restart the access window
    if (accessDurationHours !== null) {
      await this.groupRepo.resetGroupCreatedAt(group.id);
    }

    let message = `✅ Группа "${group.title}" обновлена.\n\n`;
    if (accessDurationHours === null) {
      message += '⏰ Ограничение по времени снято. Доступ без ограничений.';
    } else {
      message += `⏰ Новое окно доступа: ${accessDurationHours} часов с текущего момента.`;
    }

    await this.bot.sendMessage(chatId, message);
  }

  private async handleSyncGroup(msg: TelegramBot.Message): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (msg.chat.type === 'private') {
      await this.bot.sendMessage(
        chatId,
        'Эту команду нужно использовать в группе, которую вы хотите синхронизировать.'
      );
      return;
    }

    if (!userId || !this.isAdmin(userId)) {
      await this.bot.sendMessage(chatId, 'У вас нет прав для выполнения этой команды.');
      return;
    }

    await this.bot.sendMessage(chatId, '🔄 Синхронизирую участников группы...');

    const { synced, errors } = await this.membershipService.syncGroupMembers(chatId);

    await this.bot.sendMessage(
      chatId,
      `✅ Синхронизация завершена.\n\n📊 Синхронизировано администраторов: ${synced}\n❌ Ошибок: ${errors}\n\n⚠️ Обычные участники будут добавлены в базу по мере их активности в группе.`
    );
  }

  private async handleFullSync(msg: TelegramBot.Message): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (msg.chat.type === 'private') {
      await this.bot.sendMessage(
        chatId,
        'Эту команду нужно использовать в группе, которую вы хотите синхронизировать.'
      );
      return;
    }

    if (!userId || !this.isAdmin(userId)) {
      await this.bot.sendMessage(chatId, 'У вас нет прав для выполнения этой команды.');
      return;
    }

    await this.bot.sendMessage(chatId, '🔄 Запускаю ПОЛНУЮ синхронизацию (MTProto API)...\n\nЭто может занять несколько минут для больших групп.');

    const { synced, errors } = await this.membershipService.fullSyncGroupMembers(chatId);

    await this.bot.sendMessage(
      chatId,
      `✅ Полная синхронизация завершена!\n\n📊 Синхронизировано участников: ${synced}\n❌ Ошибок: ${errors}\n\n🎉 Теперь в базе все ${synced} участников!`
    );
  }

  private async handleJoinRequest(request: TelegramBot.ChatJoinRequest): Promise<void> {
    const userId = request.from.id;
    const chatId = request.chat.id;

    log.info('Processing join request', { userId, chatId });

    const result = await this.membershipService.processJoinRequest(
      userId,
      chatId,
      request.from
    );

    if (!result.approved) {
      await this.bot.declineChatJoinRequest(chatId, userId);

      // Send message to user with specific reason
      try {
        let message = '';

        if (result.reason === 'not_in_main_group') {
          message = 'Ваша заявка отклонена.\n\n' +
            'Для вступления в дополнительные группы необходимо быть участником основной группы Montana.';
        } else if (result.reason === 'access_window_closed') {
          message = 'Ваша заявка отклонена.\n\n' +
            '⏰ Окно для вступления в эту группу закрыто. Доступ к группе был ограничен по времени.';
        } else if (result.reason === 'already_member') {
          message = 'Ваша заявка отклонена.\n\n' +
            '✅ Вы уже являетесь участником этой группы. Повторная заявка не требуется.';
        } else {
          message = 'Ваша заявка отклонена.\n\n' +
            'Произошла ошибка при обработке вашей заявки. Пожалуйста, попробуйте позже.';
        }

        await this.bot.sendMessage(userId, message);
      } catch (error) {
        // User might have blocked the bot
        log.debug('Could not send rejection message to user', { userId });
      }
    }
  }

  private async handleMemberLeft(msg: TelegramBot.Message): Promise<void> {
    const leftMember = msg.left_chat_member;
    const chatId = msg.chat.id;

    if (!leftMember) return;

    log.info('Member left chat', {
      userId: leftMember.id,
      chatId,
      username: leftMember.username
    });

    // Check if this is the main group
    const mainGroupId = parseInt(config.telegram.mainGroupId);
    if (chatId === mainGroupId) {
      await this.membershipService.handleMainGroupLeave(leftMember.id);
    } else {
      // Update status in database for other groups
      const group = await this.groupRepo.findByChatId(chatId);
      if (group) {
        await this.userRepo.updateGroupStatus(leftMember.id, group.id, 'left');
      }
    }
  }


  private async handleCheckRemoval(msg: TelegramBot.Message): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (!userId || !this.isAdmin(userId)) {
      await this.bot.sendMessage(chatId, 'У вас нет прав для выполнения этой команды.');
      return;
    }

    await this.bot.sendMessage(chatId, '🔍 Проверяю пользователей...');
    const usersToRemove = await this.membershipService.syncMemberships();

    if (usersToRemove.length === 0) {
      await this.bot.sendMessage(chatId, '✅ Все пользователи в актуальном состоянии. Никого не нужно удалять.');
      return;
    }

    const message = this.formatRemovalList(usersToRemove);
    await this.bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
  }

  private formatRemovalList(users: UserToRemove[]): string {
    const testModeWarning = config.telegram.testMode
      ? '⚠️ <b>ТЕСТОВЫЙ РЕЖИМ - пользователи НЕ будут удалены!</b>\n\n'
      : '⚠️ <b>Следующие пользователи будут удалены:</b>\n\n';

    let message = testModeWarning;
    message += `📊 Всего пользователей к удалению: <b>${users.length}</b>\n\n`;

    users.forEach((user, index) => {
      const userName = user.username
        ? `@${user.username}`
        : `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Без имени';

      message += `${index + 1}. <b>${userName}</b> (ID: <code>${user.userId}</code>)\n`;
      message += `   Будет удален из групп:\n`;

      user.groups.forEach(group => {
        message += `   • ${group.groupTitle}\n`;
      });

      message += '\n';
    });

    if (config.telegram.testMode) {
      message += '\n💡 Для реального удаления установите TEST_MODE=false в .env';
    }

    return message;
  }

  private async setBotCommands(): Promise<void> {
    const commands: TelegramBot.BotCommand[] = [
      { command: 'start', description: 'Начать работу с ботом' },
      { command: 'status', description: 'Проверить ваш статус подписки' },
    ];

    // Add Discord commands if enabled
    if (config.discord.enabled) {
      commands.push(
        { command: 'linkdiscord', description: 'Привязать Discord аккаунт' },
        { command: 'unlinkdiscord', description: 'Отвязать Discord аккаунт' },
        { command: 'discordstatus', description: 'Проверить Discord статус' }
      );
    }

    const adminCommands: TelegramBot.BotCommand[] = [
      ...commands,
      { command: 'sync', description: '[Admin] Синхронизировать членство' },
      { command: 'checkremoval', description: '[Admin] Проверить список на удаление' },
      { command: 'addgroup', description: '[Admin] Добавить группу' },
      { command: 'removegroup', description: '[Admin] Удалить группу' },
      { command: 'syncgroup', description: '[Admin] Синхронизировать админов группы' },
      { command: 'fullsync', description: '[Admin] Полная синхронизация ВСЕХ участников' },
    ];

    try {
      // Set default commands
      await this.bot.setMyCommands(commands);

      // Set admin commands for admin users
      for (const adminId of config.telegram.adminIds) {
        await this.bot.setMyCommands(adminCommands, {
          scope: { type: 'chat', chat_id: adminId },
        });
      }

      log.info('Bot commands set successfully');
    } catch (error) {
      log.error('Failed to set bot commands', error);
    }
  }

  private startPeriodicSync(): void {
    const intervalMs = config.telegram.checkIntervalMinutes * 60 * 1000;

    this.syncInterval = setInterval(async () => {
      try {
        const usersToRemove = await this.membershipService.syncMemberships();

        // In test mode, notify admins about users that would be removed
        if (config.telegram.testMode && usersToRemove.length > 0) {
          const message = this.formatRemovalList(usersToRemove);

          for (const adminId of config.telegram.adminIds) {
            try {
              await this.bot.sendMessage(adminId, `🔄 Периодическая проверка\n\n${message}`, {
                parse_mode: 'HTML'
              });
            } catch (error) {
              log.error('Failed to send periodic sync notification to admin', { adminId, error });
            }
          }
        }
      } catch (error) {
        log.error('Periodic sync failed', error);
      }
    }, intervalMs);

    log.info(`Periodic sync started (every ${config.telegram.checkIntervalMinutes} minutes)${config.telegram.testMode ? ' [TEST MODE]' : ''}`);
  }

  private isAdmin(userId: number): boolean {
    return config.telegram.adminIds.includes(userId);
  }

  private async checkAdminAndReply(msg: TelegramBot.Message, commandName: string): Promise<boolean> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (!userId || !this.isAdmin(userId)) {
      log.warn(`Unauthorized ${commandName} attempt`, {
        userId,
        username: msg.from?.username,
        chatId,
        chatType: msg.chat.type,
        chatTitle: msg.chat.title
      });
      await this.bot.sendMessage(chatId, 'У вас нет прав для выполнения этой команды.');
      return false;
    }
    return true;
  }

  private async handleLinkDiscord(msg: TelegramBot.Message): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (!userId) return;

    if (!config.discord.enabled) {
      await this.bot.sendMessage(chatId, '❌ Discord интеграция отключена.');
      return;
    }

    if (!this.discordOAuthServer) {
      await this.bot.sendMessage(chatId, '❌ Discord OAuth сервер не запущен.');
      return;
    }

    // Check if already linked
    const existingLink = await this.discordRepo.findByTelegramId(userId);
    if (existingLink) {
      await this.bot.sendMessage(
        chatId,
        `⚠️ Ваш Telegram уже привязан к Discord аккаунту: ${existingLink.discord_username}\n\n` +
        `Если вы хотите привязать другой Discord аккаунт, сначала используйте /unlinkdiscord`
      );
      return;
    }

    const authUrl = this.discordOAuthServer.generateAuthUrl(userId);

    await this.bot.sendMessage(
      chatId,
      `🔗 Привязка Discord аккаунта\n\n` +
      `Нажмите на ссылку ниже, чтобы авторизоваться через Discord и привязать ваш аккаунт:\n\n` +
      `${authUrl}\n\n` +
      `После успешной авторизации вы получите подтверждение.`
    );
  }

  private async handleUnlinkDiscord(msg: TelegramBot.Message): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (!userId) return;

    if (!config.discord.enabled) {
      await this.bot.sendMessage(chatId, '❌ Discord интеграция отключена.');
      return;
    }

    const existingLink = await this.discordRepo.findByTelegramId(userId);
    if (!existingLink) {
      await this.bot.sendMessage(chatId, '❌ Ваш Telegram не привязан к Discord аккаунту.');
      return;
    }

    // Remove role from Discord if service is ready
    if (this.discordService && this.discordService.isReady()) {
      const roleId = config.discord.memberRoleId;
      if (roleId) {
        await this.discordService.removeRole(existingLink.discord_id, roleId);
      }
    }

    // Delete link from database
    await this.discordRepo.deleteByTelegramId(userId);

    await this.bot.sendMessage(
      chatId,
      `✅ Discord аккаунт ${existingLink.discord_username} успешно отвязан.\n\n` +
      `Вы можете привязать другой аккаунт с помощью команды /linkdiscord`
    );

    log.info('Discord account unlinked', {
      telegramId: userId,
      discordId: existingLink.discord_id,
      discordUsername: existingLink.discord_username
    });
  }

  private async handleDiscordStatus(msg: TelegramBot.Message): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (!userId) return;

    if (!config.discord.enabled) {
      await this.bot.sendMessage(chatId, '❌ Discord интеграция отключена.');
      return;
    }

    const link = await this.discordRepo.findByTelegramId(userId);

    if (!link) {
      await this.bot.sendMessage(
        chatId,
        `📊 Discord статус:\n\n` +
        `❌ Аккаунт не привязан\n\n` +
        `Используйте /linkdiscord для привязки вашего Discord аккаунта.`
      );
      return;
    }

    const { isInMainGroup } = await this.membershipService.checkMainGroupMembership(userId);

    let statusMessage = `📊 Discord статус:\n\n`;
    statusMessage += `✅ Привязанный Discord: ${link.discord_username}\n`;
    statusMessage += `🏷️ Discord ID: ${link.discord_id}\n`;
    statusMessage += `🎭 Montana членство: ${isInMainGroup ? '✅ Активно' : '❌ Не активно'}\n\n`;

    if (isInMainGroup) {
      statusMessage += `✨ У вас есть доступ к Montana Discord серверу!`;
    } else {
      statusMessage += `⚠️ Для доступа к Montana Discord серверу вступите в основную Telegram группу.`;
    }

    await this.bot.sendMessage(chatId, statusMessage);
  }

  private startDiscordRoleSync(): void {
    if (!this.discordService) {
      return;
    }

    const intervalMs = config.telegram.checkIntervalMinutes * 60 * 1000;

    this.discordSyncInterval = setInterval(async () => {
      try {
        if (this.discordService) {
          const result = await this.discordService.syncRoles();

          if (result.success) {
            log.info('Discord role sync completed', {
              added: result.added,
              removed: result.removed,
              errors: result.errors,
            });
          } else {
            log.error('Discord role sync failed');
          }
        }
      } catch (error) {
        log.error('Discord role sync error', error);
      }
    }, intervalMs);

    log.info(`Discord role sync started (every ${config.telegram.checkIntervalMinutes} minutes)`);
  }

  async stop(): Promise<void> {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }

    if (this.discordSyncInterval) {
      clearInterval(this.discordSyncInterval);
      this.discordSyncInterval = null;
    }

    if (this.discordService) {
      await this.discordService.disconnect();
    }

    await this.bot.stopPolling();
    log.info('Bot stopped');
  }
}