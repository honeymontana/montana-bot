import express, { Request, Response } from 'express';
import axios from 'axios';
import { DiscordRepository } from '../repositories/DiscordRepository';
import { log } from '../utils/logger';
import { config } from '../config';
import TelegramBot from 'node-telegram-bot-api';
import { DiscordService } from './DiscordService';

interface OAuthState {
  state: string;
  telegramId: number;
  createdAt: number;
}

export class DiscordOAuthServer {
  private app: express.Application;
  private discordRepo: DiscordRepository;
  private bot: TelegramBot;
  private discordService: DiscordService;
  private stateStore: Map<string, OAuthState> = new Map();
  private readonly STATE_EXPIRY = 10 * 60 * 1000; // 10 minutes

  constructor(bot: TelegramBot, discordService: DiscordService) {
    this.app = express();
    this.discordRepo = new DiscordRepository();
    this.bot = bot;
    this.discordService = discordService;
    this.setupRoutes();
    this.cleanupExpiredStates();
  }

  /**
   * Setup Express routes
   */
  private setupRoutes(): void {
    this.app.get('/auth/discord', this.handleAuthRedirect.bind(this));
    this.app.get('/auth/discord/callback', this.handleCallback.bind(this));
    this.app.get('/health', (req, res) => res.json({ status: 'ok' }));
  }

  /**
   * Generate OAuth state
   */
  private generateState(telegramId: number): string {
    const state = Math.random().toString(36).substring(2, 15);
    this.stateStore.set(state, {
      state,
      telegramId,
      createdAt: Date.now(),
    });
    return state;
  }

  /**
   * Validate OAuth state
   */
  private validateState(state: string): OAuthState | null {
    const stored = this.stateStore.get(state);
    if (!stored) {
      return null;
    }

    // Check if expired
    if (Date.now() - stored.createdAt > this.STATE_EXPIRY) {
      this.stateStore.delete(state);
      return null;
    }

    return stored;
  }

  /**
   * Cleanup expired states periodically
   */
  private cleanupExpiredStates(): void {
    setInterval(() => {
      const now = Date.now();
      for (const [state, data] of this.stateStore.entries()) {
        if (now - data.createdAt > this.STATE_EXPIRY) {
          this.stateStore.delete(state);
        }
      }
    }, 60000); // Every minute
  }

  /**
   * Handle initial auth redirect
   */
  private handleAuthRedirect(req: Request, res: Response): void {
    try {
      const telegramId = req.query.telegram_id;

      if (!telegramId || typeof telegramId !== 'string') {
        res.status(400).send('Invalid telegram_id parameter');
        return;
      }

      const state = this.generateState(parseInt(telegramId));

      const params = new URLSearchParams({
        client_id: config.discord.clientId,
        redirect_uri: config.discord.redirectUri,
        response_type: 'code',
        scope: 'identify guilds.join',
        state,
      });

      const authUrl = `https://discord.com/api/oauth2/authorize?${params.toString()}`;
      res.redirect(authUrl);
    } catch (error) {
      log.error('Failed to handle auth redirect', error);
      res.status(500).send('Internal server error');
    }
  }

