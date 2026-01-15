import { UserRepository } from '../../repositories/UserRepository';
import * as db from '../../database/connection';
import { User } from '../../types';

// Mock database connection
jest.mock('../../database/connection');

describe('UserRepository', () => {
  let userRepo: UserRepository;
  let mockQuery: jest.Mock;

  beforeEach(() => {
    userRepo = new UserRepository();
    mockQuery = db.query as jest.Mock;
    mockQuery.mockClear();
  });

  describe('findById', () => {
    it('should find user by id', async () => {
      const mockUser: User = {
        id: 123456,
        username: 'testuser',
        first_name: 'Test',
        last_name: 'User',
        is_bot: false,
        is_premium: false,
      };

      mockQuery.mockResolvedValue({ rows: [mockUser] });

      const result = await userRepo.findById(123456);

      expect(mockQuery).toHaveBeenCalledWith('SELECT * FROM users WHERE id = $1', [123456]);
      expect(result).toEqual(mockUser);
    });

    it('should return null when user not found', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const result = await userRepo.findById(999999);

      expect(mockQuery).toHaveBeenCalledWith('SELECT * FROM users WHERE id = $1', [999999]);
      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    it('should create or update user', async () => {
      const newUser: Partial<User> = {
        id: 123456,
        username: 'newuser',
        first_name: 'New',
        last_name: 'User',
        is_bot: false,
      };

      const createdUser: User = {
        ...newUser as User,
        is_premium: false,
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockQuery.mockResolvedValue({ rows: [createdUser] });

      const result = await userRepo.create(newUser);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO users'),
        [
          newUser.id,
          newUser.username,
          newUser.first_name,
          newUser.last_name,
          false,
          undefined,
          false,
        ]
      );
      expect(result).toEqual(createdUser);
    });
  });

  describe('getUserGroups', () => {
    it('should get all groups for a user', async () => {
      const mockGroups = [
        {
          id: 'group-1',
          title: 'Group 1',
          status: 'member',
          joined_at: new Date(),
        },
        {
          id: 'group-2',
          title: 'Group 2',
          status: 'admin',
          joined_at: new Date(),
        },
      ];

      mockQuery.mockResolvedValue({ rows: mockGroups });

      const result = await userRepo.getUserGroups(123456);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT g.*, ug.status, ug.joined_at'),
        [123456]
      );
      expect(result).toEqual(mockGroups);
    });
  });

  describe('isUserInGroup', () => {
    it('should return true if user is in group', async () => {
      mockQuery.mockResolvedValue({ rowCount: 1 });

      const result = await userRepo.isUserInGroup(123456, 'group-1');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT 1 FROM user_groups'),
        [123456, 'group-1']
      );
      expect(result).toBe(true);
    });

    it('should return false if user is not in group', async () => {
      mockQuery.mockResolvedValue({ rowCount: 0 });

      const result = await userRepo.isUserInGroup(123456, 'group-1');

      expect(result).toBe(false);
    });
  });

  describe('addToGroup', () => {
    it('should add user to group', async () => {
      mockQuery.mockResolvedValue({ rowCount: 1 });

      await userRepo.addToGroup(123456, 'group-1', 'member');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO user_groups'),
        [123456, 'group-1', 'member']
      );
    });
  });

  describe('removeFromGroup', () => {
    it('should remove user from group', async () => {
      mockQuery.mockResolvedValue({ rowCount: 1 });

      const result = await userRepo.removeFromGroup(123456, 'group-1');

      expect(mockQuery).toHaveBeenCalledWith(
        'DELETE FROM user_groups WHERE user_id = $1 AND group_id = $2',
        [123456, 'group-1']
      );
      expect(result).toBe(true);
    });

    it('should return false if user was not in group', async () => {
      mockQuery.mockResolvedValue({ rowCount: 0 });

      const result = await userRepo.removeFromGroup(123456, 'group-1');

      expect(result).toBe(false);
    });
  });

  describe('removeFromAllGroups', () => {
    it('should remove user from all groups', async () => {
      mockQuery.mockResolvedValue({ rowCount: 3 });

      const result = await userRepo.removeFromAllGroups(123456);

      expect(mockQuery).toHaveBeenCalledWith(
        'DELETE FROM user_groups WHERE user_id = $1',
        [123456]
      );
      expect(result).toBe(3);
    });
  });
});