-- F1.4+ — Atribuição de autor (decreto do owner: "Luna tem que saber quem
-- está mandando mensagem"). 001-003 intactas (append-only).
-- author_name: quem falou (nome do membro no grupo / nome do contato no
-- privado / 'luna' nas respostas). NULL = autor desconhecido (fallback
-- explícito, registrado em logs/ADR).

ALTER TABLE messages ADD COLUMN IF NOT EXISTS author_name TEXT;
