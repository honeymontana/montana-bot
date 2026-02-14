/**
 * Сервис для работы с Tribute API и обработки webhook событий
 */

import { query as dbQuery } from '../database/connection';

// Wrapper для совместимости
const db = {
  query: dbQuery,
  end: async () => {}
};

export interface TributeSubscriptionEvent {
  type: 'subscription.created' | 'subscription.renewed' | 'subscription.cancelled';
  user_id: string;
  username?: string;
  amount: number;
  currency: string;
  channel_id: string;
  timestamp: Date;
}

export interface SubscriptionRecord {
  id?: number;
  user_id: string;
  username?: string;
  telegram_user_id?: number;
  amount: number;
  event_type: string;
  event_date: Date;
  created_at?: Date;
}

export interface ChurnMetric {
  date: Date;
  total_users: number;
  active_users: number;
  churned_users: number;
  churn_rate: number;
  amount?: number;
}

class TributeService {
  /**
   * Обработать webhook событие от Tribute
   */
  async handleWebhookEvent(event: TributeSubscriptionEvent): Promise<void> {
    console.log(`[Tribute] Получено событие: ${event.type} от ${event.username || event.user_id}`);

    await this.saveSubscriptionEvent(event);
    await this.updateMetrics();
  }

  /**
   * Сохранить событие подписки в БД
   */
  async saveSubscriptionEvent(event: TributeSubscriptionEvent): Promise<void> {
    const query = `
      INSERT INTO subscription_events (
        user_id,
        username,
        amount,
        event_type,
        event_date
      ) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT DO NOTHING
    `;

    await db.query(query, [
      event.user_id,
      event.username,
      event.amount,
      event.type,
      event.timestamp
    ]);

    console.log(`[Tribute] Событие сохранено в БД`);
  }

  /**
   * Импортировать исторические данные из JSON экспорта
   */
  async importFromTelegramExport(filePath: string): Promise<void> {
    console.log(`[Tribute] Импорт данных из ${filePath}...`);

    const fs = require('fs');
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const messages = data.messages || [];

    let imported = 0;

    for (const message of messages) {
      const text = this.extractText(message);
      const userId = this.extractUserId(message);
      const amount = this.extractAmount(message);
      const date = message.date;

      if (!userId || !amount) continue;

      let eventType = '';
      if (text.includes('оформил подписку')) {
        eventType = 'subscription.created';
      } else if (text.includes('продлил подписку')) {
        eventType = 'subscription.renewed';
      } else if (text.includes('отменил')) {
        eventType = 'subscription.cancelled';
      } else {
        continue;
      }

      try {
        await this.saveSubscriptionEvent({
          type: eventType as any,
          user_id: userId,
          amount,
          currency: 'EUR',
          channel_id: 'montana',
          timestamp: new Date(date)
        });
        imported++;
      } catch (error) {
        // Игнорируем дубликаты
      }
    }

    console.log(`[Tribute] Импортировано ${imported} событий`);
    await this.updateMetrics();
  }

  /**
   * Получить статистику по всем подписчикам
   */
  async getSubscriberStats(): Promise<any[]> {
    const query = `
      SELECT
        user_id,
        username,
        amount,
        COUNT(CASE WHEN event_type = 'subscription.created' THEN 1 END) as subscriptions,
        COUNT(CASE WHEN event_type = 'subscription.renewed' THEN 1 END) as renewals,
        MAX(CASE WHEN event_type = 'subscription.cancelled' THEN event_date END) as cancelled_at,
        MIN(event_date) as first_subscription,
        MAX(event_date) as last_activity
      FROM subscription_events
      GROUP BY user_id, username, amount
      ORDER BY last_activity DESC
    `;

    const result = await db.query(query);
    return result.rows;
  }

