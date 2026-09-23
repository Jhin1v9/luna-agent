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

/**
 * Smalltalk/cumprimento — NUNCA é ordem. Sem isso, "oi" caía no caminho do
 * live brain (evidência 2026-09-23: "@luna oi" classificado como ORDEM com
 * o kimi-cli sem quota = falha dura numa saudação). Saudação é pergunta —
 * o FAST (com fallback Gemini) responde de graça.
 *
 * Casamento INTEIRO (anchored ^$) de propósito: "olá, reinicia o worker" NÃO
 * casa aqui — cai no veredito default 'order' pelo imperativo. \b não serve:
 * quebra com acento final ("olá" — 'á' não é \w em JS sem /u).
 */
const SMALLTALK_RE =
  /^(o[ií]+|ol[aá]+|hey+|eai|e a[ií]+|opa|bom dia|boa tarde|boa noite|tudo bem|tudo bom|como vai|como está|como esta|valeu|vlw|obrigad[oa]+|brigad[oa]+|thanks?|ok|okay|blz|beleza|perfeito|show|legal)[\s!.,;)]*$/i;

/** Destrutivo/irreversível: sempre exige confirmação inline (quando ligada). */
export const DESTRUCTIVE_RE =
  /reinicia|reinicie|restart|desliga|desligue|shutdown|formata|formate|deleta|delete|apaga|apague|drop\b|truncate|migrat|reseta|reset|taskkill|kill\b|reseta|limpa tudo|apaga tudo/i;

export function classifyAdminMessage(text: string): AdminClassification {
  const trimmed = text.trim();
  const imperative = IMPERATIVE_RE.test(trimmed);
  const interrogative = trimmed.endsWith('?') && !imperative;
  // Smalltalk manda no veredito: cumprimento/saudação é pergunta mesmo sem
  // '?'. EXCEÇÃO: verbo imperativo na msg = ordem (ex.: "olá, reinicia o worker").
  const kind: AdminMessageKind =
    !imperative && (interrogative || SMALLTALK_RE.test(trimmed)) ? 'question' : 'order';
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
  /** Prompt já composto pelo roteador LLM (P4) — regras duras já anexadas. */
  composedPrompt?: string;
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
    prompt: deps.composedPrompt ?? ORDER_PROMPT(input.order, input.adminName),
  });
  return { text: turn.reply_text };
}
