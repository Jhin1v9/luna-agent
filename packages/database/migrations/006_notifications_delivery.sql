-- F2 — Notifications: dedupe por idempotency_key + delivered_at (§22).
-- 001-005 intactas (append-only).

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_idempotency
    ON notifications(idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_pending ON notifications(status, created_at)
    WHERE status IN ('pending', 'sent');
