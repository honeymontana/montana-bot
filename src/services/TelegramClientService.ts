import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { Api } from 'telegram/tl';
import { log } from '../utils/logger';
import { config } from '../config';

export class TelegramClientService {
  private client: TelegramClient | null = null;
  private session: StringSession;

  constructor() {
    this.session = new StringSession(config.telegram.sessionString || '');
  }

  async connect(): Promise<boolean> {
    try {
      if (!config.telegram.apiId || !config.telegram.apiHash) {
        log.error('API_ID and API_HASH are required for TelegramClient');
        return false;
      }

      this.client = new TelegramClient(
        this.session,
        config.telegram.apiId,
        config.telegram.apiHash,
        {
          connectionRetries: 5,
        }
      );

      await this.client.start({
        phoneNumber: async () => config.telegram.phoneNumber || '',
        password: async () => '', // 2FA password if enabled
        phoneCode: async () => {
          log.warn('Phone code required. Please provide it.');
          return '';
        },
        onError: (err) => log.error('TelegramClient error', err),
      });

      log.info('TelegramClient connected successfully');
      log.info('Session string:', this.client.session.save());

      return true;
    } catch (error) {
      log.error('Failed to connect TelegramClient', error);
      return false;
    }
  }

  async getAllChatMembers(chatId: number): Promise<any[]> {
    if (!this.client) {
      log.error('TelegramClient not connected');
      return [];
    }

    try {
      const members: any[] = [];
      let offset = 0;
      const limit = 200;

      while (true) {
        const result = await this.client.invoke(
          new Api.channels.GetParticipants({
            channel: chatId,
            filter: new Api.ChannelParticipantsRecent(),
            offset,
            limit,
            hash: BigInt(0),
          })
        );

        if (!result || result.users.length === 0) {
          break;
        }

        members.push(...result.users);
        offset += result.users.length;

        log.info(`Fetched ${members.length} members so far...`);

        if (result.users.length < limit) {
          break;
        }
      }

      log.info(`Total members fetched: ${members.length}`);
      return members;
    } catch (error) {
      log.error('Failed to get chat members', { chatId, error });
      return [];
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.disconnect();
      log.info('TelegramClient disconnected');
    }
  }
}
