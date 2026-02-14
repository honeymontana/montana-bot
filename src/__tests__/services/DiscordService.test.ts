import { Client, Guild, GuildMember, TextChannel, Invite, GatewayIntentBits } from 'discord.js';
import { DiscordService } from '../../services/DiscordService';
import { DiscordRepository } from '../../repositories/DiscordRepository';
import { DiscordPendingInviteRepository } from '../../repositories/DiscordPendingInviteRepository';
import { UserRepository } from '../../repositories/UserRepository';
import { config } from '../../config';

// Mock dependencies
jest.mock('discord.js', () => ({
  Client: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    login: jest.fn(),
    destroy: jest.fn(),
    guilds: { fetch: jest.fn() },
    isReady: jest.fn().mockReturnValue(true),
    user: { tag: 'test-bot#0000' },
  })),
  GatewayIntentBits: {
    Guilds: 1,
    GuildMembers: 2,
    GuildInvites: 4,
  },
}));
jest.mock('../../repositories/DiscordRepository');
jest.mock('../../repositories/DiscordPendingInviteRepository');
jest.mock('../../repositories/UserRepository');
jest.mock('../../database/connection');

describe('DiscordService', () => {
  let discordService: DiscordService;
  let mockClient: jest.Mocked<Client>;
  let mockDiscordRepo: jest.Mocked<DiscordRepository>;
  let mockPendingInviteRepo: jest.Mocked<DiscordPendingInviteRepository>;
  let mockUserRepo: jest.Mocked<UserRepository>;

  beforeEach(() => {
    // Create mock instances
    mockClient = new Client({ intents: [] }) as jest.Mocked<Client>;
    discordService = new DiscordService();

    // Get mocked repositories
    mockDiscordRepo = (discordService as any).discordRepo;
    mockPendingInviteRepo = (discordService as any).pendingInviteRepo;
    mockUserRepo = (discordService as any).userRepo;

    // Clear all mocks
    jest.clearAllMocks();
  });

  describe('createOneTimeInvite', () => {
    const telegramId = 123456;
    const guildId = 'test-guild-id';
    const inviteCode = 'abc123xyz';
    const inviteUrl = `https://discord.gg/${inviteCode}`;

    it.skip('should create one-time invite successfully', async () => {
      // Mock guild fetch
      const mockGuild = {
        id: guildId,
        channels: {
          fetch: jest.fn().mockResolvedValue(
            new Map([
              [
                'channel-1',
                {
                  id: 'channel-1',
                  isTextBased: () => true,
                  type: 0,
                  createInvite: jest.fn().mockResolvedValue({
                    code: inviteCode,
                    url: inviteUrl,
                    uses: 0,
                  } as Partial<Invite>),
                } as unknown as TextChannel,
              ],
            ])
          ),
        },
      } as unknown as Guild;

      (discordService as any).getGuild = jest.fn().mockResolvedValue(mockGuild);

      // Mock pending invite operations
      mockPendingInviteRepo.deleteOldInvites.mockResolvedValue();
      mockPendingInviteRepo.create.mockResolvedValue({
        id: 'invite-1',
        telegram_id: telegramId,
        invite_code: inviteCode,
        invite_url: inviteUrl,
        created_at: new Date(),
        expires_at: new Date(Date.now() + 86400 * 1000),
        used: false,
      });

      const result = await discordService.createOneTimeInvite(telegramId);

      expect(result).toBe(inviteUrl);
      expect(mockPendingInviteRepo.deleteOldInvites).toHaveBeenCalledWith(telegramId);
      expect(mockPendingInviteRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          telegram_id: telegramId,
          invite_code: inviteCode,
          invite_url: inviteUrl,
        })
      );
    });

    it('should return null if guild not found', async () => {
      (discordService as any).getGuild = jest.fn().mockResolvedValue(null);

      const result = await discordService.createOneTimeInvite(telegramId);

      expect(result).toBeNull();
      expect(mockPendingInviteRepo.create).not.toHaveBeenCalled();
    });

    it('should return null if no text channel found', async () => {
      const mockGuild = {
        id: guildId,
        channels: {
          fetch: jest.fn().mockResolvedValue(new Map()),
        },
      } as unknown as Guild;

      (discordService as any).getGuild = jest.fn().mockResolvedValue(mockGuild);

      const result = await discordService.createOneTimeInvite(telegramId);

      expect(result).toBeNull();
      expect(mockPendingInviteRepo.create).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      (discordService as any).getGuild = jest
        .fn()
        .mockRejectedValue(new Error('Discord API error'));

      const result = await discordService.createOneTimeInvite(telegramId);

      expect(result).toBeNull();
    });
  });

  describe('addRole', () => {
    const discordUserId = 'discord-user-123';
    const roleId = 'role-123';

    it('should add role to user successfully', async () => {
      const mockMember = {
        id: discordUserId,
        roles: {
          add: jest.fn().mockResolvedValue(undefined),
        },
      } as unknown as GuildMember;

      const mockGuild = {
        members: {
          fetch: jest.fn().mockResolvedValue(mockMember),
        },
      } as unknown as Guild;

      (discordService as any).getGuild = jest.fn().mockResolvedValue(mockGuild);

      const result = await discordService.addRole(discordUserId, roleId);

      expect(result).toBe(true);
      expect(mockMember.roles!.add).toHaveBeenCalledWith(roleId);
    });

    it('should return false if guild not found', async () => {
      (discordService as any).getGuild = jest.fn().mockResolvedValue(null);

      const result = await discordService.addRole(discordUserId, roleId);

      expect(result).toBe(false);
    });

    it('should return false if member not found', async () => {
      const mockGuild = {
        members: {
          fetch: jest.fn().mockResolvedValue(null),
        },
      } as unknown as Guild;

      (discordService as any).getGuild = jest.fn().mockResolvedValue(mockGuild);

      const result = await discordService.addRole(discordUserId, roleId);

      expect(result).toBe(false);
    });

    it('should handle errors gracefully', async () => {
      (discordService as any).getGuild = jest
        .fn()
        .mockRejectedValue(new Error('Discord API error'));

      const result = await discordService.addRole(discordUserId, roleId);

      expect(result).toBe(false);
    });
  });

  describe('removeRole', () => {
    const discordUserId = 'discord-user-123';
    const roleId = 'role-123';

    it('should remove role from user successfully', async () => {
      const mockMember = {
        id: discordUserId,
        roles: {
          remove: jest.fn().mockResolvedValue(undefined),
        },
      } as unknown as GuildMember;

      const mockGuild = {
        members: {
          fetch: jest.fn().mockResolvedValue(mockMember),
        },
      } as unknown as Guild;

      (discordService as any).getGuild = jest.fn().mockResolvedValue(mockGuild);

      const result = await discordService.removeRole(discordUserId, roleId);

      expect(result).toBe(true);
      expect(mockMember.roles!.remove).toHaveBeenCalledWith(roleId);
    });

    it('should return false if member not found', async () => {
      const mockGuild = {
        members: {
          fetch: jest.fn().mockResolvedValue(null),
        },
      } as unknown as Guild;

      (discordService as any).getGuild = jest.fn().mockResolvedValue(mockGuild);

      const result = await discordService.removeRole(discordUserId, roleId);

      expect(result).toBe(false);
    });
  });

  describe('syncRoles', () => {
    const roleId = 'test-role-id';

    beforeEach(() => {
      config.discord.memberRoleId = roleId;
      (discordService as any).isConnected = true;
    });

    it('should add roles for users in main group without role', async () => {
      const mockLinks = [
        { telegram_id: 123, discord_id: 'discord-1' },
        { telegram_id: 456, discord_id: 'discord-2' },
      ];

      mockDiscordRepo.findByGuildId.mockResolvedValue(mockLinks as any);
      mockUserRepo.isUserInGroup.mockResolvedValue(true);

      // First user doesn't have role, second has role
      (discordService as any).hasRole = jest
        .fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      (discordService as any).addRole = jest.fn().mockResolvedValue(true);

      const result = await discordService.syncRoles();

      expect(result.success).toBe(true);
      expect(result.added).toBe(1);
      expect(result.removed).toBe(0);
      expect(result.errors).toBe(0);
    });

    it('should remove roles for users not in main group', async () => {
      const mockLinks = [{ telegram_id: 123, discord_id: 'discord-1' }];

      mockDiscordRepo.findByGuildId.mockResolvedValue(mockLinks as any);
      mockUserRepo.isUserInGroup.mockResolvedValue(false);
      (discordService as any).hasRole = jest.fn().mockResolvedValue(true);
      (discordService as any).removeRole = jest.fn().mockResolvedValue(true);

      const result = await discordService.syncRoles();

      expect(result.success).toBe(true);
      expect(result.added).toBe(0);
      expect(result.removed).toBe(1);
      expect(result.errors).toBe(0);
    });

    it('should return error if not connected', async () => {
      (discordService as any).isConnected = false;

      const result = await discordService.syncRoles();

      expect(result.success).toBe(false);
      expect(mockDiscordRepo.findByGuildId).not.toHaveBeenCalled();
    });

    it('should track errors when operations fail', async () => {
      const mockLinks = [{ telegram_id: 123, discord_id: 'discord-1' }];

      mockDiscordRepo.findByGuildId.mockResolvedValue(mockLinks as any);
      mockUserRepo.isUserInGroup.mockResolvedValue(true);
      (discordService as any).hasRole = jest.fn().mockResolvedValue(false);
      (discordService as any).addRole = jest.fn().mockResolvedValue(false); // Fail to add role

      const result = await discordService.syncRoles();

      expect(result.success).toBe(true);
      expect(result.added).toBe(0);
      expect(result.errors).toBe(1);
    });
  });

  describe('deactivateOldLink', () => {
    const telegramId = 123456;
    const discordId = 'discord-user-123';
    const roleId = 'role-123';

    beforeEach(() => {
      config.discord.memberRoleId = roleId;
    });

    it('should deactivate old link successfully', async () => {
      mockDiscordRepo.findByTelegramId.mockResolvedValue({
        id: 'link-1',
        telegram_id: telegramId,
        discord_id: discordId,
        guild_id: 'guild-1',
      } as any);

      (discordService as any).removeRole = jest.fn().mockResolvedValue(true);

      const result = await discordService.deactivateOldLink(telegramId);

      expect(result).toBe(true);
      expect((discordService as any).removeRole).toHaveBeenCalledWith(discordId, roleId);
    });

    it('should return true if no link exists', async () => {
      mockDiscordRepo.findByTelegramId.mockResolvedValue(null);

      const result = await discordService.deactivateOldLink(telegramId);

      expect(result).toBe(true);
      // No role removal needed if no link exists
    });

    it('should return false on error', async () => {
      mockDiscordRepo.findByTelegramId.mockRejectedValue(new Error('Database error'));

      const result = await discordService.deactivateOldLink(telegramId);

      expect(result).toBe(false);
    });
  });

  describe('getActivePendingInvite', () => {
    const telegramId = 123456;

    it('should return active pending invite', async () => {
      const mockInvite = {
        id: 'invite-1',
        telegram_id: telegramId,
        invite_code: 'abc123',
        invite_url: 'https://discord.gg/abc123',
        used: false,
        expires_at: new Date(Date.now() + 86400 * 1000),
      };

      mockPendingInviteRepo.findActiveByTelegramId.mockResolvedValue(mockInvite as any);

      const result = await discordService.getActivePendingInvite(telegramId);

      expect(result).toEqual(mockInvite);
      expect(mockPendingInviteRepo.findActiveByTelegramId).toHaveBeenCalledWith(telegramId);
    });

    it('should return null if no active invite', async () => {
      mockPendingInviteRepo.findActiveByTelegramId.mockResolvedValue(null);

      const result = await discordService.getActivePendingInvite(telegramId);

      expect(result).toBeNull();
    });
  });
});