  /**
   * Рассчитать CHURN по датам
   */
  async calculateChurnByDate(
    startDate: Date,
    endDate: Date,
    groupBy: 'day' | 'week' | 'month' = 'week'
  ): Promise<ChurnMetric[]> {
    const interval = groupBy === 'day' ? '1 day' : groupBy === 'week' ? '7 days' : '30 days';

    const query = `
      WITH date_series AS (
        SELECT generate_series(
          $1::date,
          $2::date,
          $3::interval
        ) AS period_date
      ),
      subscriptions_by_period AS (
        SELECT
          date_trunc($4, event_date) as period,
          amount,
          COUNT(DISTINCT user_id) FILTER (WHERE event_type = 'subscription.created') as new_users,
          COUNT(DISTINCT user_id) FILTER (WHERE event_type = 'subscription.cancelled') as churned_users
        FROM subscription_events
        WHERE event_date >= $1 AND event_date <= $2
        GROUP BY date_trunc($4, event_date), amount
      ),
      active_users_by_period AS (
        SELECT
          ds.period_date as period,
          se.amount,
          COUNT(DISTINCT se.user_id) as active_users
        FROM date_series ds
        CROSS JOIN (SELECT DISTINCT amount FROM subscription_events) amounts
        LEFT JOIN subscription_events se ON se.amount = amounts.amount
          AND se.event_date <= ds.period_date
          AND NOT EXISTS (
            SELECT 1 FROM subscription_events cancel
            WHERE cancel.user_id = se.user_id
              AND cancel.amount = se.amount
              AND cancel.event_type = 'subscription.cancelled'
              AND cancel.event_date <= ds.period_date
          )
        GROUP BY ds.period_date, se.amount
      )
      SELECT
        aup.period as date,
        aup.amount,
        COALESCE(sbp.new_users, 0) as new_users,
        aup.active_users,
        COALESCE(sbp.churned_users, 0) as churned_users,
        CASE
          WHEN aup.active_users > 0
          THEN (COALESCE(sbp.churned_users, 0)::float / aup.active_users) * 100
          ELSE 0
        END as churn_rate
      FROM active_users_by_period aup
      LEFT JOIN subscriptions_by_period sbp ON sbp.period = aup.period AND sbp.amount = aup.amount
      WHERE aup.active_users > 0
      ORDER BY aup.period DESC, aup.amount
    `;

    const result = await db.query(query, [startDate, endDate, interval, groupBy]);
    return result.rows;
  }

  /**
   * Обновить метрики в таблице churn_metrics
   */
  async updateMetrics(): Promise<void> {
    const today = new Date();
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(today.getDate() - 30);

    const metrics = await this.calculateChurnByDate(thirtyDaysAgo, today, 'day');

    for (const metric of metrics) {
      const query = `
        INSERT INTO churn_metrics (date, amount, total_users, active_users, churned_users, churn_rate)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (date, amount) DO UPDATE SET
          total_users = EXCLUDED.total_users,
          active_users = EXCLUDED.active_users,
          churned_users = EXCLUDED.churned_users,
          churn_rate = EXCLUDED.churn_rate,
          updated_at = NOW()
      `;

      await db.query(query, [
        metric.date,
        metric.amount,
        (metric as any).new_users + metric.active_users,
        metric.active_users,
        metric.churned_users,
        metric.churn_rate
      ]);
    }

    console.log(`[Tribute] Метрики обновлены для ${metrics.length} периодов`);
  }

  /**
   * Вспомогательные методы для парсинга
   */
  private extractText(message: any): string {
    const text = message.text;
    if (typeof text === 'string') return text;
    if (Array.isArray(text)) {
      return text.map(item =>
        typeof item === 'string' ? item : item.text || ''
      ).join('');
    }
    return '';
  }

  private extractUserId(message: any): string | null {
    const entities = message.text_entities || [];
    for (const entity of entities) {
      if (entity.type === 'mention') {
        return entity.text;
      } else if (entity.type === 'mention_name' && entity.user_id) {
        return `user_${entity.user_id}`;
      }
    }
    return null;
  }

  private extractAmount(message: any): number | null {
    const entities = message.text_entities || [];
    for (const entity of entities) {
      if (entity.type === 'bold' && entity.text?.startsWith('€')) {
        try {
          return parseFloat(entity.text.replace('€', '').replace(',', '.'));
        } catch {
          return null;
        }
      }
    }
    return null;
  }
}

export const tributeService = new TributeService();
