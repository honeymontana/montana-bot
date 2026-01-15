import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config';
import { log } from '../utils/logger';
import { MembershipService } from '../services/MembershipService';
import { GroupRepository } from '../repositories/GroupRepository';
import { UserRepository } from '../repositories/UserRepository';
import { testConnection } from '../database/connection';
import { UserToRemove } from '../types';

export class MontanaBot {
  private bot: TelegramBot;
  private membershipService: MembershipService;
  private groupRepo: GroupRepository;
  private userRepo: UserRepository;
  private syncInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.bot = new TelegramBot(config.bot.token, {
      polling: config.bot.polling
    });

    this.membershipService = new MembershipService(this.bot);
    this.groupRepo = new GroupRepository();
    this.userRepo = new UserRepository();
  }

  async start(): Promise<void> {
    // Test database connection
    const dbConnected = await testConnection();
    if (!dbConnected) {
      throw new Error('Failed to connect to database');
    }

    // Initialize main group
    await this.initializeMainGroup();

    // Register event handlers
    this.registerHandlers();

    // Start periodic sync
    this.startPeriodicSync();

    // Set bot commands
    await this.setBotCommands();

    log.info('Montana Helper Bot started successfully');
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

    // Command: /groups
    this.bot.onText(/^\/groups/, async (msg) => {
      await this.handleGroupsList(msg);
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

    // Admin command: /addpermanentgroup [chat_id] [hours]
    this.bot.onText(/^\/addpermanentgroup(?:\s+(.+))?/, async (msg, match) => {
      await this.handleAddPermanentGroup(msg, match?.[1]);
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

    // Handle join requests
    this.bot.on('chat_join_request', async (request) => {
      await this.handleJoinRequest(request);
    });

    // Handle member left/kicked from chat
    this.bot.on('left_chat_member', async (msg) => {
      await this.handleMemberLeft(msg);
    });

    // Handle callback queries
    this.bot.on('callback_query', async (query) => {
      await this.handleCallbackQuery(query);
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
      is_premium: msg.from?.is_premium,
    });

    const welcomeMessage = `
Добро пожаловать в Montana Helper Bot! 🤖

Я помогаю управлять доступом к дополнительным чатам группы Montana.

Доступные команды:
/groups - Показать доступные группы
/status - Проверить ваш статус
/help - Показать эту справку

Чтобы получить доступ к дополнительным чатам, вы должны быть участником основной группы Montana.
    `;

    await this.bot.sendMessage(chatId, welcomeMessage.trim());
  }

  private async handleGroupsList(msg: TelegramBot.Message): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (!userId) return;

    const groups = await this.membershipService.getAvailableGroups(userId);

    if (groups.length === 0) {
      await this.bot.sendMessage(
        chatId,
        'У вас нет доступа к дополнительным группам. Убедитесь, что вы являетесь участником основной группы Montana.'
      );
      return;
    }

    // Create inline keyboard with groups
    const keyboard = {
      inline_keyboard: groups.map(group => [{
        text: group.title,
        callback_data: `join_${group.id}`
      }])
    };

    await this.bot.sendMessage(
      chatId,
      'Доступные группы:\nНажмите на группу, чтобы получить приглашение:',
      { reply_markup: keyboard }
    );
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

  private async handleCallbackQuery(query: TelegramBot.CallbackQuery): Promise<void> {
    const userId = query.from.id;
    const data = query.data;

    if (!data) return;

    if (data.startsWith('join_')) {
      const groupId = data.replace('join_', '');
      const success = await this.membershipService.addToManagedGroup(userId, groupId);

      if (success) {
        await this.bot.answerCallbackQuery(query.id, {
          text: 'Приглашение отправлено в личные сообщения!',
          show_alert: false,
        });
      } else {
        await this.bot.answerCallbackQuery(query.id, {
          text: 'Не удалось добавить в группу. Проверьте ваш статус в основной группе.',
          show_alert: true,
        });
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
      { command: 'groups', description: 'Показать доступные группы' },
      { command: 'status', description: 'Проверить ваш статус' },
      { command: 'help', description: 'Показать справку' },
    ];

    const adminCommands: TelegramBot.BotCommand[] = [
      ...commands,
      { command: 'sync', description: '[Admin] Синхронизировать членство' },
      { command: 'checkremoval', description: '[Admin] Проверить список на удаление' },
      { command: 'addgroup', description: '[Admin] Добавить группу' },
      { command: 'addpermanentgroup', description: '[Admin] Добавить постоянную группу' },
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

  async stop(): Promise<void> {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }

    await this.bot.stopPolling();
    log.info('Bot stopped');
  }
}