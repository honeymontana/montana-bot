import TelegramBot from 'node-telegram-bot-api';
import { UserRepository } from '../repositories/UserRepository';
import { GroupRepository } from '../repositories/GroupRepository';
import { User, Group, MembershipCheckResult, UserToRemove, JoinRequestResult } from '../types';
import { log } from '../utils/logger';
import { withTransaction } from '../database/connection';
import { config } from '../config';
import { TelegramClientService } from './TelegramClientService';

export class MembershipService {
  private userRepo: UserRepository;
  private groupRepo: GroupRepository;
  private bot: TelegramBot;

  constructor(bot: TelegramBot) {
    this.userRepo = new UserRepository();
    this.groupRepo = new GroupRepository();
    this.bot = bot;
  }

  /**
   * Check if user is member of the main group
   */
  async checkMainGroupMembership(userId: number): Promise<MembershipCheckResult> {
    try {
      const mainGroupId = config.telegram.mainGroupId;
      const member = await this.bot.getChatMember(mainGroupId, userId);

      const isInMainGroup = ['member', 'administrator', 'creator'].includes(member.status);

      return {
        isInMainGroup,
        user: member,
      };
    } catch (error) {
      log.error('Failed to check main group membership', { userId, error });
      return { isInMainGroup: false };
    }
  }

  /**
   * Process join request for a managed group
   */
  async processJoinRequest(
    userId: number,
    chatId: number,
    userInfo: TelegramBot.User
  ): Promise<JoinRequestResult> {
    try {
      // Check if user is in main group
      const { isInMainGroup } = await this.checkMainGroupMembership(userId);

      if (!isInMainGroup) {
        log.info('Join request denied - user not in main group', { userId, chatId });
        return { approved: false, reason: 'not_in_main_group' };
      }

      // Save user info to database
      await this.userRepo.create({
        id: userId,
        username: userInfo.username,
        first_name: userInfo.first_name,
        last_name: userInfo.last_name,
        is_bot: userInfo.is_bot || false,
        language_code: userInfo.language_code,
        is_premium: (userInfo as any).is_premium,
      });

      // Get or create group in database
      let group = await this.groupRepo.findByChatId(chatId);
      if (!group) {
        const chat = await this.bot.getChat(chatId);
        group = await this.groupRepo.create({
          chat_id: chatId,
          title: chat.title || 'Unknown',
          username: chat.username,
          description: chat.description,
          is_active: true,
          is_main_group: false,
        });
      }

      // Check if user is already a member of this group
      const userGroups = await this.userRepo.getUserGroups(userId);
      const alreadyMember = userGroups.some(
        g => g.chat_id === chatId && ['member', 'administrator', 'creator'].includes(g.status || '')
      );

      if (alreadyMember) {
        log.info('Join request denied - user already member', { userId, chatId, groupId: group.id });
        return { approved: false, reason: 'already_member' };
      }

      // Check if group access window is still open
      const isAccessible = await this.groupRepo.isGroupAccessible(group.id);
      if (!isAccessible) {
        log.info('Join request denied - access window closed', {
          userId,
          chatId,
          groupId: group.id,
          accessDurationHours: group.access_duration_hours
        });
        return { approved: false, reason: 'access_window_closed' };
      }

      // Add user to group in database
      await this.userRepo.addToGroup(userId, group.id, 'member');

      // Approve the join request in Telegram
      await this.bot.approveChatJoinRequest(chatId, userId);

      log.info('Join request approved', { userId, chatId });
      return { approved: true };
    } catch (error) {
      log.error('Failed to process join request', { userId, chatId, error });
      return { approved: false, reason: 'error' };
    }
  }

