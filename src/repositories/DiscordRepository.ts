import { query } from '../database/connection';
import { DiscordLink } from '../types';
import { log } from '../utils/logger';

export class DiscordRepository {
  /**
   * Find Discord link by Telegram ID
   */
  async findByTelegramId(telegramId: number): Promise<DiscordLink | null> {
    const result = await query('SELECT * FROM discord_links WHERE telegram_id = $1', [telegramId]);
    return result.rows[0] || null;
  }

  /**
   * Find Discord link by Discord ID
   */
  async findByDiscordId(discordId: string): Promise<DiscordLink | null> {
    const result = await query('SELECT * FROM discord_links WHERE discord_id = $1', [discordId]);
    return result.rows[0] || null;
  }

  /**
   * Create or update Discord link
   */
  async upsert(link: Partial<DiscordLink>): Promise<DiscordLink> {
    // If telegram_id already linked to another discord account, remove old link
    if (link.telegram_id) {
      const existing = await this.findByTelegramId(link.telegram_id);
      if (existing && existing.discord_id !== link.discord_id) {
        await this.deleteByTelegramId(link.telegram_id);
        log.info('Removed old Discord link for Telegram user', {
          telegramId: link.telegram_id,
          oldDiscordId: existing.discord_id,
          newDiscordId: link.discord_id,
        });
      }
    }

    const result = await query(
      `INSERT INTO discord_links (
        telegram_id, discord_id, discord_username,
        discord_discriminator, discord_avatar, guild_id, last_discord_change
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (telegram_id) DO UPDATE
      SET discord_id = EXCLUDED.discord_id,
          discord_username = EXCLUDED.discord_username,
          discord_discriminator = EXCLUDED.discord_discriminator,
          discord_avatar = EXCLUDED.discord_avatar,
          guild_id = EXCLUDED.guild_id,
          last_discord_change = EXCLUDED.last_discord_change,
          updated_at = CURRENT_TIMESTAMP
      RETURNING *`,
      [
        link.telegram_id,
        link.discord_id,
        link.discord_username,
        link.discord_discriminator,
        link.discord_avatar,
        link.guild_id || process.env.DISCORD_GUILD_ID || '',
        link.last_discord_change || null,
      ]
    );

    log.info('Discord link created/updated', {
      telegramId: link.telegram_id,
      discordId: link.discord_id,
    });

    return result.rows[0];
  }

  /**
   * Delete Discord link by Telegram ID
   */
  async deleteByTelegramId(telegramId: number): Promise<boolean> {
    const result = await query('DELETE FROM discord_links WHERE telegram_id = $1', [telegramId]);

    if (result.rowCount > 0) {
      log.info('Discord link deleted', { telegramId });
    }

    return result.rowCount > 0;
  }

  /**
   * Delete Discord link by Discord ID
   */
  async deleteByDiscordId(discordId: string): Promise<boolean> {
    const result = await query('DELETE FROM discord_links WHERE discord_id = $1', [discordId]);

    if (result.rowCount > 0) {
      log.info('Discord link deleted', { discordId });
    }

    return result.rowCount > 0;
  }

  /**
   * Get all Discord links for a specific guild
   */
  async findByGuildId(guildId: string): Promise<DiscordLink[]> {
    const result = await query('SELECT * FROM discord_links WHERE guild_id = $1', [guildId]);
    return result.rows;
  }

  /**
   * Get all Discord links
   */
  async findAll(): Promise<DiscordLink[]> {
    const result = await query('SELECT * FROM discord_links');
    return result.rows;
  }

  /**
   * Check if Telegram user is linked to Discord
   */
  async isLinked(telegramId: number): Promise<boolean> {
    const result = await query('SELECT 1 FROM discord_links WHERE telegram_id = $1', [telegramId]);
    return result.rowCount > 0;
  }
}
