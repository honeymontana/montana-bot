import { DiscordRepository } from '../../repositories/DiscordRepository';
import { query } from '../../database/connection';

// Mock database connection
jest.mock('../../database/connection');

const mockQuery = query as jest.MockedFunction<typeof query>;

describe('DiscordRepository', () => {
  let repository: DiscordRepository;

  beforeEach(() => {
    repository = new DiscordRepository();
    jest.clearAllMocks();
  });

  describe('upsert', () => {
    it('should create new Discord link', async () => {
      const telegramId = 123456;
      const discordId = 'discord-user-123';
      const discordUsername = 'testuser';
      const guildId = 'guild-123';

      const mockLink = {
        id: 'link-1',
        telegram_id: telegramId,
        discord_id: discordId,
        discord_username: discordUsername,
        guild_id: guildId,
        linked_at: new Date(),
        updated_at: new Date(),
        last_discord_change: new Date(),
      };

      mockQuery.mockResolvedValue({
        rows: [mockLink],
        rowCount: 1,
      } as any);

      const result = await repository.upsert({
        telegram_id: telegramId,
        discord_id: discordId,
        discord_username: discordUsername,
        guild_id: guildId,
        last_discord_change: new Date(),
      });

      expect(result).toEqual(mockLink);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO discord_links'),
        expect.arrayContaining([telegramId, discordId, discordUsername])
      );
    });

    it('should update existing Discord link on conflict', async () => {
      const telegramId = 123456;
      const newDiscordId = 'new-discord-id';
      const newUsername = 'newuser';

      const mockLink = {
        id: 'link-1',
        telegram_id: telegramId,
        discord_id: newDiscordId,
        discord_username: newUsername,
        guild_id: 'guild-123',
        linked_at: new Date(),
        updated_at: new Date(),
        last_discord_change: new Date(),
      };

      mockQuery.mockResolvedValue({
        rows: [mockLink],
        rowCount: 1,
      } as any);

      const result = await repository.upsert({
        telegram_id: telegramId,
        discord_id: newDiscordId,
        discord_username: newUsername,
        last_discord_change: new Date(),
      });

      expect(result).toEqual(mockLink);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT (telegram_id) DO UPDATE'),
        expect.any(Array)
      );
    });
  });

  describe('findByTelegramId', () => {
    it('should find Discord link by telegram ID', async () => {
      const telegramId = 123456;
      const mockLink = {
        id: 'link-1',
        telegram_id: telegramId,
        discord_id: 'discord-123',
        discord_username: 'testuser',
        guild_id: 'guild-123',
        linked_at: new Date(),
      };

      mockQuery.mockResolvedValue({
        rows: [mockLink],
        rowCount: 1,
      } as any);

      const result = await repository.findByTelegramId(telegramId);

      expect(result).toEqual(mockLink);
      expect(mockQuery).toHaveBeenCalledWith('SELECT * FROM discord_links WHERE telegram_id = $1', [
        telegramId,
      ]);
    });

    it('should return null if link not found', async () => {
      mockQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.findByTelegramId(999999);

      expect(result).toBeNull();
    });
  });

  describe('findByDiscordId', () => {
    it('should find Discord link by discord ID', async () => {
      const discordId = 'discord-user-123';
      const mockLink = {
        id: 'link-1',
        telegram_id: 123456,
        discord_id: discordId,
        discord_username: 'testuser',
        guild_id: 'guild-123',
        linked_at: new Date(),
      };

      mockQuery.mockResolvedValue({
        rows: [mockLink],
        rowCount: 1,
      } as any);

      const result = await repository.findByDiscordId(discordId);

      expect(result).toEqual(mockLink);
      expect(mockQuery).toHaveBeenCalledWith('SELECT * FROM discord_links WHERE discord_id = $1', [
        discordId,
      ]);
    });

    it('should return null if link not found', async () => {
      mockQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.findByDiscordId('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('findByGuildId', () => {
    it('should find all links for a guild', async () => {
      const guildId = 'guild-123';
      const mockLinks = [
        {
          id: 'link-1',
          telegram_id: 111,
          discord_id: 'discord-1',
          guild_id: guildId,
        },
        {
          id: 'link-2',
          telegram_id: 222,
          discord_id: 'discord-2',
          guild_id: guildId,
        },
      ];

      mockQuery.mockResolvedValue({
        rows: mockLinks,
        rowCount: 2,
      } as any);

      const result = await repository.findByGuildId(guildId);

      expect(result).toEqual(mockLinks);
      expect(result).toHaveLength(2);
      expect(mockQuery).toHaveBeenCalledWith('SELECT * FROM discord_links WHERE guild_id = $1', [
        guildId,
      ]);
    });

    it('should return empty array if no links found', async () => {
      mockQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.findByGuildId('nonexistent');

      expect(result).toEqual([]);
    });
  });

  describe('deleteByTelegramId', () => {
    it('should delete Discord link by telegram ID', async () => {
      const telegramId = 123456;

      mockQuery.mockResolvedValue({
        rows: [],
        rowCount: 1,
      } as any);

      const result = await repository.deleteByTelegramId(telegramId);

      expect(result).toBe(true);
      expect(mockQuery).toHaveBeenCalledWith('DELETE FROM discord_links WHERE telegram_id = $1', [
        telegramId,
      ]);
    });

    it('should return false if link not found', async () => {
      mockQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.deleteByTelegramId(999999);

      expect(result).toBe(false);
    });
  });

  describe('deleteByDiscordId', () => {
    it('should delete Discord link by discord ID', async () => {
      const discordId = 'discord-user-123';

      mockQuery.mockResolvedValue({
        rows: [],
        rowCount: 1,
      } as any);

      const result = await repository.deleteByDiscordId(discordId);

      expect(result).toBe(true);
      expect(mockQuery).toHaveBeenCalledWith('DELETE FROM discord_links WHERE discord_id = $1', [
        discordId,
      ]);
    });

    it('should return false if link not found', async () => {
      mockQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.deleteByDiscordId('nonexistent');

      expect(result).toBe(false);
    });
  });
});
