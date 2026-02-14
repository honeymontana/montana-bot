import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config';
import { log } from '../utils/logger';
import { MembershipService } from '../services/MembershipService';
import { GroupRepository } from '../repositories/GroupRepository';
import { UserRepository } from '../repositories/UserRepository';
import { DiscordRepository } from '../repositories/DiscordRepository';
import { DiscordService } from '../services/DiscordService';
import { testConnection } from '../database/connection';
import { UserToRemove } from '../types';

export class MontanaBot {
  private bot: TelegramBot;
  private membershipService: MembershipService;
  private groupRepo: GroupRepository;
  private userRepo: UserRepository;
  private discordRepo: DiscordRepository;
  private discordService: DiscordService | null = null;
  private syncInterval: NodeJS.Timeout | null = null;
  private discordSyncInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.bot = new TelegramBot(config.bot.token, {
      polling: config.bot.polling,
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
      // Initialize Discord service with Telegram bot instance
      this.discordService = new DiscordService(this.bot);
      const connected = await this.discordService.connect();

      if (!connected) {
        log.warn('Discord bot connection failed');
        return;
      }

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
        title: chat.title,
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
          chatType: msg.chat.type,
        });
      }
    });

    // Command: /start with deep link support
    this.bot.onText(/^\/start(?:\s+(.+))?$/, async (msg, match) => {
      await this.handleStart(msg, match?.[1]);
    });

    // Command: /help
    this.bot.onText(/^\/help/, async (msg) => {
      await this.handleHelp(msg);
    });

    // Command: /status
    this.bot.onText(/^\/status/, async (msg) => {
      await this.handleStatus(msg);
    });

    // Command: /mystats
    this.bot.onText(/^\/mystats/, async (msg) => {
      await this.handleMyStats(msg);
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

    // Admin command: /listgroups
    this.bot.onText(/^\/listgroups/, async (msg) => {
      await this.handleListGroups(msg);
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

    // Discord command: /discord [nickname|отвязать]
    this.bot.onText(/^\/discord(?:\s+(.+))?$/, async (msg, match) => {
      await this.handleDiscord(msg, match?.[1]);
    });

    // Handle join requests
    this.bot.on('chat_join_request', async (request) => {
      await this.handleJoinRequest(request);
    });

    // Handle member left/kicked from chat
    this.bot.on('left_chat_member', async (msg) => {
      await this.handleMemberLeft(msg);
    });

    // Handle callback queries (inline buttons)
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

  private async handleStart(msg: TelegramBot.Message, deepLinkParam?: string): Promise<void> {
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

    // Handle deep link parameters
    if (deepLinkParam) {
      log.info('Deep link accessed', { userId, param: deepLinkParam });

      // Discord link action
      if (deepLinkParam === 'discord' || deepLinkParam === 'linkdiscord') {
        await this.handleDiscord(msg, 'привязать');
        return;
      }

      // Referral link (например: start=ref_12345)
      if (deepLinkParam.startsWith('ref_')) {
        const referrerId = deepLinkParam.replace('ref_', '');
        await this.bot.sendMessage(chatId, `✅ Вы присоединились по реферальной ссылке!`);
        log.info('Referral link used', { userId, referrerId });
        // Здесь можно добавить логику начисления бонусов
      }

      // Promo code (например: start=promo_summer)
      if (deepLinkParam.startsWith('promo_')) {
        const promoCode = deepLinkParam.replace('promo_', '');
        await this.bot.sendMessage(chatId, `🎁 Промокод "${promoCode}" активирован!`);
        log.info('Promo code used', { userId, promoCode });
      }

      // Group invite (например: start=group_123456)
      if (deepLinkParam.startsWith('group_')) {
        const groupId = deepLinkParam.replace('group_', '');
        await this.bot.sendMessage(
          chatId,
          `Приглашение в группу #${groupId}\n\n` + `Используйте /status чтобы проверить доступ.`
        );
        log.info('Group invite link used', { userId, groupId });
      }
    }

    const welcomeMessage = `
Добро пожаловать в Montana Helper Bot! 🤖

Я автоматически управляю доступом к чатам на основе вашей подписки в группе Montana.

Доступные команды:
/status - Проверить ваш статус подписки${config.discord.enabled ? '\n/linkdiscord - Привязать Discord аккаунт' : ''}

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
      await this.bot.sendMessage(
        chatId,
        '✅ Синхронизация завершена (ТЕСТ). Пользователей для удаления не найдено.'
      );
    } else {
      await this.bot.sendMessage(
        chatId,
        `✅ Синхронизация завершена. Удалено пользователей: ${usersToRemove.length}`
      );
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
      log.warn('Unauthorized /addpermanentgroup attempt', {
        userId,
        chatId,
        username: msg.from?.username,
      });
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

      log.info('Permanent group added', {
        chatId: targetChatId,
        title: group.title,
        accessDurationHours,
      });
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
      await this.bot.sendMessage(
        chatId,
        '❌ Группа не найдена в базе данных. Сначала добавьте её через /addgroup'
      );
      return;
    }

    let accessDurationHours: number | null = null;
    if (parts[1]) {
      if (parts[1].toLowerCase() === 'unlimited') {
        accessDurationHours = null;
      } else {
        accessDurationHours = parseInt(parts[1]);
        if (isNaN(accessDurationHours)) {
          await this.bot.sendMessage(
            chatId,
            '❌ Неверный формат времени. Используйте число или "unlimited"'
          );
          return;
        }
      }
    }

    // Update group with new access duration and reset created_at to NOW
    await this.groupRepo.update(group.id, {
      access_duration_hours: accessDurationHours,
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

    await this.bot.sendMessage(
      chatId,
      '🔄 Запускаю ПОЛНУЮ синхронизацию (MTProto API)...\n\nЭто может занять несколько минут для больших групп.'
    );

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

    const result = await this.membershipService.processJoinRequest(userId, chatId, request.from);

    if (!result.approved) {
      await this.bot.declineChatJoinRequest(chatId, userId);

      // Send message to user with specific reason
      try {
        let message = '';

        if (result.reason === 'not_in_main_group') {
          message =
            'Ваша заявка отклонена.\n\n' +
            'Для вступления в дополнительные группы необходимо быть участником основной группы Montana.';
        } else if (result.reason === 'access_window_closed') {
          message =
            'Ваша заявка отклонена.\n\n' +
            '⏰ Окно для вступления в эту группу закрыто. Доступ к группе был ограничен по времени.';
        } else if (result.reason === 'already_member') {
          message =
            'Ваша заявка отклонена.\n\n' +
            '✅ Вы уже являетесь участником этой группы. Повторная заявка не требуется.';
        } else {
          message =
            'Ваша заявка отклонена.\n\n' +
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
      username: leftMember.username,
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
      await this.bot.sendMessage(
        chatId,
        '✅ Все пользователи в актуальном состоянии. Никого не нужно удалять.'
      );
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

      user.groups.forEach((group) => {
        message += `   • ${group.groupTitle}\n`;
      });

      message += '\n';
    });

    if (config.telegram.testMode) {
      message += '\n💡 Для реального удаления установите TEST_MODE=false в .env';
    }

    return message;
  }

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
🔗 /setdiscord - Привязать Discord ID вручную
❌ /unlinkdiscord - Отвязать Discord аккаунт
📊 /discordstatus - Статус Discord привязки`;
    }

    if (isAdmin) {
      helpMessage += `

*Админ команды:*
🔄 /sync - Синхронизация членства
🔍 /checkremoval - Проверить список на удаление
➕ /addgroup - Добавить обычную группу
⭐ /addpermanentgroup - Добавить постоянную группу
📋 /listgroups - Список всех групп
❌ /removegroup - Деактивировать группу
🔧 /updategroup - Обновить настройки группы
👥 /syncgroup - Синхронизировать админов группы
🔄 /fullsync - Полная синхронизация через MTProto

*Типы групп:*
• Обычная - доступ зависит от членства в Montana
• Постоянная - пожизненный доступ после проверки`;
    }

    helpMessage += `

*Как это работает:*
1️⃣ Состоите в Montana → автоматически одобряется заявка
2️⃣ Выходите из Montana → удаляетесь из всех обычных групп
3️⃣ Нет подписки → заявки отклоняются

Возникли вопросы? Напишите администратору.
    `;

    await this.bot.sendMessage(chatId, helpMessage.trim(), { parse_mode: 'Markdown' });
  }

  private async handleMyStats(msg: TelegramBot.Message): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (!userId) return;

    try {
      const { isInMainGroup } = await this.membershipService.checkMainGroupMembership(userId);
      const userGroups = await this.userRepo.getUserGroups(userId);
      const user = await this.userRepo.findById(userId);

      let statsMessage = `📊 *Ваша статистика*\n\n`;

      statsMessage += `👤 *Профиль:*\n`;
      statsMessage += `• User ID: \`${userId}\`\n`;
      if (user?.username) {
        statsMessage += `• Username: @${user.username}\n`;
      }
      statsMessage += `• Основная группа: ${isInMainGroup ? '✅ Участник' : '❌ Не участник'}\n`;

      if (userGroups.length > 0) {
        statsMessage += `\n📁 *Ваши группы (${userGroups.length}):*\n`;

        const activeGroups = userGroups.filter(
          (g) => !g.is_main_group && ['member', 'administrator', 'creator'].includes(g.status || '')
        );
        const permanentGroups = activeGroups.filter((g) => g.is_permanent);
        const regularGroups = activeGroups.filter((g) => !g.is_permanent);

        if (permanentGroups.length > 0) {
          statsMessage += `\n⭐ *Постоянные группы:*\n`;
          permanentGroups.forEach((group) => {
            statsMessage += `• ${group.title}${group.status === 'administrator' || group.status === 'creator' ? ' 👑' : ''}\n`;
          });
        }

        if (regularGroups.length > 0) {
          statsMessage += `\n📺 *Обычные группы:*\n`;
          regularGroups.forEach((group) => {
            statsMessage += `• ${group.title}${group.status === 'administrator' || group.status === 'creator' ? ' 👑' : ''}\n`;
          });
        }
      } else {
        statsMessage += `\n📁 Вы пока не состоите в дополнительных группах.`;
      }

      if (!isInMainGroup) {
        statsMessage += `\n\n⚠️ *Внимание:* Для доступа к группам нужно быть участником основной группы Montana.`;
      }

      await this.bot.sendMessage(chatId, statsMessage.trim(), { parse_mode: 'Markdown' });
    } catch (error) {
      log.error('Failed to get user stats', { userId, error });
      await this.bot.sendMessage(chatId, '❌ Не удалось получить статистику. Попробуйте позже.');
    }
  }

  private async handleListGroups(msg: TelegramBot.Message): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (!userId || !this.isAdmin(userId)) {
      await this.bot.sendMessage(chatId, 'У вас нет прав для выполнения этой команды.');
      return;
    }

    try {
      const allGroups = await this.groupRepo.findAll();

      if (allGroups.length === 0) {
        await this.bot.sendMessage(chatId, '📋 Групп не найдено.');
        return;
      }

      const mainGroup = allGroups.find((g) => g.is_main_group);
      const permanentGroups = allGroups.filter(
        (g) => !g.is_main_group && g.is_permanent && g.is_active
      );
      const regularGroups = allGroups.filter(
        (g) => !g.is_main_group && !g.is_permanent && g.is_active
      );
      const inactiveGroups = allGroups.filter((g) => !g.is_active);

      let message = `📋 *Список всех групп*\n\n`;
      message += `📊 Всего: ${allGroups.length} групп\n\n`;

      if (mainGroup) {
        message += `🏠 *Основная группа:*\n`;
        message += `• ${mainGroup.title}\n`;
        message += `  ID: \`${mainGroup.chat_id}\`\n\n`;
      }

      if (permanentGroups.length > 0) {
        message += `⭐ *Постоянные группы (${permanentGroups.length}):*\n`;
        permanentGroups.forEach((group) => {
          message += `• ${group.title}\n`;
          message += `  ID: \`${group.chat_id}\`\n`;
          if (group.access_duration_hours) {
            message += `  ⏰ Окно вступления: ${group.access_duration_hours}ч\n`;
          }
        });
        message += '\n';
      }

      if (regularGroups.length > 0) {
        message += `📺 *Обычные группы (${regularGroups.length}):*\n`;
        regularGroups.forEach((group) => {
          message += `• ${group.title}\n`;
          message += `  ID: \`${group.chat_id}\`\n`;
          if (group.access_duration_hours) {
            message += `  ⏰ Доступ: ${group.access_duration_hours}ч\n`;
          }
        });
        message += '\n';
      }

      if (inactiveGroups.length > 0) {
        message += `❌ *Неактивные группы (${inactiveGroups.length}):*\n`;
        inactiveGroups.forEach((group) => {
          message += `• ${group.title} (ID: \`${group.chat_id}\`)\n`;
        });
      }

      await this.bot.sendMessage(chatId, message.trim(), { parse_mode: 'Markdown' });
    } catch (error) {
      log.error('Failed to list groups', { error });
      await this.bot.sendMessage(chatId, '❌ Не удалось получить список групп.');
    }
  }

  private async setBotCommands(): Promise<void> {
    const commands: TelegramBot.BotCommand[] = [
      { command: 'start', description: 'Начать работу с ботом' },
      { command: 'help', description: 'Показать справку' },
      { command: 'status', description: 'Проверить ваш статус подписки' },
      { command: 'mystats', description: 'Ваша персональная статистика' },
    ];

    // Add Discord commands if enabled
    if (config.discord.enabled) {
      commands.push({ command: 'discord', description: 'Discord интеграция и статус' });
    }

    const adminCommands: TelegramBot.BotCommand[] = [
      ...commands,
      { command: 'sync', description: '[Admin] Синхронизировать членство' },
      { command: 'checkremoval', description: '[Admin] Проверить список на удаление' },
      { command: 'addgroup', description: '[Admin] Добавить обычную группу' },
      { command: 'addpermanentgroup', description: '[Admin] Добавить постоянную группу' },
      { command: 'listgroups', description: '[Admin] Список всех групп' },
      { command: 'removegroup', description: '[Admin] Деактивировать группу' },
      { command: 'updategroup', description: '[Admin] Обновить настройки группы' },
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

    const runSync = async () => {
      try {
        log.debug('Starting periodic membership sync...');
        const usersToRemove = await this.membershipService.syncMemberships();

        // In test mode, notify admins about users that would be removed
        if (config.telegram.testMode && usersToRemove.length > 0) {
          const message = this.formatRemovalList(usersToRemove);

          for (const adminId of config.telegram.adminIds) {
            try {
              await this.bot.sendMessage(adminId, `🔄 Периодическая проверка\n\n${message}`, {
                parse_mode: 'HTML',
              });
            } catch (error) {
              log.error('Failed to send periodic sync notification to admin', { adminId, error });
            }
          }
        }

        log.debug('Periodic membership sync completed', { usersToRemove: usersToRemove.length });
      } catch (error) {
        log.error('Periodic sync failed - will retry on next interval', error);
        // Notify admins about sync failure
        for (const adminId of config.telegram.adminIds) {
          try {
            await this.bot.sendMessage(
              adminId,
              `⚠️ Ошибка периодической синхронизации:\n${error instanceof Error ? error.message : 'Unknown error'}`
            );
          } catch (notifyError) {
            log.error('Failed to notify admin about sync error', { adminId, notifyError });
          }
        }
      }
    };

    // Run immediately on start
    runSync().catch((error) => log.error('Initial sync failed', error));

    // Then run periodically
    this.syncInterval = setInterval(() => {
      runSync().catch((error) => log.error('Periodic sync failed', error));
    }, intervalMs);

    log.info(
      `Periodic sync started (every ${config.telegram.checkIntervalMinutes} minutes)${config.telegram.testMode ? ' [TEST MODE]' : ''}`
    );
  }

  private isAdmin(userId: number): boolean {
    return config.telegram.adminIds.includes(userId);
  }

  private async checkAdminAndReply(
    msg: TelegramBot.Message,
    commandName: string
  ): Promise<boolean> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (!userId || !this.isAdmin(userId)) {
      log.warn(`Unauthorized ${commandName} attempt`, {
        userId,
        username: msg.from?.username,
        chatId,
        chatType: msg.chat.type,
        chatTitle: msg.chat.title,
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

    // OAuth removed - use /discord command instead
    await this.bot.sendMessage(
      chatId,
      '⚠️ Эта команда устарела. Используйте /discord чтобы привязать аккаунт.'
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
      discordUsername: existingLink.discord_username,
    });
  }

  private async handleSetDiscord(msg: TelegramBot.Message, discordUserId?: string): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (!userId) return;

    if (!config.discord.enabled) {
      await this.bot.sendMessage(chatId, '❌ Discord интеграция отключена.');
      return;
    }

    // Check if already linked
    const existingLink = await this.discordRepo.findByTelegramId(userId);
    if (existingLink) {
      await this.bot.sendMessage(
        chatId,
        `❌ Ваш Telegram уже привязан к Discord аккаунту: ${existingLink.discord_username}\n\n` +
          `Используйте /unlinkdiscord чтобы сначала отвязать текущий аккаунт.`
      );
      return;
    }

    // Show usage if no ID provided
    if (!discordUserId) {
      await this.bot.sendMessage(
        chatId,
        `💡 Как найти свой Discord User ID:\n\n` +
          `1. Откройте Discord\n` +
          `2. Настройки → Расширенные → Включите "Режим разработчика"\n` +
          `3. ПКМ на своём имени → "Копировать ID пользователя"\n` +
          `4. Отправьте: /setdiscord ВАШ_ID\n\n` +
          `Пример: /setdiscord 123456789012345678\n\n` +
          `⚠️ Внимание: Этот способ не даёт роль автоматически на Discord сервере.\n` +
          `Для автоматической выдачи роли используйте /linkdiscord`
      );
      return;
    }

    // Validate Discord User ID format (snowflake - 17-20 digits)
    const discordId = discordUserId.trim();
    if (!/^\d{17,20}$/.test(discordId)) {
      await this.bot.sendMessage(
        chatId,
        '❌ Неверный формат Discord User ID.\n\n' +
          'Discord ID должен содержать 17-20 цифр.\n' +
          'Пример: 123456789012345678'
      );
      return;
    }

    // Check if this Discord ID is already linked to another Telegram account
    const existingDiscordLink = await this.discordRepo.findByDiscordId(discordId);
    if (existingDiscordLink) {
      await this.bot.sendMessage(
        chatId,
        `❌ Этот Discord аккаунт уже привязан к другому Telegram аккаунту.`
      );
      return;
    }

    // Save the link
    await this.discordRepo.upsert({
      telegram_id: userId,
      discord_id: discordId,
      discord_username: `User#${discordId.slice(-4)}`, // Temporary username
    });

    await this.bot.sendMessage(
      chatId,
      `✅ Discord User ID успешно привязан!\n\n` +
        `Discord ID: ${discordId}\n\n` +
        `⚠️ Роль на Discord сервере нужно выдать вручную.\n` +
        `Для автоматической выдачи роли используйте /linkdiscord`
    );

    log.info('Discord ID manually linked', {
      telegramId: userId,
      discordId: discordId,
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

  /**
   * Новая универсальная команда /discord
   * - Без параметров: показывает статус
   * - "отвязать": отвязывает Discord
   * - username: привязывает/обновляет Discord username (с ограничением раз в месяц)
   */
  private async handleDiscord(msg: TelegramBot.Message, param?: string): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (!userId) return;

    if (!config.discord.enabled) {
      await this.bot.sendMessage(chatId, '❌ Discord интеграция отключена.');
      return;
    }

    // Check Discord service availability
    if (!this.discordService || !this.discordService.isReady()) {
      await this.bot.sendMessage(chatId, '❌ Discord бот не подключен. Попробуйте позже.');
      return;
    }

    const existingLink = await this.discordRepo.findByTelegramId(userId);

    // Без параметров - показать статус
    if (!param) {
      if (!existingLink) {
        await this.bot.sendMessage(
          chatId,
          `🎮 Discord интеграция\n\n` +
            `❌ Аккаунт не привязан\n\n` +
            `💡 Вы получите одноразовую ссылку-приглашение на Discord сервер.\n` +
            `После перехода по ссылке ваш аккаунт будет автоматически привязан.`,
          {
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: '🔗 Привязать Discord',
                    callback_data: 'discord_link',
                  },
                ],
              ],
            },
          }
        );
        return;
      }

      const { isInMainGroup } = await this.membershipService.checkMainGroupMembership(userId);

      let statusMessage = `🎮 Discord статус\n\n`;
      statusMessage += `✅ Привязан: ${existingLink.discord_username || 'Не указано'}\n`;
      statusMessage += `🆔 Discord ID: ${existingLink.discord_id}\n`;
      statusMessage += `🏷️ Montana: ${isInMainGroup ? '✅ Активно' : '❌ Не активно'}\n\n`;

      if (isInMainGroup) {
        statusMessage += `✨ У вас есть доступ к Montana Discord серверу!`;
      } else {
        statusMessage += `⚠️ Для доступа вступите в Montana Telegram группу.`;
      }

      await this.bot.sendMessage(chatId, statusMessage, {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '🔄 Привязать другой Discord',
                callback_data: 'discord_link',
              },
            ],
            [
              {
                text: '❌ Отвязать Discord',
                callback_data: 'discord_unlink',
              },
            ],
          ],
        },
      });
      return;
    }

    // Отвязать аккаунт
    if (param.toLowerCase() === 'отвязать' || param.toLowerCase() === 'unbind') {
      if (!existingLink) {
        await this.bot.sendMessage(chatId, '❌ Ваш Telegram не привязан к Discord аккаунту.');
        return;
      }

      // Deactivate old link (remove role)
      await this.discordService.deactivateOldLink(userId);

      // Delete link from database
      await this.discordRepo.deleteByTelegramId(userId);

      await this.bot.sendMessage(
        chatId,
        `✅ Discord аккаунт успешно отвязан.\n\n` +
          `Вы можете привязать другой аккаунт командой:\n` +
          `/discord привязать`
      );

      log.info('Discord account unlinked', {
        telegramId: userId,
        discordId: existingLink.discord_id,
      });
      return;
    }

    // Привязать/перепривязать через invite ссылку
    if (param.toLowerCase() === 'привязать' || param.toLowerCase() === 'link') {
      // Check if user is in main Montana group
      const { isInMainGroup } = await this.membershipService.checkMainGroupMembership(userId);

      if (!isInMainGroup) {
        await this.bot.sendMessage(
          chatId,
          `❌ Доступ запрещён!\n\n` +
            `Сначала вступите в основную Montana группу, чтобы получить доступ к Discord серверу.`
        );
        return;
      }

      // Check for active pending invite
      const activePendingInvite = await this.discordService.getActivePendingInvite(userId);

      if (activePendingInvite) {
        const expiresAt = new Date(activePendingInvite.expires_at);
        const hoursLeft = Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60));

        await this.bot.sendMessage(
          chatId,
          `⚠️ У вас уже есть активная invite ссылка!\n\n` +
            `🔗 ${activePendingInvite.invite_url}\n\n` +
            `⏰ Истекает через: ${hoursLeft} ч.\n` +
            `🎯 Максимум использований: 1\n\n` +
            `После присоединения ваш аккаунт будет автоматически привязан.`
        );
        return;
      }

      // Deactivate old link if re-linking
      if (existingLink) {
        await this.discordService.deactivateOldLink(userId);
      }

      // Ensure user exists in database (required for foreign key constraint)
      await this.userRepo.create({
        id: userId,
        username: msg.from?.username,
        first_name: msg.from?.first_name,
        last_name: msg.from?.last_name,
        language_code: msg.from?.language_code,
        is_premium: msg.from?.is_premium,
      });

      // Create one-time invite link
      const inviteUrl = await this.discordService.createOneTimeInvite(userId);

      if (!inviteUrl) {
        await this.bot.sendMessage(
          chatId,
          `❌ Ошибка создания invite ссылки.\n\n` +
            `Discord бот сейчас недоступен или не подключен.\n` +
            `Попробуйте через 1-2 минуты или обратитесь к администратору.`
        );
        return;
      }

      const relinkMessage = existingLink ? `🔄 Старая привязка деактивирована.\n\n` : '';

      await this.bot.sendMessage(
        chatId,
        relinkMessage +
          `✅ Одноразовая invite ссылка создана!\n\n` +
          `🔗 ${inviteUrl}\n\n` +
          `⚠️ ВАЖНО:\n` +
          `• Ссылка действительна 24 часа\n` +
          `• Можно использовать только 1 раз\n` +
          `• После присоединения аккаунт будет автоматически привязан\n\n` +
          `💡 Проверить статус: /discord`
      );

      log.info('Discord one-time invite created', {
        telegramId: userId,
        inviteUrl,
      });
      return;
    }

    // Неизвестная команда
    await this.bot.sendMessage(
      chatId,
      `❌ Неизвестная команда.\n\n` +
        `Доступные команды:\n` +
        `/discord - показать статус\n` +
        `/discord привязать - получить invite ссылку\n` +
        `/discord отвязать - отвязать аккаунт`
    );
  }

  private startDiscordRoleSync(): void {
    if (!this.discordService) {
      return;
    }

    const intervalMs = config.telegram.checkIntervalMinutes * 60 * 1000;

    const runDiscordSync = async (isInitialSync = false) => {
      try {
        if (!this.discordService) {
          log.warn('Discord service not available, skipping sync');
          return;
        }

        log.debug('Starting Discord role sync...');
        const result = await this.discordService.syncRoles();

        if (result.success) {
          log.info('Discord role sync completed', {
            added: result.added,
            removed: result.removed,
            errors: result.errors,
          });
        } else {
          log.error('Discord role sync failed');

          // Only notify admins about failures during periodic sync, not initial sync
          // (initial sync often fails due to Discord bot not being connected yet)
          if (!isInitialSync) {
            for (const adminId of config.telegram.adminIds) {
              try {
                await this.bot.sendMessage(
                  adminId,
                  `⚠️ Discord синхронизация ролей не удалась. Проверьте статус Discord бота.`
                );
              } catch (error) {
                log.error('Failed to notify admin about Discord sync failure', { adminId, error });
              }
            }
          }
        }
      } catch (error) {
        log.error('Discord role sync error - will retry on next interval', error);
      }
    };

    // Run immediately on start (but don't notify admins if it fails)
    runDiscordSync(true).catch((error) => log.error('Initial Discord sync failed', error));

    // Then run periodically (will notify admins if it fails)
    this.discordSyncInterval = setInterval(() => {
      runDiscordSync(false).catch((error) => log.error('Discord periodic sync failed', error));
    }, intervalMs);

    log.info(`Discord role sync started (every ${config.telegram.checkIntervalMinutes} minutes)`);
  }

  /**
   * Handle callback queries from inline buttons
   */
  private async handleCallbackQuery(query: TelegramBot.CallbackQuery): Promise<void> {
    const chatId = query.message?.chat.id;
    const userId = query.from.id;
    const data = query.data;

    if (!chatId || !data) return;

    try {
      // Acknowledge the callback
      await this.bot.answerCallbackQuery(query.id);

      if (data === 'discord_link') {
        // Привязать Discord
        await this.handleDiscord(query.message as TelegramBot.Message, 'привязать');
      } else if (data === 'discord_unlink') {
        // Отвязать Discord
        await this.handleDiscord(query.message as TelegramBot.Message, 'отвязать');
      }
    } catch (error) {
      log.error('Error handling callback query', { error, userId, data });
      await this.bot.answerCallbackQuery(query.id, {
        text: '❌ Произошла ошибка. Попробуйте позже.',
        show_alert: true,
      });
    }
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
