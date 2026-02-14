import { DiscordPendingInviteRepository } from '../../repositories/DiscordPendingInviteRepository';
import { query } from '../../database/connection';

// Mock database connection
jest.mock('../../database/connection');

const mockQuery = query as jest.MockedFunction<typeof query>;

describe('DiscordPendingInviteRepository', () => {
  let repository: DiscordPendingInviteRepository;

  beforeEach(() => {
    repository = new DiscordPendingInviteRepository();
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a pending invite successfully', async () => {
      const telegramId = 123456;
      const inviteCode = 'abc123xyz';
      const inviteUrl = 'https://discord.gg/abc123xyz';
      const expiresAt = new Date(Date.now() + 86400 * 1000);

      const mockInvite = {
        id: 'invite-1',
        telegram_id: telegramId,
        invite_code: inviteCode,
        invite_url: inviteUrl,
        created_at: new Date(),
        expires_at: expiresAt,
        used: false,
        used_at: null,
      };

      mockQuery.mockResolvedValue({
        rows: [mockInvite],
        rowCount: 1,
      } as any);

      const result = await repository.create({
        telegram_id: telegramId,
        invite_code: inviteCode,
        invite_url: inviteUrl,
        expires_at: expiresAt,
      });

      expect(result).toEqual(mockInvite);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO discord_pending_invites'),
        [telegramId, inviteCode, inviteUrl, expiresAt]
      );
    });
  });

  describe('findByCode', () => {
    it('should find invite by code', async () => {
      const inviteCode = 'abc123xyz';
      const mockInvite = {
        id: 'invite-1',
        telegram_id: 123456,
        invite_code: inviteCode,
        invite_url: 'https://discord.gg/abc123xyz',
        created_at: new Date(),
        expires_at: new Date(Date.now() + 86400 * 1000),
        used: false,
      };

      mockQuery.mockResolvedValue({
        rows: [mockInvite],
        rowCount: 1,
      } as any);

      const result = await repository.findByCode(inviteCode);

      expect(result).toEqual(mockInvite);
      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT * FROM discord_pending_invites WHERE invite_code = $1',
        [inviteCode]
      );
    });

    it('should return null if invite not found', async () => {
      mockQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.findByCode('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('findActiveByTelegramId', () => {
    it('should find active invite for telegram user', async () => {
      const telegramId = 123456;
      const mockInvite = {
        id: 'invite-1',
        telegram_id: telegramId,
        invite_code: 'abc123',
        invite_url: 'https://discord.gg/abc123',
        created_at: new Date(),
        expires_at: new Date(Date.now() + 86400 * 1000),
        used: false,
      };

      mockQuery.mockResolvedValue({
        rows: [mockInvite],
        rowCount: 1,
      } as any);

      const result = await repository.findActiveByTelegramId(telegramId);

      expect(result).toEqual(mockInvite);
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('WHERE telegram_id = $1'), [
        telegramId,
      ]);
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('AND used = FALSE'), [
        telegramId,
      ]);
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('AND expires_at > NOW()'), [
        telegramId,
      ]);
    });

    it('should return null if no active invite found', async () => {
      mockQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.findActiveByTelegramId(999999);

      expect(result).toBeNull();
    });
  });

  describe('markAsUsed', () => {
    it('should mark invite as used successfully', async () => {
      const inviteCode = 'abc123';

      mockQuery.mockResolvedValue({
        rows: [],
        rowCount: 1,
      } as any);

      const result = await repository.markAsUsed(inviteCode);

      expect(result).toBe(true);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE discord_pending_invites'),
        [inviteCode]
      );
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SET used = TRUE, used_at = NOW()'),
        [inviteCode]
      );
    });

    it('should return false if invite not found', async () => {
      mockQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.markAsUsed('nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('deleteOldInvites', () => {
    it('should delete old and expired invites for user', async () => {
      const telegramId = 123456;

      mockQuery.mockResolvedValue({
        rows: [],
        rowCount: 3,
      } as any);

      await repository.deleteOldInvites(telegramId);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM discord_pending_invites'),
        [telegramId]
      );
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('WHERE telegram_id = $1'), [
        telegramId,
      ]);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('AND (used = TRUE OR expires_at < NOW())'),
        [telegramId]
      );
    });
  });

  describe('cleanupExpired', () => {
    it('should cleanup all expired and used invites', async () => {
      mockQuery.mockResolvedValue({
        rows: [],
        rowCount: 5,
      } as any);

      const result = await repository.cleanupExpired();

      expect(result).toBe(5);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM discord_pending_invites')
      );
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE expires_at < NOW() OR used = TRUE')
      );
    });

    it('should return 0 if no invites to cleanup', async () => {
      mockQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.cleanupExpired();

      expect(result).toBe(0);
    });
  });
});
