import { query, withTransaction } from '../database/connection';
import { User } from '../types';
import { log } from '../utils/logger';
import { PoolClient } from 'pg';

export class UserRepository {
  async findById(id: number): Promise<User | null> {
    const result = await query('SELECT * FROM users WHERE id = $1', [id]);
    return result.rows[0] || null;
  }

  async findByUsername(username: string): Promise<User | null> {
    const result = await query('SELECT * FROM users WHERE username = $1', [username]);
    return result.rows[0] || null;
  }

  async create(user: Partial<User>): Promise<User> {
    const result = await query(
      `INSERT INTO users (id, username, first_name, last_name, is_bot, language_code, is_premium)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE
       SET username = EXCLUDED.username,
           first_name = EXCLUDED.first_name,
           last_name = EXCLUDED.last_name,
           is_bot = EXCLUDED.is_bot,
           language_code = EXCLUDED.language_code,
           is_premium = EXCLUDED.is_premium,
           updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [
        user.id,
        user.username,
        user.first_name,
        user.last_name,
        user.is_bot || false,
        user.language_code,
        user.is_premium || false,
      ]
    );
    log.info('User created/updated', { userId: user.id });
    return result.rows[0];
  }

  async update(id: number, updates: Partial<User>): Promise<User | null> {
    const setClause = [];
    const values = [];
    let paramCounter = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (key !== 'id') {
        setClause.push(`${key} = $${paramCounter}`);
        values.push(value);
        paramCounter++;
      }
    }

    if (setClause.length === 0) {
      return this.findById(id);
    }

    values.push(id);
    const result = await query(
      `UPDATE users SET ${setClause.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE id = $${paramCounter}
       RETURNING *`,
      values
    );

    return result.rows[0] || null;
  }

  async delete(id: number): Promise<boolean> {
    const result = await query('DELETE FROM users WHERE id = $1', [id]);
    return result.rowCount > 0;
  }

  async getUserGroups(userId: number): Promise<any[]> {
    const result = await query(
      `SELECT g.*, ug.status, ug.joined_at
       FROM user_groups ug
       JOIN groups g ON ug.group_id = g.id
       WHERE ug.user_id = $1`,
      [userId]
    );
    return result.rows;
  }

  async isUserInGroup(userId: number, groupChatId: string): Promise<boolean> {
    const result = await query(
      `SELECT 1 FROM user_groups ug
       JOIN groups g ON ug.group_id = g.id
       WHERE ug.user_id = $1 AND g.chat_id = $2
       AND ug.status IN ('member', 'admin', 'creator')`,
      [userId, parseInt(groupChatId)]
    );
    return result.rowCount > 0;
  }

  async addToGroup(userId: number, groupId: string, status: string = 'member'): Promise<void> {
    await query(
      `INSERT INTO user_groups (user_id, group_id, status)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, group_id) DO UPDATE
       SET status = EXCLUDED.status, joined_at = CURRENT_TIMESTAMP`,
      [userId, groupId, status]
    );
    log.info('User added to group', { userId, groupId, status });
  }

  async removeFromGroup(userId: number, groupId: string): Promise<boolean> {
    const result = await query('DELETE FROM user_groups WHERE user_id = $1 AND group_id = $2', [
      userId,
      groupId,
    ]);
    if (result.rowCount > 0) {
      log.info('User removed from group', { userId, groupId });
    }
    return result.rowCount > 0;
  }

  async updateGroupStatus(userId: number, groupId: string, status: string): Promise<boolean> {
    const result = await query(
      'UPDATE user_groups SET status = $3 WHERE user_id = $1 AND group_id = $2',
      [userId, groupId, status]
    );
    return result.rowCount > 0;
  }

  async removeFromAllGroups(userId: number, client?: PoolClient): Promise<number> {
    const queryFn = client ? client.query.bind(client) : query;
    const result = await queryFn('DELETE FROM user_groups WHERE user_id = $1', [userId]);
    if (result.rowCount > 0) {
      log.info('User removed from all groups', { userId, count: result.rowCount });
    }
    return result.rowCount;
  }
}
