import TelegramBot from 'node-telegram-bot-api';

export interface User {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  is_bot: boolean;
  language_code?: string;
  is_premium?: boolean;
  created_at?: Date;
  updated_at?: Date;
}

export interface Group {
  id: string;
  chat_id: number;
  title: string;
  username?: string;
  description?: string;
  is_active: boolean;
  is_main_group: boolean;
  is_permanent: boolean;
  access_duration_hours?: number | null;
  created_at?: Date;
  updated_at?: Date;
}

export interface UserGroup {
  user_id: number;
  group_id: string;
  joined_at?: Date;
  status: 'member' | 'admin' | 'creator' | 'restricted' | 'left' | 'kicked';
}

export interface JoinRequest {
  id: string;
  user_id: number;
  group_id: string;
  status: 'pending' | 'approved' | 'rejected';
  requested_at?: Date;
  processed_at?: Date;
  processed_by?: number;
  reason?: string;
}

export interface BotSetting {
  key: string;
  value: string;
  description?: string;
  updated_at?: Date;
}

export interface ActivityLog {
  id: string;
  user_id?: number;
  action: string;
  details?: any;
  ip_address?: string;
  user_agent?: string;
  created_at?: Date;
}

export type BotCommand = {
  command: string;
  description: string;
  handler: (msg: TelegramBot.Message) => Promise<void>;
};

export type CallbackQuery = {
  pattern: RegExp;
  handler: (query: TelegramBot.CallbackQuery) => Promise<void>;
};

export interface MembershipCheckResult {
  isInMainGroup: boolean;
  user?: TelegramBot.ChatMember;
}

export interface UserToRemove {
  userId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  groups: Array<{
    groupId: string;
    groupTitle: string;
    chatId: number;
  }>;
}

export interface JoinRequestResult {
  approved: boolean;
  reason?: 'not_in_main_group' | 'access_window_closed' | 'error';
}