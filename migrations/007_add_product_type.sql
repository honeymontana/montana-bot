-- Migration: Add product type classification
-- Description: Разделяет подписки на канал и другие товары

-- Добавить колонку product_type
ALTER TABLE subscription_events
ADD COLUMN IF NOT EXISTS product_type VARCHAR(50) DEFAULT 'channel';

-- Добавить колонку product_name
ALTER TABLE subscription_events
ADD COLUMN IF NOT EXISTS product_name VARCHAR(255) DEFAULT 'Montana.dll';

-- Обновить существующие записи
-- Тарифы €1, €3, €4, €5, €9 - это канал Montana.dll
UPDATE subscription_events
SET product_type = 'channel',
    product_name = 'Montana.dll'
WHERE amount IN (1.00, 3.00, 4.00, 5.00, 9.00);

-- Остальные тарифы - это товары
UPDATE subscription_events
SET product_type = 'product',
    product_name = 'Другие товары'
WHERE amount NOT IN (1.00, 3.00, 4.00, 5.00, 9.00);

-- Добавить индексы
CREATE INDEX IF NOT EXISTS idx_subscription_events_product_type ON subscription_events(product_type);
CREATE INDEX IF NOT EXISTS idx_subscription_events_product_name ON subscription_events(product_name);

-- Обновить таблицу user_subscription_stats
ALTER TABLE user_subscription_stats
ADD COLUMN IF NOT EXISTS product_type VARCHAR(50) DEFAULT 'channel';

ALTER TABLE user_subscription_stats
ADD COLUMN IF NOT EXISTS product_name VARCHAR(255) DEFAULT 'Montana.dll';

-- Обновить существующие записи в user_subscription_stats
UPDATE user_subscription_stats
SET product_type = 'channel',
    product_name = 'Montana.dll'
WHERE amount IN (1.00, 3.00, 4.00, 5.00, 9.00);

UPDATE user_subscription_stats
SET product_type = 'product',
    product_name = 'Другие товары'
WHERE amount NOT IN (1.00, 3.00, 4.00, 5.00, 9.00);

-- Обновить функцию trigger для автоматического определения product_type
CREATE OR REPLACE FUNCTION update_user_subscription_stats()
RETURNS TRIGGER AS $$
BEGIN
    -- Определяем product_type и product_name для нового события
    IF NEW.amount IN (1.00, 3.00, 4.00, 5.00, 9.00) THEN
        NEW.product_type = 'channel';
        NEW.product_name = 'Montana.dll';
    ELSE
        NEW.product_type = 'product';
        NEW.product_name = 'Другие товары';
    END IF;

    INSERT INTO user_subscription_stats (
        user_id,
        username,
        telegram_user_id,
        amount,
        product_type,
        product_name,
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
        MAX(product_type) as product_type,
        MAX(product_name) as product_name,
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
        product_type = EXCLUDED.product_type,
        product_name = EXCLUDED.product_name,
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

-- Обновить представление для включения product_type
DROP VIEW IF EXISTS current_subscription_metrics;
CREATE OR REPLACE VIEW current_subscription_metrics AS
SELECT
    product_type,
    product_name,
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
GROUP BY product_type, product_name, amount
ORDER BY product_type, amount;

COMMENT ON COLUMN subscription_events.product_type IS 'Тип продукта: channel (канал Montana.dll) или product (другие товары)';
COMMENT ON COLUMN subscription_events.product_name IS 'Название продукта';
