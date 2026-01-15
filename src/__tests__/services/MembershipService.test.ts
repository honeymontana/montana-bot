import TelegramBot from 'node-telegram-bot-api';
import { MembershipService } from '../../services/MembershipService';
import { UserRepository } from '../../repositories/UserRepository';
import { GroupRepository } from '../../repositories/GroupRepository';
import { config } from '../../config';

// Mock dependencies
jest.mock('node-telegram-bot-api');
jest.mock('../../repositories/UserRepository');
jest.mock('../../repositories/GroupRepository');
jest.mock('../../database/connection');

describe('MembershipService', () => {
  let membershipService: MembershipService;
  let mockBot: jest.Mocked<TelegramBot>;
  let mockUserRepo: jest.Mocked<UserRepository>;
  let mockGroupRepo: jest.Mocked<GroupRepository>;

  beforeEach(() => {
    // Create mock instances
    mockBot = new TelegramBot('test-token') as jest.Mocked<TelegramBot>;
    membershipService = new MembershipService(mockBot);

    // Get mocked repositories
    mockUserRepo = (membershipService as any).userRepo;
    mockGroupRepo = (membershipService as any).groupRepo;

    // Clear all mocks
    jest.clearAllMocks();
  });

  describe('checkMainGroupMembership', () => {
    it('should return true if user is member of main group', async () => {
      const userId = 123456;
      const mockMember = {
        status: 'member',
        user: { id: userId },
      } as TelegramBot.ChatMember;

      mockBot.getChatMember.mockResolvedValue(mockMember);

      const result = await membershipService.checkMainGroupMembership(userId);

      expect(mockBot.getChatMember).toHaveBeenCalledWith(
        config.telegram.mainGroupId,
        userId
      );
      expect(result.isInMainGroup).toBe(true);
      expect(result.user).toEqual(mockMember);
    });

    it('should return false if user is not member of main group', async () => {
      const userId = 123456;
      const mockMember = {
        status: 'left',
        user: { id: userId },
      } as TelegramBot.ChatMember;

      mockBot.getChatMember.mockResolvedValue(mockMember);

      const result = await membershipService.checkMainGroupMembership(userId);

      expect(result.isInMainGroup).toBe(false);
    });

    it('should handle errors gracefully', async () => {
      const userId = 123456;

      mockBot.getChatMember.mockRejectedValue(new Error('User not found'));

      const result = await membershipService.checkMainGroupMembership(userId);

      expect(result.isInMainGroup).toBe(false);
      expect(result.user).toBeUndefined();
    });
  });

  describe('processJoinRequest', () => {
    const userId = 123456;
    const chatId = -987654321;
    const userInfo = {
      id: userId,
      is_bot: false,
      first_name: 'Test',
      username: 'testuser',
    } as TelegramBot.User;

    it('should approve join request if user is in main group', async () => {
      // Mock main group membership check
      mockBot.getChatMember.mockResolvedValue({
        status: 'member',
        user: userInfo,
      } as TelegramBot.ChatMember);

      // Mock user creation
      mockUserRepo.create.mockResolvedValue({
        id: userId,
        username: 'testuser',
        first_name: 'Test',
        is_bot: false,
        is_premium: false,
      });

      // Mock group finding/creation
      mockGroupRepo.findByChatId.mockResolvedValue(null);
      mockBot.getChat.mockResolvedValue({
        id: chatId,
        type: 'supergroup',
        title: 'Test Group',
      } as TelegramBot.Chat);

      mockGroupRepo.create.mockResolvedValue({
        id: 'group-1',
        chat_id: chatId,
        title: 'Test Group',
        is_active: true,
        is_main_group: false,
      });

      // Mock adding user to group
      mockUserRepo.addToGroup.mockResolvedValue();

      // Mock approving request
      mockBot.approveChatJoinRequest.mockResolvedValue(true);

      const result = await membershipService.processJoinRequest(userId, chatId, userInfo);

      expect(result).toBe(true);
      expect(mockBot.approveChatJoinRequest).toHaveBeenCalledWith(chatId, userId);
      expect(mockUserRepo.addToGroup).toHaveBeenCalledWith(userId, 'group-1', 'member');
    });

    it('should reject join request if user is not in main group', async () => {
      // Mock main group membership check - user not in group
      mockBot.getChatMember.mockResolvedValue({
        status: 'left',
        user: userInfo,
      } as TelegramBot.ChatMember);

      const result = await membershipService.processJoinRequest(userId, chatId, userInfo);

      expect(result).toBe(false);
      expect(mockBot.approveChatJoinRequest).not.toHaveBeenCalled();
      expect(mockUserRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('handleMainGroupLeave', () => {
    it('should remove user from all managed groups', async () => {
      const userId = 123456;

      // Mock user groups
      mockUserRepo.getUserGroups.mockResolvedValue([
        {
          id: 'group-1',
          chat_id: -111111,
          title: 'Group 1',
          is_main_group: false,
        },
        {
          id: 'group-2',
          chat_id: -222222,
          title: 'Group 2',
          is_main_group: false,
        },
        {
          id: 'main-group',
          chat_id: -333333,
          title: 'Main Group',
          is_main_group: true,
        },
      ]);

      // Mock ban/unban operations
      mockBot.banChatMember.mockResolvedValue(true);
      mockBot.unbanChatMember.mockResolvedValue(true);

      // Mock removing from all groups
      mockUserRepo.removeFromAllGroups.mockResolvedValue(3);

      await membershipService.handleMainGroupLeave(userId);

      // Should ban from non-main groups only
      expect(mockBot.banChatMember).toHaveBeenCalledTimes(2);
      expect(mockBot.banChatMember).toHaveBeenCalledWith(-111111, userId);
      expect(mockBot.banChatMember).toHaveBeenCalledWith(-222222, userId);

      // Should unban immediately to allow future rejoin
      expect(mockBot.unbanChatMember).toHaveBeenCalledTimes(2);

      // Should remove from all groups in database
      expect(mockUserRepo.removeFromAllGroups).toHaveBeenCalledWith(userId, expect.anything());
    });
  });

  describe('getAvailableGroups', () => {
    it('should return managed groups if user is in main group', async () => {
      const userId = 123456;

      // Mock main group membership check
      mockBot.getChatMember.mockResolvedValue({
        status: 'member',
        user: { id: userId },
      } as TelegramBot.ChatMember);

      const mockGroups = [
        { id: 'group-1', title: 'Group 1' },
        { id: 'group-2', title: 'Group 2' },
      ];

      mockGroupRepo.findAllManaged.mockResolvedValue(mockGroups as any);

      const result = await membershipService.getAvailableGroups(userId);

      expect(result).toEqual(mockGroups);
      expect(mockGroupRepo.findAllManaged).toHaveBeenCalled();
    });

    it('should return empty array if user is not in main group', async () => {
      const userId = 123456;

      // Mock main group membership check - not a member
      mockBot.getChatMember.mockResolvedValue({
        status: 'left',
        user: { id: userId },
      } as TelegramBot.ChatMember);

      const result = await membershipService.getAvailableGroups(userId);

      expect(result).toEqual([]);
      expect(mockGroupRepo.findAllManaged).not.toHaveBeenCalled();
    });
  });
});