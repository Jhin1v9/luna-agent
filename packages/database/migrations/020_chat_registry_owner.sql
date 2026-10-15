-- Owner é um contato autorizado com poder administrativo explícito.
ALTER TABLE chat_registry DROP CONSTRAINT IF EXISTS chat_registry_role_check;
ALTER TABLE chat_registry ADD CONSTRAINT chat_registry_role_check
  CHECK (role IN ('owner', 'allowed', 'blocked'));
