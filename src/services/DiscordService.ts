import { Client, GatewayIntentBits, Guild, GuildMember, Invite } from 'discord.js';
import { DiscordRepository } from '../repositories/DiscordRepository';
import { DiscordPendingInviteRepository } from '../repositories/DiscordPendingInviteRepository';
import { UserRepository } from '../repositories/UserRepository';
import { DiscordRoleSyncResult } from '../types';
import { log } from '../utils/logger';
import { config } from '../config';

export class DiscordService {
  private client: Client;
  private discordRepo: DiscordRepository;
  private pendingInviteRepo: DiscordPendingInviteRepository;
  private userRepo: UserRepository;
  private isConnected: boolean = false;

  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildInvites,
      ],
    });

    this.discordRepo = new DiscordRepository();
    this.pendingInviteRepo = new DiscordPendingInviteRepository();
    this.userRepo = new UserRepository();

    this.setupEventHandlers();
  }

  /**
   * Setup Discord bot event handlers
   */
  private setupEventHandlers(): void {
    this.client.on('ready', () => {
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

    // Handle new member joins - auto-link account if they used pending invite
    this.client.on('guildMemberAdd', async (member) => {
      await this.handleMemberJoin(member);
    });

    // Track invite usage
    this.client.on('inviteCreate', async (invite) => {
      log.info('Discord invite created', { code: invite.code });
    });
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
   * Create one-time invite link for user
   */
  async createOneTimeInvite(telegramId: number): Promise<string | null> {
    try {
      const guildId = config.discord.guildId;
      const guild = await this.getGuild(guildId);

      if (!guild) {
        log.error('Discord guild not found', { guildId });
        return null;
      }

      // Get first available text channel for invite creation
      const channels = await guild.channels.fetch();
      const textChannel = channels.find(
        (channel) => channel?.isTextBased() && channel.type === 0
      );

      if (!textChannel) {
        log.error('No text channel found for invite creation');
        return null;
      }

      // Delete any old unused invites for this user
      await this.pendingInviteRepo.deleteOldInvites(telegramId);

      // Create new invite with max 1 use, expires in 24 hours
      const invite = await (textChannel as any).createInvite({
        maxUses: 1,
        maxAge: 86400, // 24 hours in seconds
        unique: true,
        reason: `One-time invite for Telegram user ${telegramId}`,
      });

      // Store invite in database
      const expiresAt = new Date(Date.now() + 86400 * 1000); // 24 hours
      await this.pendingInviteRepo.create({
        telegram_id: telegramId,
        invite_code: invite.code,
        invite_url: invite.url,
        expires_at: expiresAt,
      });

      log.info('Created one-time Discord invite', {
        telegramId,
        inviteCode: invite.code,
      });

      return invite.url;
    } catch (error) {
      log.error('Failed to create Discord invite', { telegramId, error });
      return null;
    }
  }

  /**
   * Handle member join event - auto-link if they used pending invite
   */
  private async handleMemberJoin(member: GuildMember): Promise<void> {
    try {
      // Fetch recent invites to see which one was used
      const guildInvites = await member.guild.invites.fetch();

      // Check all pending invites to find which one matches
      for (const [code, invite] of guildInvites) {
        const pendingInvite = await this.pendingInviteRepo.findByCode(code);

        if (pendingInvite && !pendingInvite.used) {
          // This is our pending invite, check if it was just used
          if (invite.uses && invite.uses >= 1) {
            // Mark invite as used
            await this.pendingInviteRepo.markAsUsed(code);

            // Check if user already has a link
            const existingLink = await this.discordRepo.findByTelegramId(
              pendingInvite.telegram_id
            );

            if (existingLink) {
              // Deactivate old Discord account (remove role)
              await this.removeRole(existingLink.discord_id, config.discord.memberRoleId);
              log.info('Deactivated old Discord link', {
                telegramId: pendingInvite.telegram_id,
                oldDiscordId: existingLink.discord_id,
              });
            }

            // Create new link
            await this.discordRepo.upsert({
              telegram_id: pendingInvite.telegram_id,
              discord_id: member.id,
              discord_username: member.user.username,
              discord_discriminator: member.user.discriminator,
              discord_avatar: member.user.avatar || undefined,
              guild_id: member.guild.id,
              last_discord_change: new Date(),
            });

            // Add member role
            await this.addRole(member.id, config.discord.memberRoleId);

            log.info('Auto-linked Discord account via invite', {
              telegramId: pendingInvite.telegram_id,
              discordId: member.id,
              username: member.user.username,
            });

            break;
          }
        }
      }
    } catch (error) {
      log.error('Failed to handle member join', { error });
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
      const removed = await this.removeRole(
        link.discord_id,
        config.discord.memberRoleId
      );

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
   * Get active pending invite for user
   */
  async getActivePendingInvite(telegramId: number) {
    return await this.pendingInviteRepo.findActiveByTelegramId(telegramId);
  }

  /**
   * Check if bot is connected
   */
  isReady(): boolean {
    return this.isConnected && this.client.isReady();
  }
}
