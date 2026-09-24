-- 012_chat_registry.sql — Chat Registry (fix definitivo P0 pós-incidente 2026-09-23)
-- Cada chat que a Luna pode tocar tem IDENTIDADE PRÓPRIA: o número de telefone
-- (lido do painel de contato, NUNCA do nome da lista) ou o jid do grupo.
-- Nome de exibição do WA é dica, nunca identidade. Blocklist deny-first:
-- papel 'blocked' vence tudo; fora do registry = fail-closed (recusa + pede
-- registro ao owner). notify_channel viabiliza notificações por pessoa
-- (ex.: pedido do HDM → msg direta no canal dele).

CREATE TABLE IF NOT EXISTS chat_registry (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chat_key        text NOT NULL,              -- dígitos E.164 p/ individual (sem '+'), jid p/ grupo
  kind            text NOT NULL DEFAULT 'individual'
                  CHECK (kind IN ('individual', 'group')),
  canonical_name  text NOT NULL,              -- como o owner se refere: 'Pai', 'Produção 2026'
  display_hint    text,                       -- nome exibido no WA (emoji etc.) — só dica
  role            text NOT NULL DEFAULT 'allowed'
                  CHECK (role IN ('allowed', 'blocked')),
  notify_channel  text,                       -- ex.: 'whatsapp:+34672...' | 'telegram:<chat_id>' | NULL
  phone_e164      text,                       -- individual: número completo c/ '+' (para exibir/confirmar)
  resolved_at     timestamptz NOT NULL DEFAULT now(),
  resolved_by     text NOT NULL DEFAULT 'agent',
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_registry_key_kind_unique UNIQUE (chat_key, kind)
);

CREATE INDEX IF NOT EXISTS idx_registry_canonical ON chat_registry (lower(canonical_name));
CREATE INDEX IF NOT EXISTS idx_registry_role ON chat_registry (role);

-- updated_at automático
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_registry_touch ON chat_registry;
CREATE TRIGGER trg_registry_touch BEFORE UPDATE ON chat_registry
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
