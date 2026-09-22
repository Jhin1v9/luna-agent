import type { KimiLiveAdapter } from '@luna/agent';

/**
 * Canal admin → live brain (P3, ADR-035). Classifica a mensagem de um admin
 * autorizado: PERGUNTA → o FAST responde com dados (fluxo existente do chat
 * admin); ORDEM → o KimiCliAdapter executa com ferramentas nativas e responde
 * com EVIDÊNCIA. Ordens DESTRUTIVAS/irreversíveis exigem confirmação inline
 * quando ADMIN_CONFIRM_DESTRUCTIVE=true (decisão de arquitetura, ADR-035).
 *
 * O classificador é determinístico (regex) de propósito: testável, rápido e
 * sem custo de LLM. Falso-positivo de ORDEM → o CLI apenas responde (custa
 * segundos); falso-negativo → vira pergunta e o admin reformula — falha
 * segura nos dois sentidos.
 */

export type AdminMessageKind = 'question' | 'order';

export interface AdminClassification {
  kind: AdminMessageKind;
  destructive: boolean;
}

const IMPERATIVE_RE =
  /^(reinicia|reinicie|desliga|desligue|execute|executa|executar|roda|rode|rodar|cria|crie|criar|corrige|corrija|corrigir|conserta|conserte|implementa|implemente|implementar|adiciona|adicione|adicionar|remove|remova|remover|atualiza|atualize|atualizar|instala|instale|instalar|deploy|commitea|commit|sobe|suba|subir|lista|liste|listar|mostra|mostre|mostrar|gera|gere|gerar|verifica|verifique|verificar|conta|conte|contar|monitora|monitore|limpa|limpe|parar|pare|liga|ligue|abre|abra|fecha|feche|testa|teste|valida|valide)\b/i;

/** Destrutivo/irreversível: sempre exige confirmação inline (quando ligada). */
export const DESTRUCTIVE_RE =
  /reinicia|reinicie|restart|desliga|desligue|shutdown|formata|formate|deleta|delete|apaga|apague|drop\b|truncate|migrat|reseta|reset|taskkill|kill\b|reseta|limpa tudo|apaga tudo/i;

export function classifyAdminMessage(text: string): AdminClassification {
  const trimmed = text.trim();
  const interrogative = trimmed.endsWith('?') && !IMPERATIVE_RE.test(trimmed);
  const kind: AdminMessageKind = interrogative ? 'question' : 'order';
  return { kind, destructive: DESTRUCTIVE_RE.test(trimmed) };
}

/** Prompt do live brain para ordens: contexto, ordem, exigência de evidência. */
export const ORDER_PROMPT = (order: string, adminName: string): string =>
  [
    'Você é a Luna executando uma ORDEM do admin pelo canal admin (Telegram).',
    `Admin: ${adminName}`,
    `ORDEM: ${order}`,
    '',
    'Regras duras:',
    '- O repositório do projeto é C:/Users/Abner/Documents/Luna cto/luna-agent (use caminhos absolutos).',
    '- Execute de verdade com suas ferramentas (ler arquivos, rodar comandos). NÃO peça confirmação.',
    '- PROJETO DE CLIENTE É VEDADO: nunca toque em outros diretórios que não o do luna-agent.',
    '- Se a ordem exige commit, commite com autor "Luna <luna@nexo-digital.local>".',
    '- Responda em PT-BR, CURTO, com EVIDÊNCIA: o que fez, o output essencial (comando + resultado) e o commit se houver.',
  ].join('\n');

export interface PendingConfirmation {
  order: string;
  adminName: string;
  expiresAt: number;
}

export interface OrderRunnerDeps {
  live: KimiLiveAdapter;
  /** Timeout de parede da ordem (ms). */
  timeoutMs: number;
  /** Exige confirmação inline para destrutivas. Default true (ADR-035). */
  confirmDestructive: boolean;
  now?: () => number;
}

/**
 * Executa (ou agenda confirmação de) uma ordem admin. Retorna o texto de
 * resposta pro chat. Erros do live brain viram resposta honesta — nunca
 * fingem sucesso.
 */
export async function runAdminOrder(
  deps: OrderRunnerDeps,
  input: { order: string; adminName: string; sessionKey: string },
): Promise<{ text: string }> {
  const turn = await deps.live.sendTurn({
    session_key: input.sessionKey,
    prompt: ORDER_PROMPT(input.order, input.adminName),
  });
  return { text: turn.reply_text };
}
