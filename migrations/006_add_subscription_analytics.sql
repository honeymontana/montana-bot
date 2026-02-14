-- Migration: Add subscription analytics tables
-- Description: Добавляет таблицы для хранения истории подписок и метрик CHURN

-- Таблица для хранения всех событий подписок
CREATE TABLE IF NOT EXISTS subscription_events (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    username VARCHAR(255),
    telegram_user_id BIGINT,
    amount DECIMAL(10, 2) NOT NULL,
    event_type VARCHAR(50) NOT NULL, -- subscription.created, subscription.renewed, subscription.cancelled
    event_date TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, amount, event_type, event_date)
);

-- Индексы для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_subscription_events_user_id ON subscription_events(user_id);
CREATE INDEX IF NOT EXISTS idx_subscription_events_event_type ON subscription_events(event_type);
CREATE INDEX IF NOT EXISTS idx_subscription_events_event_date ON subscription_events(event_date);
CREATE INDEX IF NOT EXISTS idx_subscription_events_amount ON subscription_events(amount);

-- Таблица для хранения метрик CHURN по датам и суммам
CREATE TABLE IF NOT EXISTS churn_metrics (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    total_users INTEGER DEFAULT 0,
    active_users INTEGER DEFAULT 0,
    churned_users INTEGER DEFAULT 0,
    churn_rate DECIMAL(5, 2) DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(date, amount)
);

CREATE INDEX IF NOT EXISTS idx_churn_metrics_date ON churn_metrics(date);
CREATE INDEX IF NOT EXISTS idx_churn_metrics_amount ON churn_metrics(amount);

-- Таблица для агрегированной статистики по пользователям
CREATE TABLE IF NOT EXISTS user_subscription_stats (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    username VARCHAR(255),
    telegram_user_id BIGINT,
    amount DECIMAL(10, 2) NOT NULL,
    total_subscriptions INTEGER DEFAULT 0,
    total_renewals INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    first_subscription_date TIMESTAMP,
    last_activity_date TIMESTAMP,
    cancelled_at TIMESTAMP,
    lifetime_value DECIMAL(10, 2) DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, amount)
);

CREATE INDEX IF NOT EXISTS idx_user_stats_user_id ON user_subscription_stats(user_id);
CREATE INDEX IF NOT EXISTS idx_user_stats_is_active ON user_subscription_stats(is_active);
CREATE INDEX IF NOT EXISTS idx_user_stats_amount ON user_subscription_stats(amount);

-- Функция для автоматического обновления user_subscription_stats
CREATE OR REPLACE FUNCTION update_user_subscription_stats()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO user_subscription_stats (
        user_id,
        username,
        telegram_user_id,
        amount,
        total_subscriptions,
        total_renewals,
        is_active,
        first_subscription_date,
        last_activity_date,
        cancelled_at,
        lifetime_value
    )
    SELECT
        user_id,
        MAX(username) as username,
        MAX(telegram_user_id) as telegram_user_id,
        amount,
        COUNT(*) FILTER (WHERE event_type = 'subscription.created') as total_subscriptions,
        COUNT(*) FILTER (WHERE event_type = 'subscription.renewed') as total_renewals,
        NOT EXISTS (
            SELECT 1 FROM subscription_events se2
            WHERE se2.user_id = NEW.user_id
              AND se2.amount = NEW.amount
              AND se2.event_type = 'subscription.cancelled'
        ) as is_active,
        MIN(event_date) FILTER (WHERE event_type = 'subscription.created') as first_subscription_date,
        MAX(event_date) as last_activity_date,
        MAX(event_date) FILTER (WHERE event_type = 'subscription.cancelled') as cancelled_at,
        (COUNT(*) FILTER (WHERE event_type IN ('subscription.created', 'subscription.renewed'))) * amount as lifetime_value
    FROM subscription_events
    WHERE user_id = NEW.user_id AND amount = NEW.amount
    GROUP BY user_id, amount
    ON CONFLICT (user_id, amount) DO UPDATE SET
        username = EXCLUDED.username,
        telegram_user_id = EXCLUDED.telegram_user_id,
        total_subscriptions = EXCLUDED.total_subscriptions,
        total_renewals = EXCLUDED.total_renewals,
        is_active = EXCLUDED.is_active,
        first_subscription_date = EXCLUDED.first_subscription_date,
        last_activity_date = EXCLUDED.last_activity_date,
        cancelled_at = EXCLUDED.cancelled_at,
        lifetime_value = EXCLUDED.lifetime_value,
        updated_at = CURRENT_TIMESTAMP;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Триггер для автоматического обновления статистики
DROP TRIGGER IF EXISTS trigger_update_user_stats ON subscription_events;
CREATE TRIGGER trigger_update_user_stats
    AFTER INSERT OR UPDATE ON subscription_events
    FOR EACH ROW
    EXECUTE FUNCTION update_user_subscription_stats();

-- Представление для быстрого получения текущих метрик
CREATE OR REPLACE VIEW current_subscription_metrics AS
SELECT
    amount,
    COUNT(DISTINCT user_id) as total_users,
    COUNT(DISTINCT user_id) FILTER (WHERE is_active = TRUE) as active_users,
    COUNT(DISTINCT user_id) FILTER (WHERE is_active = FALSE) as churned_users,
    CASE
        WHEN COUNT(DISTINCT user_id) > 0
        THEN (COUNT(DISTINCT user_id) FILTER (WHERE is_active = FALSE)::float / COUNT(DISTINCT user_id)) * 100
        ELSE 0
    END as churn_rate,
    AVG(total_renewals) as avg_renewals,
    SUM(lifetime_value) as total_revenue
FROM user_subscription_stats
GROUP BY amount
ORDER BY amount;

COMMENT ON TABLE subscription_events IS 'История всех событий подписок (создание, продление, отмена)';
COMMENT ON TABLE churn_metrics IS 'Метрики CHURN по датам и суммам подписок';
COMMENT ON TABLE user_subscription_stats IS 'Агрегированная статистика по каждому пользователю';
COMMENT ON VIEW current_subscription_metrics IS 'Текущие метрики подписок (CHURN, retention, revenue)';