  /**
   * Remove user from all managed groups if they left main group
   */
  async handleMainGroupLeave(userId: number, testMode: boolean = false): Promise<UserToRemove | null> {
    try {
      return await withTransaction(async (client) => {
        // Get all groups user is member of
        const userGroups = await this.userRepo.getUserGroups(userId);

        // Get user info
        const user = await this.userRepo.findById(userId);

        // Filter: exclude only main group (remove from ALL managed groups)
        const groupsToRemoveFrom = userGroups.filter(g => !g.is_main_group);

        if (testMode) {
          // In test mode, just collect information
          const userToRemove: UserToRemove = {
            userId,
            username: user?.username,
            firstName: user?.first_name,
            lastName: user?.last_name,
            groups: groupsToRemoveFrom.map(g => ({
              groupId: g.id,
              groupTitle: g.title,
              chatId: g.chat_id
            }))
          };

          log.info('[TEST MODE] Would remove user from groups', {
            userId,
            groupCount: groupsToRemoveFrom.length,
            totalGroups: userGroups.length
          });

          return userToRemove;
        } else {
          // Production mode - actually remove
          for (const group of groupsToRemoveFrom) {
            try {
              // Remove from Telegram group
              await this.bot.banChatMember(group.chat_id, userId);
              // Immediately unban to allow future rejoin
              await this.bot.unbanChatMember(group.chat_id, userId);

              log.info('User removed from group', {
                userId,
                groupId: group.id,
                groupTitle: group.title
              });
            } catch (error) {
              log.error('Failed to remove user from Telegram group', {
                userId,
                groupId: group.id,
                error
              });
            }
          }

          // Remove from all managed groups in database
          for (const group of groupsToRemoveFrom) {
            await this.userRepo.removeFromGroup(userId, group.id);
          }

          log.info('User removed from all managed groups', {
            userId,
            removedCount: groupsToRemoveFrom.length
          });

          return null;
        }
      });
    } catch (error) {
      log.error('Failed to handle main group leave', { userId, error });
      return null;
    }
  }

  /**
   * Sync members - remove those not in main group
   */
  async syncMemberships(): Promise<UserToRemove[]> {
    try {
      const testMode = config.telegram.testMode;
      log.info(`Starting membership sync${testMode ? ' [TEST MODE]' : ''}`);

      const mainGroup = await this.groupRepo.findMainGroup();
      if (!mainGroup) {
        log.error('Main group not configured');
        return [];
      }

      // Get members in managed groups but not in main group
      const membersData = await this.groupRepo.getMembersNotInMainGroup(mainGroup.id);

      // Group by user_id to avoid duplicates
      const uniqueUsers = new Map<number, any>();
      for (const member of membersData) {
        if (!uniqueUsers.has(member.user_id)) {
          uniqueUsers.set(member.user_id, member);
        }
      }

      const usersToRemove: UserToRemove[] = [];

      for (const [userId, userData] of uniqueUsers) {
        // Double-check with Telegram API
        const { isInMainGroup } = await this.checkMainGroupMembership(userId);

        if (!isInMainGroup) {
          const result = await this.handleMainGroupLeave(userId, testMode);
          if (result) {
            usersToRemove.push(result);
          }
        } else {
          // User is actually in main group, update database
          await this.userRepo.addToGroup(userId, mainGroup.id, 'member');
        }
      }

      log.info('Membership sync completed', {
        checkedCount: uniqueUsers.size,
        toRemoveCount: usersToRemove.length
      });

      return usersToRemove;
    } catch (error) {
      log.error('Failed to sync memberships', error);
      return [];
    }
  }

  /**
   * Sync all members from a Telegram group to database (Bot API - admins only)
   */
  async syncGroupMembers(chatId: number): Promise<{ synced: number; errors: number }> {
    let synced = 0;
    let errors = 0;

    try {
      const group = await this.groupRepo.findByChatId(chatId);
      if (!group) {
        log.error('Group not found in database', { chatId });
        return { synced: 0, errors: 1 };
      }

      // Get all members using getChatAdministrators as fallback
      // Note: Telegram Bot API doesn't provide full member list for groups
      // We can only get admins, so this is limited
      log.warn('Note: Bot API can only sync administrators. Regular members will be synced as they interact.');

      const admins = await this.bot.getChatAdministrators(chatId);

      for (const admin of admins) {
        try {
          const user = admin.user;

          // Save user to database
          await this.userRepo.create({
            id: user.id,
            username: user.username,
            first_name: user.first_name,
            last_name: user.last_name,
            is_bot: user.is_bot,
            language_code: user.language_code,
            is_premium: (user as any).is_premium,
          });

          // Add to group
          await this.userRepo.addToGroup(user.id, group.id, admin.status);
          synced++;
        } catch (error) {
          log.error('Failed to sync member', { userId: admin.user.id, error });
          errors++;
        }
      }

      log.info('Group members sync completed', { chatId, synced, errors });
    } catch (error) {
      log.error('Failed to sync group members', { chatId, error });
      errors++;
    }

    return { synced, errors };
  }

