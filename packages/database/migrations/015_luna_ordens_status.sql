-- 015 — 014 já aplicada: o claim da varredura usa 'processing' como status
-- transitório (pending → processing → done/error), igual à kimiwork_inbox.
COMMENT ON COLUMN luna_ordens.status IS 'pending | processing | done | error | ignored';
