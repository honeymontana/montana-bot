import { query } from '../database/connection';
import { DiscordPendingInvite } from '../types';
import { log } from '../utils/logger';

export class DiscordPendingInviteRepository {
  /**
   * Create pending invite
   */
  async create(invite: Partial<DiscordPendingInvite>): Promise<DiscordPendingInvite> {
    const result = await query(
      `INSERT INTO discord_pending_invites (
        telegram_id, invite_code, invite_url, expires_at
      )
      VALUES ($1, $2, $3, $4)
      RETURNING *`,
      [invite.telegram_id, invite.invite_code, invite.invite_url, invite.expires_at]
    );

    log.info('Discord pending invite created', {
      telegramId: invite.telegram_id,
      inviteCode: invite.invite_code,
    });

    return result.rows[0];
  }

  /**
   * Find by invite code
   */
  async findByCode(code: string): Promise<DiscordPendingInvite | null> {
    const result = await query('SELECT * FROM discord_pending_invites WHERE invite_code = $1', [
      code,
    ]);
    return result.rows[0] || null;
  }

  /**
   * Find active invite by telegram ID
   */
  async findActiveByTelegramId(telegramId: number): Promise<DiscordPendingInvite | null> {
    const result = await query(
      `SELECT * FROM discord_pending_invites
       WHERE telegram_id = $1
       AND used = FALSE
       AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1`,
      [telegramId]
    );
    return result.rows[0] || null;
  }

  /**
   * Mark invite as used
   */
  async markAsUsed(code: string): Promise<boolean> {
    const result = await query(
      `UPDATE discord_pending_invites
       SET used = TRUE, used_at = NOW()
       WHERE invite_code = $1`,
      [code]
    );

    if (result.rowCount > 0) {
      log.info('Discord invite marked as used', { code });
    }

    return result.rowCount > 0;
  }

  /**
   * Delete old/expired invites
   */
  async deleteOldInvites(telegramId: number): Promise<void> {
    await query(
      `DELETE FROM discord_pending_invites
       WHERE telegram_id = $1
       AND (used = TRUE OR expires_at < NOW())`,
      [telegramId]
    );
  }

  /**
   * Get recent unused pending invites for a guild
   */
  async getRecentUnused(guildId: string, minutes: number): Promise<DiscordPendingInvite[]> {
    const result = await query(
      `SELECT dpi.*
       FROM discord_pending_invites dpi
       JOIN discord_links dl ON dpi.telegram_id = dl.telegram_id
       WHERE dl.guild_id = $1
       AND dpi.used = FALSE
       AND dpi.expires_at > NOW()
       AND dpi.created_at > NOW() - INTERVAL '${minutes} minutes'
       ORDER BY dpi.created_at DESC`,
      [guildId]
    );

    // If no results with guild_id match, try without guild filter
    // (for pending invites created before linking)
    if (result.rows.length === 0) {
      const fallbackResult = await query(
        `SELECT *
         FROM discord_pending_invites
         WHERE used = FALSE
         AND expires_at > NOW()
         AND created_at > NOW() - INTERVAL '${minutes} minutes'
         ORDER BY created_at DESC`
      );
      return fallbackResult.rows;
    }

    return result.rows;
  }

  /**
   * Cleanup expired invites (cron job)
   */
  async cleanupExpired(): Promise<number> {
    const result = await query(
      `DELETE FROM discord_pending_invites
       WHERE expires_at < NOW() OR used = TRUE`
    );

    const deleted = result.rowCount;
    if (deleted > 0) {
      log.info('Cleaned up expired Discord invites', { count: deleted });
    }

    return deleted;
  }
}
