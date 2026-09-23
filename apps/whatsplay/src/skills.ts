import type {
  ChatSearchResult,
  ConversationMessage,
  TransportStatus,
  UnreadMessage,
  WhatsAppTransport,
} from './transport.js';
import { extractMention } from './rules.js';

/**
 * SKILL LAYER (PLANO-SKILLS.md, docs/) — camada de ação da Luna.
 *
 * Decreto do owner (2026-09-23): o cérebro NUNCA raciocina sobre a UI do
 * WhatsApp Web. Ele chama skills nomeadas com dados mapeados. Skill é o
 * contrato; o motor (Kimi Work na ponte, Pi, kimi-cli) é troca-peça.
 *
 * Cada skill aqui é uma primitiva documentada no catálogo
 * (docs/PLANO-SKILLS.md §2) e testada (skills.test.ts). As skills compostas
 * (mention.respond) orquestram primitivas do transport — a UI continua
 * escondida no transport, como sempre (§13).
 */

/** Referência de contato resolvida pelo ContactMap (fase 2 do plano). */
export interface ContactRef {
  /** Nome exibido no WhatsApp. */
  name: string;
  /** Número/jid mapeado — quando existe, a busca é determinística. */
  phone?: string | null;
}

export interface SkillsDeps {
  transport: WhatsAppTransport;
  /** ContactMap: resolve nome → número/chat. Ausente = fallback por nome. */
  resolveContact?: (name: string) => Promise<ContactRef | null>;
  log?: { info: (o: unknown, m: string) => void; warn: (o: unknown, m: string) => void };
}

export interface MentionRespondInput {
  /** Chat onde a menção aconteceu (nome ou jid mapeado). */
  conversation: string;
  /** Texto da resposta da Luna. */
  text: string;
  /** Texto da mensagem mencionada — a lupa confirma que ela existe (audit). */
  mentionQuery?: string;
  /** Autor da menção (só pra log/audit). */
  author?: string | null;
}

export interface WhatsAppSkills {
  // ── Núcleo de conversa ──────────────────────────────────────────────
  /** session.status — estado da sessão WA. */
  'session.status'(): Promise<TransportStatus>;
  /** chat.unread — chats com não-lidas. */
  'chat.unread'(): Promise<UnreadMessage[]>;
  /** chat.open — abre chat por nome/número (resolve ContactMap antes). */
  'chat.open'(target: string): Promise<string>;
  /** chat.read — histórico recente. */
  'chat.read'(target: string, limit?: number): Promise<ConversationMessage[]>;
  /** chat.send — envia texto com confirmação real de entrega. */
  'chat.send'(target: string, text: string): Promise<string>;
  /** chat.search (LUPA) — busca texto dentro do chat; não envia nada. */
  'chat.search'(target: string, query: string): Promise<ChatSearchResult>;

  // ── RESPONDER MENÇÕES (skill-âncora) ────────────────────────────────
  /** mention.detect — '@luna' na mensagem? */
  'mention.detect'(text: string): boolean;
  /** mention.respond — responde a menção no chat certo, com contexto citado.
   *  v1: envia no chat citando o autor/query. v2 (futuro): citação visual
   *  via hover → "Responder" quando a UI for mapeada no selector memory. */
  'mention.respond'(input: MentionRespondInput): Promise<{ externalId: string; mentionFound: boolean | null }>;

  // ── Contatos (mapeamento 1x) ────────────────────────────────────────
  /** contact.find — resolve nome → contato mapeado (ContactMap). */
  'contact.find'(name: string): Promise<ContactRef | null>;
}

export function createWhatsAppSkills(deps: SkillsDeps): WhatsAppSkills {
  const { transport, resolveContact } = deps;

  /** Resolve o alvo pelo ContactMap quando possível — busca por número
   *  mapeada é determinística; sem mapeamento, cai no nome (comportamento
   *  atual). */
  async function resolveTarget(target: string): Promise<string> {
    if (!resolveContact) return target;
    const ref = await resolveContact(target).catch(() => null);
    if (ref?.phone) {
      deps.log?.info({ name: target, phone: ref.phone }, 'skill: alvo resolvido pelo ContactMap');
      return ref.phone;
    }
    if (ref && !ref.phone) {
      deps.log?.warn({ name: target }, 'skill: contato mapeado SEM número — usando nome (busca por nome)');
    }
    return target;
  }

  return {
    'session.status': () => transport.getStatus(),
    'chat.unread': () => transport.getUnread(),

    'chat.open': async (target) => {
      const resolved = await resolveTarget(target);
      // sendMessage com texto vazio não existe; a abertura em si é validada
      // por quem chama via chat.read/chat.send. Aqui devolvemos o alvo
      // resolvido (o transport abre o chat em cada operação com PanelGuard).
      return resolved;
    },

    'chat.read': async (target, limit) => transport.readConversation(await resolveTarget(target), limit),

    'chat.send': async (target, text) => transport.sendMessage(await resolveTarget(target), text),

    'chat.search': async (target, query) => {
      if (!transport.searchInChat) {
        throw new Error('skill chat.search: transport não implementa searchInChat (lupa)');
      }
      return transport.searchInChat(await resolveTarget(target), query);
    },

    'mention.detect': (text) => extractMention(text),

    'mention.respond': async (input) => {
      const target = await resolveTarget(input.conversation);
      // v2 (PLANO-SKILLS): com query da mensagem mencionada e transport com
      // citação, responde ELA com citação visual — o owner quer saber a qual
      // msg a resposta se refere. Falha da citação NÃO degrada pra envio
      // comum (órfã) — explode explícito pra retry com evidência.
      if (input.mentionQuery && input.mentionQuery.trim() && deps.transport.replyToMessage) {
        const texto = input.author ? `${input.author}, ${input.text}` : input.text;
        const externalId = await deps.transport.replyToMessage(target, input.mentionQuery.trim(), texto);
        deps.log?.info(
          { author: input.author ?? null, target },
          'mention.respond: resposta enviada COM CITAÇÃO da mensagem mencionada',
        );
        return { externalId, mentionFound: true };
      }
      // v1 (sem query ou sem transport de citação): lupa confirma que a
      // mensagem existe (audit) e envia comum citando o autor no texto.
      let mentionFound: boolean | null = null;
      if (input.mentionQuery && transport.searchInChat) {
        try {
          const r = await transport.searchInChat(target, input.mentionQuery.slice(0, 60));
          mentionFound = r.found;
          deps.log?.info(
            { author: input.author ?? null, found: r.found, results: r.resultCount },
            'mention.respond: lupa verificou a mensagem mencionada',
          );
        } catch (err) {
          deps.log?.warn({ err: String(err).slice(0, 200) }, 'mention.respond: lupa falhou — respondendo sem verificação');
        }
      }
      const texto = input.author ? `${input.author}, ${input.text}` : input.text;
      const externalId = await transport.sendMessage(target, texto);
      return { externalId, mentionFound };
    },

    'contact.find': async (name) => {
      if (!resolveContact) return null;
      return resolveContact(name).catch(() => null);
    },
  };
}
