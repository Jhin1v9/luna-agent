-- F1.4 — Rastreamento de envio de mensagens (003; 001 e 002 intactas, append-only).
-- messages outbound agora têm fila de entrega consumida pelo WhatsPlay:
--   queued → sent | failed, com sent_at. Índice parcial para a fila ficar barata.

ALTER TABLE messages ADD COLUMN IF NOT EXISTS send_state TEXT;   -- queued | sent | failed | simulated (NULL = inbound)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_messages_outbound_queue
    ON messages(send_state) WHERE send_state = 'queued';