  /**
   * Full sync using MTProto API - gets ALL members
   */
  async fullSyncGroupMembers(chatId: number): Promise<{ synced: number; errors: number }> {
    let synced = 0;
    let errors = 0;

    try {
      const group = await this.groupRepo.findByChatId(chatId);
      if (!group) {
        log.error('Group not found in database', { chatId });
        return { synced: 0, errors: 1 };
      }

      const telegramClient = new TelegramClientService();
      const connected = await telegramClient.connect();

      if (!connected) {
        log.error('Failed to connect TelegramClient');
        return { synced: 0, errors: 1 };
      }

      log.info('Fetching all members using MTProto API...', { chatId });
      const members = await telegramClient.getAllChatMembers(chatId);

      log.info(`Processing ${members.length} members...`);

      for (const member of members) {
        try {
          // Save user to database
          await this.userRepo.create({
            id: Number(member.id),
            username: member.username,
            first_name: member.firstName,
            last_name: member.lastName,
            is_bot: member.bot || false,
            language_code: member.langCode,
            is_premium: member.premium,
          });

          // Add to group
          await this.userRepo.addToGroup(Number(member.id), group.id, 'member');
          synced++;

          if (synced % 50 === 0) {
            log.info(`Synced ${synced}/${members.length} members...`);
          }
        } catch (error) {
          log.error('Failed to sync member', { userId: member.id, error });
          errors++;
        }
      }

      await telegramClient.disconnect();
      log.info('Full sync completed', { chatId, synced, errors });
    } catch (error) {
      log.error('Failed to full sync group members', { chatId, error });
      errors++;
    }

    return { synced, errors };
  }

  /**
   * Get available groups for user
   */
  async getAvailableGroups(userId: number): Promise<Group[]> {
    const { isInMainGroup } = await this.checkMainGroupMembership(userId);

    if (!isInMainGroup) {
      return [];
    }

    const allGroups = await this.groupRepo.findAllManaged();

    // Filter groups by access window
    const availableGroups: Group[] = [];
    for (const group of allGroups) {
      const isAccessible = await this.groupRepo.isGroupAccessible(group.id);
      if (isAccessible) {
        availableGroups.push(group);
      }
    }

    return availableGroups;
  }

  /**
   * Add user to a specific managed group
   */
  async addToManagedGroup(userId: number, groupId: string): Promise<boolean> {
    try {
      // Check main group membership first
      const { isInMainGroup } = await this.checkMainGroupMembership(userId);
      if (!isInMainGroup) {
        return false;
      }

      const group = await this.groupRepo.findById(groupId);
      if (!group || !group.is_active || group.is_main_group) {
        return false;
      }

      // Check if user is already a member of this group
      const userGroups = await this.userRepo.getUserGroups(userId);
      const alreadyMember = userGroups.some(
        g => g.id === groupId && ['member', 'administrator', 'creator'].includes(g.status || '')
      );

      if (alreadyMember) {
        log.info('User already member of group, not creating new invite link', {
          userId,
          groupId,
          groupTitle: group.title
        });

        // Send message that user is already a member
        await this.bot.sendMessage(
          userId,
          `Вы уже являетесь участником группы "${group.title}".\n\n` +
          `❌ Новая ссылка не создана.`
        );

        return false;
      }

      // Add to database
      await this.userRepo.addToGroup(userId, groupId, 'member');

      // Generate invite link (expires in 24 hours)
      const inviteLink = await this.bot.createChatInviteLink(group.chat_id, {
        member_limit: 1,
        creates_join_request: false,
        expire_date: Math.floor(Date.now() / 1000) + (24 * 60 * 60), // 24 hours
      });

      // Send invite link to user
      await this.bot.sendMessage(
        userId,
        `Вы добавлены в группу "${group.title}".\n\n` +
        `Вступить: ${inviteLink.invite_link}\n\n` +
        `⏰ Ссылка действует 24 часа`
      );

      log.info('User added to managed group', { userId, groupId });
      return true;
    } catch (error) {
      log.error('Failed to add user to managed group', { userId, groupId, error });
      return false;
    }
  }
}