  /**
   * Handle OAuth callback
   */
  private async handleCallback(req: Request, res: Response): Promise<void> {
    try {
      const code = req.query.code as string;
      const state = req.query.state as string;

      if (!code || !state) {
        res.status(400).send('Missing code or state parameter');
        return;
      }

      // Validate state
      const stateData = this.validateState(state);
      if (!stateData) {
        res.status(400).send('Invalid or expired state parameter');
        return;
      }

      // Exchange code for token
      const tokenResponse = await axios.post(
        'https://discord.com/api/oauth2/token',
        new URLSearchParams({
          client_id: config.discord.clientId,
          client_secret: config.discord.clientSecret,
          code,
          grant_type: 'authorization_code',
          redirect_uri: config.discord.redirectUri,
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      const { access_token } = tokenResponse.data;

      // Get user info
      const userResponse = await axios.get('https://discord.com/api/users/@me', {
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      });

      const discordUser = userResponse.data;

      // Save link to database
      await this.discordRepo.upsert({
        telegram_id: stateData.telegramId,
        discord_id: discordUser.id,
        discord_username: discordUser.username,
        discord_discriminator: discordUser.discriminator,
        discord_avatar: discordUser.avatar,
        guild_id: config.discord.guildId,
      });

      // Add role to Discord user if they're in Montana main group
      const roleId = config.discord.memberRoleId;
      if (roleId && this.discordService.isReady()) {
        await this.discordService.addRole(discordUser.id, roleId);
        log.info('Added Montana member role to Discord user', {
          discordId: discordUser.id,
          telegramId: stateData.telegramId,
        });
      }

      // Clean up state
      this.stateStore.delete(state);

      // Notify user via Telegram
      try {
        await this.bot.sendMessage(
          stateData.telegramId,
          `✅ Ваш Discord аккаунт успешно привязан!\n\n` +
          `Discord: ${discordUser.username}#${discordUser.discriminator}\n\n` +
          `Теперь ваш доступ к Discord серверу Montana будет синхронизироваться с вашим членством в основной группе Telegram.`
        );
      } catch (error) {
        log.error('Failed to send confirmation message', { telegramId: stateData.telegramId, error });
      }

      res.send(`
        <html>
          <head>
            <title>Discord аккаунт привязан</title>
            <style>
              body {
                font-family: Arial, sans-serif;
                display: flex;
                justify-content: center;
                align-items: center;
                height: 100vh;
                margin: 0;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              }
              .container {
                text-align: center;
                background: white;
                padding: 40px;
                border-radius: 10px;
                box-shadow: 0 10px 30px rgba(0,0,0,0.2);
              }
              h1 { color: #667eea; }
              p { color: #666; }
              .success { color: #28a745; font-size: 48px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="success">✅</div>
              <h1>Успешно!</h1>
              <p>Ваш Discord аккаунт <strong>${discordUser.username}#${discordUser.discriminator}</strong> привязан.</p>
              <p>Вы можете закрыть это окно.</p>
            </div>
          </body>
        </html>
      `);

      log.info('Discord account linked successfully', {
        telegramId: stateData.telegramId,
        discordId: discordUser.id,
        discordUsername: `${discordUser.username}#${discordUser.discriminator}`,
      });
    } catch (error) {
      log.error('Failed to handle OAuth callback', error);
      res.status(500).send(`
        <html>
          <head>
            <title>Ошибка</title>
            <style>
              body {
                font-family: Arial, sans-serif;
                display: flex;
                justify-content: center;
                align-items: center;
                height: 100vh;
                margin: 0;
                background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
              }
              .container {
                text-align: center;
                background: white;
                padding: 40px;
                border-radius: 10px;
                box-shadow: 0 10px 30px rgba(0,0,0,0.2);
              }
              h1 { color: #f5576c; }
              p { color: #666; }
              .error { color: #dc3545; font-size: 48px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="error">❌</div>
              <h1>Ошибка</h1>
              <p>Не удалось привязать Discord аккаунт.</p>
              <p>Попробуйте снова или обратитесь к администратору.</p>
            </div>
          </body>
        </html>
      `);
    }
  }

  /**
   * Generate auth URL for a Telegram user
   */
  generateAuthUrl(telegramId: number): string {
    const baseUrl = config.discord.redirectUri.replace('/auth/discord/callback', '');
    return `${baseUrl}/auth/discord?telegram_id=${telegramId}`;
  }

  /**
   * Start the OAuth server
   */
  start(): void {
    const port = config.oauth.port;
    this.app.listen(port, () => {
      log.info(`Discord OAuth server started on port ${port}`);
    });
  }
}
