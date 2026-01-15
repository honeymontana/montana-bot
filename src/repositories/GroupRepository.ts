import { query } from '../database/connection';
import { Group, UserGroup } from '../types';
import { log } from '../utils/logger';

export class GroupRepository {
  async findById(id: string): Promise<Group | null> {
    const result = await query('SELECT * FROM groups WHERE id = $1', [id]);
    return result.rows[0] || null;
  }

  async findByChatId(chatId: number): Promise<Group | null> {
    const result = await query('SELECT * FROM groups WHERE chat_id = $1', [chatId]);
    return result.rows[0] || null;
  }

  async findMainGroup(): Promise<Group | null> {
    const result = await query('SELECT * FROM groups WHERE is_main_group = true LIMIT 1');
    return result.rows[0] || null;
  }

  async findAllActive(): Promise<Group[]> {
    const result = await query(
      'SELECT * FROM groups WHERE is_active = true ORDER BY title'
    );
    return result.rows;
  }

  async findAllManaged(): Promise<Group[]> {
    const result = await query(
      'SELECT * FROM groups WHERE is_active = true AND is_main_group = false ORDER BY title'
    );
    return result.rows;
  }

  async create(group: Partial<Group>): Promise<Group> {
    const result = await query(
      `INSERT INTO groups (chat_id, title, username, description, is_active, is_main_group, is_permanent, access_duration_hours)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (chat_id) DO UPDATE
       SET title = EXCLUDED.title,
           username = EXCLUDED.username,
           description = EXCLUDED.description,
           is_active = EXCLUDED.is_active,
           is_main_group = EXCLUDED.is_main_group,
           is_permanent = EXCLUDED.is_permanent,
           access_duration_hours = EXCLUDED.access_duration_hours,
           updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [
        group.chat_id,
        group.title,
        group.username,
        group.description,
        group.is_active !== false,
        group.is_main_group || false,
        group.is_permanent || false,
        group.access_duration_hours || null,
      ]
    );
    log.info('Group created/updated', {
      chatId: group.chat_id,
      title: group.title,
      isPermanent: group.is_permanent,
      accessDurationHours: group.access_duration_hours
    });
    return result.rows[0];
  }

  async update(id: string, updates: Partial<Group>): Promise<Group | null> {
    const setClause = [];
    const values = [];
    let paramCounter = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (key !== 'id' && key !== 'chat_id') {
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
      `UPDATE groups SET ${setClause.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE id = $${paramCounter}
       RETURNING *`,
      values
    );

    return result.rows[0] || null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await query('DELETE FROM groups WHERE id = $1', [id]);
    return result.rowCount > 0;
  }

  async setActive(id: string, isActive: boolean): Promise<boolean> {
    const result = await query(
      'UPDATE groups SET is_active = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [id, isActive]
    );
    return result.rowCount > 0;
  }

  async getGroupMembers(groupId: string): Promise<any[]> {
    const result = await query(
      `SELECT u.*, ug.status, ug.joined_at
       FROM user_groups ug
       JOIN users u ON ug.user_id = u.id
       WHERE ug.group_id = $1
       AND ug.status IN ('member', 'admin', 'creator')
       ORDER BY ug.joined_at DESC`,
      [groupId]
    );
    return result.rows;
  }

  async getGroupMemberCount(groupId: string): Promise<number> {
    const result = await query(
      `SELECT COUNT(*) as count
       FROM user_groups
       WHERE group_id = $1
       AND status IN ('member', 'admin', 'creator')`,
      [groupId]
    );
    return parseInt(result.rows[0].count, 10);
  }

  async getMembersNotInMainGroup(mainGroupId: string): Promise<any[]> {
    const result = await query(
      `SELECT DISTINCT u.id as user_id, u.username, u.first_name, u.last_name,
              ug.group_id, g.title as group_title
       FROM user_groups ug
       JOIN users u ON ug.user_id = u.id
       JOIN groups g ON ug.group_id = g.id
       WHERE ug.status IN ('member', 'admin', 'creator')
       AND ug.group_id != $1
       AND NOT EXISTS (
         SELECT 1 FROM user_groups ug2
         WHERE ug2.user_id = ug.user_id
         AND ug2.group_id = $1
         AND ug2.status IN ('member', 'admin', 'creator')
       )`,
      [mainGroupId]
    );
    return result.rows;
  }

  async setMainGroup(chatId: number): Promise<Group | null> {
    // First, unset any existing main group
    await query('UPDATE groups SET is_main_group = false WHERE is_main_group = true');

    // Set new main group
    const result = await query(
      `UPDATE groups SET is_main_group = true, updated_at = CURRENT_TIMESTAMP
       WHERE chat_id = $1
       RETURNING *`,
      [chatId]
    );

    if (result.rows[0]) {
      log.info('Main group updated', { chatId });
    }

    return result.rows[0] || null;
  }

  async isGroupAccessible(groupId: string): Promise<boolean> {
    const result = await query(
      `SELECT access_duration_hours, created_at
       FROM groups
       WHERE id = $1`,
      [groupId]
    );

    if (!result.rows[0]) {
      return false;
    }

    const group = result.rows[0];

    // If no duration limit, always accessible
    if (!group.access_duration_hours) {
      return true;
    }

    // Check if access period has expired
    const createdAt = new Date(group.created_at);
    const expiresAt = new Date(createdAt.getTime() + group.access_duration_hours * 60 * 60 * 1000);
    const now = new Date();

    return now < expiresAt;
  }
}