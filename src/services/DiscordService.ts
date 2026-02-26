import {
  Client,
  GatewayIntentBits,
  Guild,
  GuildMember,
  VoiceState,
} from 'discord.js';
import TelegramBot from 'node-telegram-bot-api';
import { DiscordRepository } from '../repositories/DiscordRepository';
import { UserRepository } from '../repositories/UserRepository';
import { DiscordRoleSyncResult } from '../types';
import { log } from '../utils/logger';
import { config } from '../config';

export class DiscordService {
  private client: Client;
  private discordRepo: DiscordRepository;
  private userRepo: UserRepository;
  private isConnected: boolean = false;
  private bot: TelegramBot | null = null;
  private lastVoiceNotification: number = 0;
  private lastMontanaNotification: number = 0;
  private voiceChannelCache: Map<string, number> = new Map();

  constructor(bot?: TelegramBot) {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates, // Для отслеживания voice
      ],
    });

    this.discordRepo = new DiscordRepository();
    this.userRepo = new UserRepository();
    this.bot = bot || null;

    this.setupEventHandlers();
  }

  /**
   * Set Telegram bot instance
   */
  setTelegramBot(bot: TelegramBot): void {
    this.bot = bot;
  }

  /**
   * Setup Discord bot event handlers
   */
  private setupEventHandlers(): void {
    this.client.on('clientReady', async () => {
      log.info('Discord bot connected', { tag: this.client.user?.tag });
      this.isConnected = true;
    });

    this.client.on('error', (error) => {
      log.error('Discord client error', error);
    });

    this.client.on('disconnect', () => {
      log.warn('Discord bot disconnected');
      this.isConnected = false;
    });


    // Track voice state changes
    this.client.on('voiceStateUpdate', async (oldState, newState) => {
      await this.handleVoiceStateUpdate(oldState, newState);
    });
  }

  /**
   * Handle voice state updates
   */
  private async handleVoiceStateUpdate(oldState: VoiceState, newState: VoiceState): Promise<void> {
    try {
      if (!this.bot) {
        return; // No Telegram bot configured
      }

      const guildId = config.discord.guildId;
      if (newState.guild.id !== guildId) {
        return; // Not our guild
      }

      // Check if someone joined a voice channel
      if (!oldState.channel && newState.channel) {
        const member = newState.member;
        if (!member) return;

        // Check if Montana (honeymontana) joined voice
        if (member.user.username.toLowerCase() === 'honeymontana') {
          await this.notifyMontanaJoinedVoice();
        }

        // Count people in all voice channels
        await this.checkVoiceChannelCount();
      }

      // Check if someone left a voice channel
      if (oldState.channel && !newState.channel) {
        // Update voice channel count
        await this.checkVoiceChannelCount();
      }

      // Check if someone moved between channels
      if (oldState.channel && newState.channel && oldState.channel.id !== newState.channel.id) {
        await this.checkVoiceChannelCount();
      }
    } catch (error) {
      log.error('Failed to handle voice state update', error);
    }
  }

  /**
   * Notify in Telegram when Montana joins voice
   */
  private async notifyMontanaJoinedVoice(): Promise<void> {
    try {
      if (!this.bot) return;

      // Debounce: не спамить если недавно отправляли
      const now = Date.now();
      if (now - this.lastMontanaNotification < 60000) {
        // 1 минута cooldown
        return;
      }

      this.lastMontanaNotification = now;

      const message =
        '🎙️ Montana подключился в войс [Discord](https://t.me/montana_helper_bot?start=discord), намечается что-то интересное!';

      await this.bot.sendMessage(config.telegram.mainGroupId, message, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      });

      log.info('Sent Montana voice join notification to Telegram');
    } catch (error) {
      log.error('Failed to send Montana voice notification', error);
    }
  }

  /**
   * Check voice channel count and notify if > 5 people
   */
  private async checkVoiceChannelCount(): Promise<void> {
    try {
      if (!this.bot) return;

      const guild = await this.getGuild(config.discord.guildId);
      if (!guild) return;

      // Count total people in all voice channels
      let totalPeople = 0;
      for (const [, channel] of guild.channels.cache) {
        if (channel.isVoiceBased()) {
          const voiceChannel = channel as any;
          totalPeople += voiceChannel.members?.size || 0;
        }
      }

      // Store in cache
      const cacheKey = 'total_voice';
      const lastCount = this.voiceChannelCache.get(cacheKey) || 0;
      this.voiceChannelCache.set(cacheKey, totalPeople);

      // Notify if crossed threshold (5+ people) and wasn't already above threshold
      if (totalPeople >= 5 && lastCount < 5) {
        const now = Date.now();

        // Debounce: не спамить если недавно отправляли (10 минут cooldown)
        if (now - this.lastVoiceNotification < 600000) {
          return;
        }

        this.lastVoiceNotification = now;

        const message = `🎉 В войсе [Discord](https://t.me/montana_helper_bot?start=discord) собралось уже ${totalPeople} человек, намечается что-то интересное!`;

        await this.bot.sendMessage(config.telegram.mainGroupId, message, {
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
        });

        log.info('Sent voice count notification to Telegram', { count: totalPeople });
      }
    } catch (error) {
      log.error('Failed to check voice channel count', error);
    }
  }

  /**
   * Connect to Discord
   */
  async connect(): Promise<boolean> {
    try {
      if (!config.discord.enabled) {
        log.info('Discord integration is disabled');
        return false;
      }

      if (!config.discord.botToken) {
        log.error('Discord bot token not configured');
        return false;
      }

      await this.client.login(config.discord.botToken);
      return true;
    } catch (error) {
      log.error('Failed to connect Discord bot', error);
      return false;
    }
  }

  /**
   * Disconnect from Discord
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.destroy();
      this.isConnected = false;
      log.info('Discord bot disconnected');
    }
  }

  /**
   * Get guild by ID
   */
  async getGuild(guildId: string): Promise<Guild | null> {
    try {
      const guild = await this.client.guilds.fetch(guildId);
      return guild;
    } catch (error) {
      log.error('Failed to fetch Discord guild', { guildId, error });
      return null;
    }
  }

  /**
   * Add role to Discord user
   */
  async addRole(discordUserId: string, roleId: string): Promise<boolean> {
    try {
      const guildId = config.discord.guildId;
      const guild = await this.getGuild(guildId);

      if (!guild) {
        log.error('Discord guild not found', { guildId });
        return false;
      }

      const member = await guild.members.fetch(discordUserId);
      if (!member) {
        log.error('Discord member not found', { discordUserId, guildId });
        return false;
      }

      await member.roles.add(roleId);
      log.info('Added Discord role to user', { discordUserId, roleId });
      return true;
    } catch (error) {
      log.error('Failed to add Discord role', { discordUserId, roleId, error });
      return false;
    }
  }

  /**
   * Remove role from Discord user
   */
  async removeRole(discordUserId: string, roleId: string): Promise<boolean> {
    try {
      const guildId = config.discord.guildId;
      const guild = await this.getGuild(guildId);

      if (!guild) {
        log.error('Discord guild not found', { guildId });
        return false;
      }

      const member = await guild.members.fetch(discordUserId);
      if (!member) {
        log.error('Discord member not found', { discordUserId, guildId });
        return false;
      }

      await member.roles.remove(roleId);
      log.info('Removed Discord role from user', { discordUserId, roleId });
      return true;
    } catch (error) {
      log.error('Failed to remove Discord role', { discordUserId, roleId, error });
      return false;
    }
  }

  /**
   * Check if user has role
   */
  async hasRole(discordUserId: string, roleId: string): Promise<boolean> {
    try {
      const guildId = config.discord.guildId;
      const guild = await this.getGuild(guildId);

      if (!guild) {
        return false;
      }

      const member = await guild.members.fetch(discordUserId);
      if (!member) {
        return false;
      }

      return member.roles.cache.has(roleId);
    } catch (error) {
      log.error('Failed to check Discord role', { discordUserId, roleId, error });
      return false;
    }
  }

  /**
   * Sync Discord roles based on Montana membership
   */
  async syncRoles(): Promise<DiscordRoleSyncResult> {
    const result: DiscordRoleSyncResult = {
      success: true,
      added: 0,
      removed: 0,
      errors: 0,
    };

    try {
      if (!this.isConnected) {
        log.warn('Discord bot not connected, skipping role sync');
        result.success = false;
        return result;
      }

      const roleId = config.discord.memberRoleId;
      if (!roleId) {
        log.error('Discord member role ID not configured');
        result.success = false;
        return result;
      }

      // Get all Discord links
      const links = await this.discordRepo.findByGuildId(config.discord.guildId);

      log.info(`Syncing Discord roles for ${links.length} linked accounts...`);

      for (const link of links) {
        try {
          // Check if user is still in Montana main group
          const isInMainGroup = await this.userRepo.isUserInGroup(
            link.telegram_id,
            config.telegram.mainGroupId
          );

          const hasRole = await this.hasRole(link.discord_id, roleId);

          if (isInMainGroup && !hasRole) {
            // Add role
            const added = await this.addRole(link.discord_id, roleId);
            if (added) {
              result.added++;
            } else {
              result.errors++;
            }
          } else if (!isInMainGroup && hasRole) {
            // Remove role
            const removed = await this.removeRole(link.discord_id, roleId);
            if (removed) {
              result.removed++;
            } else {
              result.errors++;
            }
          }
        } catch (error) {
          log.error('Failed to sync Discord role for user', {
            telegramId: link.telegram_id,
            discordId: link.discord_id,
            error,
          });
          result.errors++;
        }
      }

      log.info('Discord role sync completed', {
        added: result.added,
        removed: result.removed,
        errors: result.errors,
      });
    } catch (error) {
      log.error('Failed to sync Discord roles', error);
      result.success = false;
      result.errors++;
    }

    return result;
  }

  /**
   * Get member info
   */
  async getMember(discordUserId: string): Promise<GuildMember | null> {
    try {
      const guildId = config.discord.guildId;
      const guild = await this.getGuild(guildId);

      if (!guild) {
        return null;
      }

      const member = await guild.members.fetch(discordUserId);
      return member;
    } catch (error) {
      log.error('Failed to fetch Discord member', { discordUserId, error });
      return null;
    }
  }

  /**
   * Create public invite link for announcements (valid for 24h, unlimited uses)
   */
  async createPublicInvite(): Promise<string | null> {
    try {
      const guildId = config.discord.guildId;
      const guild = await this.getGuild(guildId);

      if (!guild) {
        log.error('Discord guild not found for public invite', { guildId });
        return null;
      }

      // Get first available text channel for invite creation
      const channels = await guild.channels.fetch();
      const textChannel = channels.find((channel) => channel?.isTextBased() && channel.type === 0);

      if (!textChannel) {
        log.error('No text channel found for public invite creation');
        return null;
      }

      // Create invite with no usage limit, valid for 24 hours
      const invite = await (textChannel as any).createInvite({
        maxUses: 0, // No limit
        maxAge: 86400, // 24 hours in seconds
        unique: false, // Re-use existing if available
        reason: 'Public invite for voice activity notification',
      });

      log.info('Created public Discord invite', {
        inviteCode: invite.code,
        expiresAt: new Date(Date.now() + 86400 * 1000).toISOString(),
      });

      return invite.url;
    } catch (error) {
      log.error('Failed to create public Discord invite', { error });
      return null;
    }
  }

  /**
   * Deactivate old Discord link (for re-linking)
   */
  async deactivateOldLink(telegramId: number): Promise<boolean> {
    try {
      const link = await this.discordRepo.findByTelegramId(telegramId);

      if (!link) {
        return true; // No link to deactivate
      }

      // Remove role from old Discord account
      const removed = await this.removeRole(link.discord_id, config.discord.memberRoleId);

      if (removed) {
        log.info('Deactivated old Discord link', {
          telegramId,
          discordId: link.discord_id,
        });
      }

      return removed;
    } catch (error) {
      log.error('Failed to deactivate old Discord link', { telegramId, error });
      return false;
    }
  }

  /**
   * Find guild member by Discord username
   */
  async findMemberByUsername(username: string): Promise<GuildMember | null> {
    try {
      const guild = await this.getGuild(config.discord.guildId);
      if (!guild) {
        log.error('Guild not found', { guildId: config.discord.guildId });
        return null;
      }

      log.info('🔍 DEBUG: Starting search for Discord member', { username });

      // Approach 1: Try query parameter search first
      try {
        const queryResult = await guild.members.fetch({ query: username, limit: 10 });

        log.info('🔍 DEBUG: Query search result', {
          searchUsername: username,
          fetchedCount: queryResult.size,
          fetchedUsernames: queryResult.map((m) => m.user.username),
        });

        const exactMatch = queryResult.find(
          (m) => m.user.username.toLowerCase() === username.toLowerCase()
        );

        if (exactMatch) {
          log.info('✅ Found member via query search', {
            username,
            discordId: exactMatch.id,
            foundUsername: exactMatch.user.username,
          });
          return exactMatch;
        }
      } catch (queryError) {
        log.warn('Query search failed, trying alternative method', { error: queryError });
      }

      // Approach 2: Fetch limited members and search manually
      try {
        log.info('🔍 DEBUG: Trying manual search with limit 100');
        const allMembers = await guild.members.fetch({ limit: 100 });

        log.info('🔍 DEBUG: Manual search fetched members', {
          totalFetched: allMembers.size,
          sampleUsernames: allMembers.map((m) => m.user.username).slice(0, 10),
        });

        const manualMatch = allMembers.find(
          (m) => m.user.username.toLowerCase() === username.toLowerCase()
        );

        if (manualMatch) {
          log.info('✅ Found member via manual search', {
            username,
            discordId: manualMatch.id,
            foundUsername: manualMatch.user.username,
          });
          return manualMatch;
        }
      } catch (manualError) {
        log.error('Manual search also failed', { error: manualError });
      }

      log.warn('❌ Member not found after trying all methods', { username });
      return null;
    } catch (error) {
      log.error('Error finding member by username', { username, error });
      return null;
    }
  }

  /**
   * Check if bot is connected
   */
  isReady(): boolean {
    return this.isConnected && this.client.isReady();
  }
}
