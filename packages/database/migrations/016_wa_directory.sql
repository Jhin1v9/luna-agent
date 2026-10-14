-- 016_wa_directory.sql — Diretório WhatsApp da Luna (2026-10-14)
-- chat_registry (012) guarda chat_key (jid) → nome. Esta tabela detalha os
-- PARTICIPANTES de cada grupo, colhidos do model-storage (IndexedDB) da
-- sessão WA Web pelo scripts/harvest-wa-directory.mjs. Fonte da verdade para:
--   - resolver JID de grupo → nome (outbound/sweep)
--   - a Luna navegar "quem está em qual grupo" via brain/SQL
CREATE TABLE IF NOT EXISTS wa_group_members (
  group_jid     text        NOT NULL,
  member_jid    text        NOT NULL,
  member_name   text,
  is_admin      boolean     NOT NULL DEFAULT false,
  is_superadmin boolean     NOT NULL DEFAULT false,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_jid, member_jid)
);
CREATE INDEX IF NOT EXISTS idx_wa_group_members_name ON wa_group_members (lower(member_name));
CREATE INDEX IF NOT EXISTS idx_wa_group_members_member ON wa_group_members (member_jid);
