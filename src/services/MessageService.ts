import * as fs from 'fs';
import * as path from 'path';

interface Messages {
  [key: string]: any;
}

/**
 * Сервис для работы с текстами сообщений бота
 * Все тексты хранятся в config/messages.json
 */
export class MessageService {
  private messages: Messages;

  constructor() {
    const messagesPath = path.join(__dirname, '../../config/messages.json');
    const messagesData = fs.readFileSync(messagesPath, 'utf-8');
    this.messages = JSON.parse(messagesData);
  }

  /**
   * Получить сообщение по пути (например, "welcome.title")
   * @param path - Путь к сообщению через точку
   * @param params - Параметры для подстановки {param}
   */
  get(path: string, params?: Record<string, any>): string {
    const keys = path.split('.');
    let value: any = this.messages;

    for (const key of keys) {
      if (value && typeof value === 'object' && key in value) {
        value = value[key];
      } else {
        return `[Missing: ${path}]`;
      }
    }

    if (typeof value !== 'string') {
      return `[Invalid: ${path}]`;
    }

    // Заменяем параметры
    if (params) {
      return this.replaceParams(value, params);
    }

    return value;
  }

  /**
   * Получить полное приветственное сообщение
   */
  getWelcomeMessage(): string {
    const w = this.messages.welcome;
    return `${w.title}\n\n${w.description}\n\n${w.how_it_works}\n${w.step1}\n${w.step2}\n${w.step3}\n\n${w.group_types}\n${w.normal_group}\n${w.permanent_group}\n\n${w.commands_hint}`;
  }

  /**
   * Получить справку для пользователя
   */
  getHelpMessage(isAdmin: boolean, discordEnabled: boolean): string {
    const h = this.messages.help;
    let message = `${h.title}\n\n${h.available_commands}\n\n`;

    // Пользовательские команды
    message += `${h.user_commands.start}\n`;
    message += `${h.user_commands.status}\n`;
    message += `${h.user_commands.mystats}\n`;
    message += `${h.user_commands.help}\n`;

    // Discord команды
    if (discordEnabled) {
      message += `\n${h.discord_section}\n`;
      message += `${h.discord_commands.linkdiscord}\n`;
      message += `${h.discord_commands.setdiscord}\n`;
      message += `${h.discord_commands.unlinkdiscord}\n`;
      message += `${h.discord_commands.discordstatus}\n`;
    }

    // Админские команды
    if (isAdmin) {
      message += `\n${h.admin_section}\n`;
      message += `${h.admin_commands.sync}\n`;
      message += `${h.admin_commands.checkremoval}\n`;
      message += `${h.admin_commands.addgroup}\n`;
      message += `${h.admin_commands.addpermanentgroup}\n`;
      message += `${h.admin_commands.listgroups}\n`;
      message += `${h.admin_commands.removegroup}\n`;
      message += `${h.admin_commands.updategroup}\n`;
      message += `${h.admin_commands.syncgroup}\n`;
      message += `${h.admin_commands.fullsync}\n`;

      message += `\n${h.group_types_info}\n`;
      message += `${h.normal_group_info}\n`;
      message += `${h.permanent_group_info}`;
    }

    return message;
  }

  /**
   * Получить сообщение о статистике пользователя
   */
  getMyStatsMessage(data: {
    userId: number;
    username?: string;
    isInMainGroup: boolean;
    permanentGroups: any[];
    regularGroups: any[];
  }): string {
    const m = this.messages.mystats;
    let message = `${m.title}\n\n${m.profile}\n`;

    message += `${this.replaceParams(m.user_id, { userId: data.userId })}\n`;

    if (data.username) {
      message += `${this.replaceParams(m.username, { username: data.username })}\n`;
    }

    message += data.isInMainGroup ? m.main_group_member : m.main_group_not_member;
    message += '\n';

    const totalGroups = data.permanentGroups.length + data.regularGroups.length;

    if (totalGroups > 0) {
      message += `\n${this.replaceParams(m.groups_title, { count: totalGroups })}\n`;

      if (data.permanentGroups.length > 0) {
        message += `\n${m.permanent_groups}\n`;
        data.permanentGroups.forEach((group) => {
          const badge = ['administrator', 'creator'].includes(group.status || '')
            ? m.admin_badge
            : '';
          message += `• ${group.title}${badge}\n`;
        });
      }

      if (data.regularGroups.length > 0) {
        message += `\n${m.normal_groups}\n`;
        data.regularGroups.forEach((group) => {
          const badge = ['administrator', 'creator'].includes(group.status || '')
            ? m.admin_badge
            : '';
          message += `• ${group.title}${badge}\n`;
        });
      }
    }

    return message;
  }

  /**
   * Получить список групп для админа
   */
  getListGroupsMessage(data: {
    mainGroup?: any;
    permanentGroups: any[];
    regularGroups: any[];
    inactiveGroups: any[];
    total: number;
  }): string {
    const m = this.messages.listgroups;
    let message = `${m.title}\n\n`;
    message += `${this.replaceParams(m.total, { count: data.total })}\n\n`;

    if (data.mainGroup) {
      message += `${m.main_group}\n`;
      message += `• ${data.mainGroup.title}\n`;
      message += `${this.replaceParams(m.group_id, { chatId: data.mainGroup.chat_id })}\n\n`;
    }

    if (data.permanentGroups.length > 0) {
      message += `${this.replaceParams(m.permanent_groups, { count: data.permanentGroups.length })}\n`;
      data.permanentGroups.forEach((group) => {
        message += `• ${group.title}\n`;
        message += `${this.replaceParams(m.group_id, { chatId: group.chat_id })}\n`;
        if (group.access_duration_hours) {
          message += `${this.replaceParams(m.access_window, { hours: group.access_duration_hours })}\n`;
        }
      });
      message += '\n';
    }

    if (data.regularGroups.length > 0) {
      message += `${this.replaceParams(m.normal_groups, { count: data.regularGroups.length })}\n`;
      data.regularGroups.forEach((group) => {
        message += `• ${group.title}\n`;
        message += `${this.replaceParams(m.group_id, { chatId: group.chat_id })}\n`;
        if (group.access_duration_hours) {
          message += `${this.replaceParams(m.access_window, { hours: group.access_duration_hours })}\n`;
        }
      });
      message += '\n';
    }

    if (data.inactiveGroups.length > 0) {
      message += `${this.replaceParams(m.inactive_groups, { count: data.inactiveGroups.length })}\n`;
      data.inactiveGroups.forEach((group) => {
        message += `• ${group.title}\n`;
        message += `${this.replaceParams(m.group_id, { chatId: group.chat_id })}\n`;
      });
    }

    return message.trim();
  }

  /**
   * Заменить параметры в строке
   */
  private replaceParams(text: string, params: Record<string, any>): string {
    let result = text;
    for (const [key, value] of Object.entries(params)) {
      result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value));
    }
    return result;
  }
}

// Экспортируем singleton
export const messageService = new MessageService();
