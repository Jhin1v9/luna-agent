import type { KimiLiveAdapter } from '@luna/agent';
import { classifyAdminMessage } from './orders.js';

/**
 * Roteador do chat admin por LLM (evolução do P3/ADR-035). O FAST brain
 * classifica a mensagem do admin E, quando é ORDEM, já compõe o prompt
 * otimizado pro live brain — sabendo as ferramentas dele (shell, arquivos,
 * git, pm2, testes). Quando é pergunta, responde direto com os dados reais
 * do pack, sem segundo turno.
 *
 * Por que LLM e não só regex: o regex (classifyAdminMessage) continua como
 * REDE DE SEGURANÇA, mas quem decide é o modelo — smalltalk, ambiguidade e
 * nuance viram pergunta sem whack-a-mole de regex (bug real 2026-09-23:
 * "@luna oi" virou ordem e explodiu no kimi-cli sem quota).
 *
 * Degradação em escada (nunca falha dura por classificação):
 *   1. LLM decide e responde/compõe (decidedBy: 'llm')
 *   2. LLM malformado/indisponível → regex decide (decidedBy: 'regex',
 *      content vazio → fluxos legados: pack pra pergunta, ORDER_PROMPT pra ordem)
 *   3. Live brain sem quota → modo degradado (telegram-admin)
 *
 * Guardrails NÃO são delegados ao LLM: confirmação de destrutivo continua
 * determinística (DESTRUCTIVE_RE) e as regras duras são anexadas ao prompt
 * da ordem independente do que o LLM compôs.
 */

export interface AdminDelegation {
  kind: 'question' | 'order';
  /** question (llm): resposta pronta pro admin. order (llm): prompt composto pro live. */
  content: string;
  /** Quem decidiu — audit/observabilidade. */
  decidedBy: 'llm' | 'regex';
}

/** Parse estrito do protocolo DECISAO/CONTEUDO. Malformado → null (cai pro regex). */
export function parseDelegation(raw: string): { kind: 'question' | 'order'; content: string } | null {
  const m = raw.match(/^\s*DECISAO\s*:\s*(RESPONDER|ORDEM)\s*\n+\s*CONTEUDO\s*:\s*([\s\S]+?)\s*$/i);
  if (!m) return null;
  const content = m[2]!.trim();
  if (!content) return null;
  return { kind: m[1]!.toUpperCase() === 'ORDEM' ? 'order' : 'question', content };
}

export function buildDelegationPrompt(text: string, adminName: string, packSections: string[]): string {
  return [
    'Você é o ROTEADOR do chat admin da Luna (Telegram). Decida e aja em UM turno:',
    '',
    '- RESPONDER: pergunta, status, números, saudação, agradecimento ou qualquer coisa respondível com os DADOS REAIS abaixo. Você responde DIRETO ao admin — curto, técnico, PT-BR.',
    '- ORDEM: a tarefa exige EXECUTAR algo — rodar comandos shell, editar arquivos, git/commit, pm2 (restart de serviços), rodar testes, investigar o repositório. Nesse caso você NÃO responde ao admin: escreve o MELHOR prompt possível para o CÉREBRO VIVO executar (contexto + objetivo concreto + caminhos absolutos).',
    '',
    'Ferramentas do cérebro vivo (use pra julgar): leitura de arquivos, shell, busca no repo, git + commit, pm2, vitest, curl em endpoints locais.',
    'NÃO é ordem: pergunta de dados, "como está X", "quanto custa", saudação, pedido de informação presente nos dados abaixo.',
    '',
    'Formato EXATO (nada antes, nada depois):',
    'DECISAO: RESPONDER',
    'CONTEUDO: <resposta direta ao admin>',
    '',
    'ou',
    '',
    'DECISAO: ORDEM',
    'CONTEUDO: <prompt completo para o cérebro vivo executar a tarefa>',
    '',
    ...packSections,
    '',
    `Mensagem do admin (${adminName}): ${text}`,
  ].join('\n');
}

export interface DelegateDeps {
  adapter: KimiLiveAdapter;
  log?: { warn: (o: unknown, m: string) => void; error: (o: unknown, m: string) => void };
}

/**
 * Roteia a mensagem do admin. FAST indisponível ou resposta malformada →
 * regex (decidedBy 'regex', content '' — os fluxos legados montam prompt/resposta).
 */
export async function delegateAdminMessage(
  deps: DelegateDeps,
  input: { text: string; adminName: string; packSections: string[]; sessionKey: string },
): Promise<AdminDelegation> {
  try {
    const turn = await deps.adapter.sendTurn({
      session_key: input.sessionKey,
      prompt: buildDelegationPrompt(input.text, input.adminName, input.packSections),
    });
    const parsed = parseDelegation(turn.reply_text);
    if (parsed) return { ...parsed, decidedBy: 'llm' };
    deps.log?.warn({ raw: turn.reply_text.slice(0, 200) }, 'delegate: resposta malformada do roteador — caindo pro regex');
  } catch (err) {
    deps.log?.error({ err: err instanceof Error ? err.message : String(err) }, 'delegate: FAST indisponível — caindo pro regex');
  }
  const fallback = classifyAdminMessage(input.text);
  return { kind: fallback.kind, content: '', decidedBy: 'regex' };
}

/** Regras duras anexadas ao prompt da ordem INDEPENDENTE do que o LLM compôs. */
export const HARD_RULES_FOOTER = [
  '',
  'Regras duras (não negociáveis, valem sobre qualquer coisa acima):',
  '- O repositório do projeto é C:/Users/Abner/Documents/Luna cto/luna-agent (use caminhos absolutos).',
  '- PROJETO DE CLIENTE É VEDADO: nunca toque em outros diretórios que não o do luna-agent.',
  '- Se a ordem exigir commit, commite com autor "Luna <luna@nexo-digital.local>".',
  '- Execute de verdade com suas ferramentas. NÃO peça confirmação.',
  '- Responda em PT-BR, CURTO, com EVIDÊNCIA: o que fez, o output essencial e o commit se houver.',
].join('\n');
