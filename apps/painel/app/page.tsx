"use client";

// ============================================================================
// PAINEL DA LUNA — v2 · painel de controle com navegação SPA
// Mesmos contratos de API de v1 (/api/modo, /api/validacao, /api/servicos,
// /api/inbox, /api/comando, /api/atividade, /api/chats, /api/mensagem,
// /api/venus, /api/venus-erros, /api/venus/tarefa, turnos e inbox actions).
// Backend: zero mudanças. Visual: menu lateral + páginas + animações.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Toaster, toast } from "sonner";
import {
  Moon, BrainCircuit, ShieldCheck, Send, Activity, Server, Inbox as InboxIcon,
  ArrowLeftRight, Sparkles, CheckCircle2, XCircle, RefreshCw, RotateCcw, ChevronDown,
  ArrowUpRight, Loader2, LayoutDashboard, MessageSquare, Terminal, Settings2,
} from "lucide-react";

type Modo = { KIMI_ADAPTER_MODE: string; LIVE_BRAIN_PROVIDER: string; VENUS_AUTONOMO: string };
type Check = { id: string; label: string; ok: boolean; detail: string };
type Chat = { chat_id: string; label: string; count: number; last_used: string };
type Msg = { id: string; conversation_id: string; chat_id: string; sender: string; body: string; send_state: string; created_at: string };
type CtxLine = { sender: string; direction: string; body: string; created_at: string };
type Servico = { service: string; pid: number; state: string; seconds_since: number; alive: boolean; status: string; next_beat_in_s: number; progress: number; interval_s: number };
type InboxEvent = { id: string; kind: string; payload: Record<string, any>; status: string; received_at: string; processed_at: string | null; processing_by: string | null; result: Record<string, any> | null };
type Turno = { id: string; session_key: string; prompt: string; status: string; response: string | null; answered_at: string | null; created_at: string };
type VenusInfo = { status: string; running: boolean; processed_by_venus: number; log: string[] };
type VenusErros = { incidencias: { id: string; kind: string; received_at: string; motivo: string | null; por: string | null }[]; log: string[] };
type Ordem = { id: string; ordem: string; contexto: string | null; status: string; result: string | null; created_at: string; executed_at: string | null };
type Comando = { perguntas: Turno[]; ordens: Ordem[] };

const ADAPTER_MODES = ['mock', 'kimi-web', 'kimi-api', 'kimi-cli', 'kimi-web-local', 'gemini', 'pi', 'kimiwork'];
const PROVIDERS = ['kimi', 'kimiwork'];
const MAX_CHARS = 900;

async function getJSON<T>(path: string): Promise<T> {
  const r = await fetch(path, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${path} -> HTTP ${r.status}`);
  return r.json();
}
async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data as any).error || `HTTP ${r.status}`);
  return data;
}

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `há ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `há ${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h}h`;
  return `há ${Math.floor(h / 24)}d`;
}
const clock = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

const pageAnim = { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] as const } };
const cardAnim = (i: number) => ({
  initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 },
  transition: { duration: 0.4, delay: i * 0.05, ease: [0.22, 1, 0.36, 1] as const },
});

function Card({ children, className = '', index }: { children: React.ReactNode; className?: string; index: number }) {
  return <motion.section {...cardAnim(index)} className={`card card-hover ${className}`}>{children}</motion.section>;
}
function Title({ icon: Icon, children, extra }: { icon: any; children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <h2 className="card-title">
      <Icon size={14} className="text-luna" />
      {children}
      {extra && <span className="ml-auto normal-case tracking-normal">{extra}</span>}
    </h2>
  );
}
function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-9 animate-pulse rounded-lg bg-line/40" style={{ animationDelay: `${i * 120}ms` }} />
      ))}
    </div>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-[13px] text-dim">{children}</div>;
}
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    queued: 'badge-info', sent: 'badge-ok', failed: 'badge-fail',
    pending: 'badge-info', processing: 'badge-luna', done: 'badge-ok',
    error: 'badge-fail', answered: 'badge-ok', ignored: 'badge-warn',
  };
  return <span className={`badge ${map[status] || 'badge'}`}>{status}</span>;
}
function SenderChip({ sender }: { sender: string }) {
  if (sender === 'luna') return <span className="badge badge-luna">Luna</span>;
  if (sender === 'agent:venus') return <span className="badge badge-info">agent:venus</span>;
  return <span className="badge">contact</span>;
}

// páginas do menu
const PAGES = [
  { id: 'geral', label: 'Visão Geral', icon: LayoutDashboard },
  { id: 'mensageiro', label: 'Mensageiro', icon: MessageSquare },
  { id: 'comando', label: 'Cadeia de Comando', icon: ArrowLeftRight },
  { id: 'inbox', label: 'Inbox', icon: InboxIcon },
  { id: 'venus', label: 'Vênus', icon: Sparkles },
  { id: 'servicos', label: 'Serviços', icon: Server },
  { id: 'config', label: 'Cérebro / Modo', icon: Settings2 },
] as const;
type PageId = (typeof PAGES)[number]['id'];

export default function Painel() {
  // ── dados ──
  const [modo, setModo] = useState<Modo | null>(null);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [atividade, setAtividade] = useState<Msg[]>([]);
  const [servicos, setServicos] = useState<Servico[] | null>(null);
  const [servicosAt, setServicosAt] = useState<number>(0);
  const [inbox, setInbox] = useState<InboxEvent[] | null>(null);
  const [comando, setComando] = useState<Comando | null>(null);
  const [venus, setVenus] = useState<VenusInfo | null>(null);
  const [venusErros, setVenusErros] = useState<VenusErros | null>(null);

  // ── UI ──
  const [page, setPage] = useState<PageId>('geral');
  const [inboxTab, setInboxTab] = useState<'pending' | 'processing' | 'done' | 'error'>('pending');
  const [perguntasTab, setPerguntasTab] = useState<'pending' | 'answered' | 'failed'>('pending');
  const [venusTab, setVenusTab] = useState<'log' | 'erros'>('log');
  const [chatSel, setChatSel] = useState('productions');
  const [chatManual, setChatManual] = useState('');
  const [sender, setSender] = useState<'luna' | 'agent:venus'>('luna');
  const [text, setText] = useState('');
  const [guardMsg, setGuardMsg] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [contexto, setContexto] = useState<CtxLine[] | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [ordem, setOrdem] = useState('');
  const [ordemCtx, setOrdemCtx] = useState('');
  const [ordering, setOrdering] = useState(false);
  const [draftAdapter, setDraftAdapter] = useState('kimi-api');
  const [draftProvider, setDraftProvider] = useState('kimi');
  const [draftVenus, setDraftVenus] = useState(true);
  const [applying, setApplying] = useState(false);
  const [invoking, setInvoking] = useState(false);
  const [tarefa, setTarefa] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshIn, setRefreshIn] = useState(10);
  const logRef = useRef<HTMLPreElement>(null);

  // ── loaders ──
  const loadModo = useCallback(async () => {
    const m = await getJSON<Modo>('/api/modo');
    setModo(m);
    setDraftAdapter(m.KIMI_ADAPTER_MODE);
    setDraftProvider(m.LIVE_BRAIN_PROVIDER);
    setDraftVenus(m.VENUS_AUTONOMO === 'true');
  }, []);
  const loadAuto = useCallback(async () => {
    const run = async <T,>(p: Promise<T>, set: (v: T) => void) => { try { set(await p); } catch { /* mantém estado */ } };
    run(getJSON<Check[]>('/api/validacao'), setChecks);
    run(getJSON<Servico[]>('/api/servicos').then((s) => { setServicosAt(Date.now()); return s; }), setServicos);
    run(getJSON<InboxEvent[]>('/api/inbox'), setInbox);
    run(getJSON<Comando>('/api/comando'), setComando);
    run(getJSON<VenusInfo>('/api/venus'), setVenus);
    run(getJSON<VenusErros>('/api/venus-erros'), setVenusErros);
  }, []);
  const loadAtividade = useCallback(async () => {
    try { setAtividade(await getJSON<Msg[]>('/api/atividade')); } catch { /* noop */ }
  }, []);

  useEffect(() => {
    loadModo().catch(() => toast.error('falha ao ler modo atual'));
    getJSON<Chat[]>('/api/chats').then((c) => { setChats(c); setChatSel(c[0]?.chat_id || 'productions'); }).catch(() => {});
    loadAtividade();
    loadAuto();
  }, [loadModo, loadAtividade, loadAuto]);

  // auto-refresh 10s com countdown visível + refresh ao voltar pra aba
  useEffect(() => {
    const t1 = setInterval(() => setRefreshIn((x) => (x <= 1 ? 10 : x - 1)), 1000);
    return () => clearInterval(t1);
  }, []);
  useEffect(() => {
    if (refreshIn !== 10 || !autoRefresh) return;
    loadAuto();
  }, [refreshIn, autoRefresh, loadAuto]);
  useEffect(() => {
    const onVis = () => { if (!document.hidden) { loadAuto(); loadAtividade(); } };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [loadAuto, loadAtividade]);

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [venus?.log]);

  // countdown derivado (estimativa rotulada)
  const tickDelta = servicosAt ? Math.floor((Date.now() - servicosAt) / 1000) : 0;
  const servicosLive = (servicos || []).map((s) => {
    const since = s.seconds_since + tickDelta;
    return { ...s, since, alive: since <= 90, remaining: Math.max(0, s.interval_s - since), progress: Math.min(1, since / s.interval_s) };
  });
  const allAlive = servicosLive.length > 0 && servicosLive.every((s) => s.alive);
  const aliveCount = servicosLive.filter((s) => s.alive).length;
  const pendingPerguntas = comando?.perguntas.filter((t) => t.status === 'pending').length ?? 0;
  const errorInbox = inbox?.filter((e) => e.status === 'error').length ?? 0;

  // ── ações ──
  async function aplicarModo() {
    setApplying(true);
    try {
      const changes: Array<[string, string]> = [];
      if (modo && draftAdapter !== modo.KIMI_ADAPTER_MODE) changes.push(['KIMI_ADAPTER_MODE', draftAdapter]);
      if (modo && draftProvider !== modo.LIVE_BRAIN_PROVIDER) changes.push(['LIVE_BRAIN_PROVIDER', draftProvider]);
      if (modo && String(draftVenus) !== modo.VENUS_AUTONOMO) changes.push(['VENUS_AUTONOMO', String(draftVenus)]);
      if (changes.length === 0) { toast.info('nenhuma alteração para aplicar'); return; }
      for (const [key, value] of changes) {
        const r = await postJSON<{ ok: boolean; error?: string }>('/api/modo', { key, value });
        if (!r.ok) { toast.error(`${key}: ${r.error}`); return; }
        toast.success(`${key} = ${value}`);
      }
      await loadModo();
    } finally { setApplying(false); }
  }

  const chatIdEfetivo = () => chatManual.trim() || chatSel;

  async function enviar() {
    if (!text.trim()) { toast.error('mensagem vazia'); return; }
    if (text.length > MAX_CHARS) { toast.error(`máximo ${MAX_CHARS} caracteres`); return; }
    setSending(true); setGuardMsg(null);
    try {
      const r = await postJSON<{ ok: boolean; id?: string; send_state?: string; error?: string }>('/api/mensagem', {
        chat_id: chatIdEfetivo(), body: text, sender,
      });
      toast.success(`mensagem enfileirada como ${sender}`, { description: `id ${r.id} · ${r.send_state}` });
      setText('');
      setTimeout(loadAtividade, 2600);
    } catch (e: any) {
      setGuardMsg(e.message);
      toast.error(e.message);
    } finally { setSending(false); }
  }

  async function toggleContexto(conversation_id: string) {
    if (expanded === conversation_id) { setExpanded(null); setContexto(null); return; }
    setExpanded(conversation_id); setContexto(null);
    try { setContexto(await getJSON<CtxLine[]>(`/api/conversas/${encodeURIComponent(conversation_id)}/contexto`)); }
    catch { toast.error('falha ao carregar contexto'); }
  }

  function responderNovamente(m: Msg) {
    setChatManual(m.chat_id);
    setSender(m.sender === 'agent:venus' ? 'agent:venus' : 'luna');
    setText(`[retomando ${m.chat_id}] `);
    setPage('mensageiro');
    toast.info('mensageiro carregado com o chat da conversa', { description: m.chat_id });
  }

  async function reprocessar(ev: InboxEvent) {
    if (!confirm(`Reprocessar ${ev.id}? O evento volta para pending.`)) return;
    try {
      await postJSON(`/api/inbox/${ev.id}/reprocessar`, {});
      toast.success(`${ev.id} voltou para pending`);
      loadAuto();
    } catch (e: any) { toast.error(e.message); }
  }

  async function escalar(ev: InboxEvent) {
    try {
      const r = await postJSON<{ turno_id: string }>(`/api/inbox/${ev.id}/escalar`, {});
      toast.success('escalado para a Luna', { description: `turno ${r.turno_id}` });
      loadAuto();
    } catch (e: any) { toast.error(e.message); }
  }

  async function responderTurno(t: Turno) {
    const resp = (answers[t.id] || '').trim();
    if (!resp) { toast.error('resposta vazia'); return; }
    try {
      await postJSON(`/api/turnos/${t.id}/responder`, { response: resp });
      toast.success(`turno ${t.id.slice(0, 8)} respondido`);
      setAnswers((a) => ({ ...a, [t.id]: '' }));
      loadAuto();
    } catch (e: any) { toast.error(e.message); }
  }

  async function enviarOrdem() {
    if (!ordem.trim()) { toast.error('ordem vazia'); return; }
    setOrdering(true);
    try {
      const r = await postJSON<{ id: string }>('/api/comando', { ordem, contexto: ordemCtx });
      toast.success('ORDEM registrada — o Vênus executa na próxima varredura', { description: `id ${r.id}` });
      setOrdem(''); setOrdemCtx('');
      loadAuto();
    } catch (e: any) { toast.error(e.message); }
    finally { setOrdering(false); }
  }

  async function invocarTarefa() {
    if (!tarefa.trim()) { toast.error('tarefa vazia'); return; }
    setInvoking(true);
    try {
      await postJSON('/api/venus/tarefa', { tarefa });
      toast.success('tarefa invocada');
      setTarefa('');
      setTimeout(loadAuto, 800);
    } catch (e: any) { toast.error(e.message); }
    finally { setInvoking(false); }
  }

  // ── render helpers ──
  const tabs = (tabsDef: { id: string; label: string; count?: number }[], active: string, set: (t: any) => void, color = 'text-info') => (
    <div className="relative mb-3 flex gap-1 border-b border-line/70">
      {tabsDef.map((t) => (
        <button key={t.id} onClick={() => set(t.id)}
          className={`relative px-3 py-1.5 text-[12px] transition-colors ${active === t.id ? color : 'text-dim hover:text-fg'}`}>
          {t.label}
          {t.count !== undefined && <span className="ml-1 text-[10px] opacity-70">{t.count}</span>}
          {active === t.id && <motion.span layoutId={`tab-${tabsDef.map((x) => x.id).join('-')}`} className="absolute inset-x-2 -bottom-px h-0.5 rounded bg-current" />}
        </button>
      ))}
    </div>
  );

  const renderAtividadeLista = (limite?: number) => {
    const list = limite ? atividade.slice(0, limite) : atividade;
    if (list.length === 0) return <Empty>Nenhuma mensagem de saída registrada.</Empty>;
    return (
      <ul className="space-y-2">
        {list.map((m) => (
          <li key={m.id} className="rounded-xl border border-line/70 bg-bg/50">
            <div className="flex flex-wrap items-center gap-2 px-3 py-2">
              <SenderChip sender={m.sender} />
              <span className="mono max-w-[220px] truncate text-dim">{m.chat_id}</span>
              <span className="ml-auto text-[11px] text-dim">{clock(m.created_at)} · {timeAgo(m.created_at)}</span>
              <StatusBadge status={m.send_state} />
              <button className="text-dim transition-transform hover:text-fg" onClick={() => toggleContexto(m.conversation_id)}>
                <motion.span animate={{ rotate: expanded === m.conversation_id ? 180 : 0 }} className="block"><ChevronDown size={14} /></motion.span>
              </button>
            </div>
            <div className="px-3 pb-2 text-[13px] leading-snug">{m.body}</div>
            <AnimatePresence>
              {expanded === m.conversation_id && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25 }} className="overflow-hidden">
                  <div className="mx-3 mb-2 space-y-1.5 rounded-lg border border-line/60 bg-bg/70 p-3">
                    {!contexto ? <Skeleton rows={2} /> : contexto.map((c, i) => (
                      <div key={i} className="flex gap-2 text-[12px]">
                        <span className={`w-20 shrink-0 truncate font-semibold ${c.direction === 'outbound' ? 'text-luna' : 'text-dim'}`}>{c.sender}</span>
                        <span className="text-dim">{c.body}</span>
                      </div>
                    ))}
                    <button className="btn btn-sm mt-1" onClick={() => responderNovamente(m)}>
                      <ArrowUpRight size={12} />Responder novamente
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </li>
        ))}
      </ul>
    );
  };

  const renderServicos = () => {
    if (!servicosLive.length) return <Skeleton rows={4} />;
    return (
      <div className="space-y-2">
        {servicosLive.map((s) => (
          <div key={s.service} className={`rounded-xl border px-3 py-2.5 transition-colors ${s.alive ? 'border-line/70 bg-bg/50' : 'border-fail/50 bg-fail/5'}`}>
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              <span className="font-medium">{s.service}</span>
              <span className="mono text-[11px] text-dim">pid {s.pid}</span>
              <span className="mono text-[11px] text-dim">{s.state}</span>
              <span className={`ml-auto badge ${s.alive ? 'badge-ok' : 'badge-fail'}`}>
                <span className={`size-1.5 rounded-full ${s.alive ? 'bg-ok' : 'bg-fail'}`} />
                {s.status}
              </span>
              <span className="text-[11px] text-dim">beat há {s.since}s</span>
            </div>
            <div className="mt-2 flex items-center gap-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line/50">
                <motion.div className={`h-full rounded-full ${s.alive ? 'bg-gradient-to-r from-info to-luna' : 'bg-fail'}`}
                  animate={{ width: `${s.progress * 100}%` }} transition={{ duration: 1, ease: 'linear' }} />
              </div>
              <span className="w-44 text-right text-[11px] text-dim">próx. beat ~{s.remaining}s <span className="opacity-60">(estimativa)</span></span>
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderChecks = () => {
    if (!checks) return <Skeleton rows={5} />;
    return (
      <ul className="divide-y divide-line/50">
        {checks.map((c) => (
          <motion.li key={c.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-start gap-2.5 py-2">
            {c.ok ? <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-ok" /> : <XCircle size={15} className="mt-0.5 shrink-0 text-fail" />}
            <div className="min-w-0">
              <div className="text-[13px] leading-tight">{c.label}</div>
              <div className="truncate text-[11px] text-dim">{c.detail}</div>
            </div>
          </motion.li>
        ))}
      </ul>
    );
  };

  // ── páginas ──
  const PageGeral = (
    <div key="geral" className="space-y-4" {...pageAnim}>
      {/* hero de status */}
      <motion.section {...cardAnim(0)} className={`card flex flex-wrap items-center gap-4 ${allAlive ? '' : 'border-fail/40'}`}>
        <div className="flex items-center gap-3">
          <span className={`dot-pulse size-3 rounded-full ${allAlive ? 'bg-ok text-ok' : 'bg-fail text-fail'}`} />
          <div>
            <div className="text-[15px] font-semibold">{allAlive ? 'Todos os serviços vivos' : `${servicosLive.length - aliveCount} serviço(s) parado(s)`}</div>
            <div className="text-[12px] text-dim">{aliveCount}/{servicosLive.length || '…'} heartbeats no prazo · auto-refresh em {refreshIn}s</div>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="badge badge-luna mono">{modo ? modo.KIMI_ADAPTER_MODE : '…'}</span>
          <span className={`badge ${venus?.status === 'online' ? 'badge-ok' : 'badge-fail'}`}>🪐 vênus {venus?.status ?? '…'}</span>
          {pendingPerguntas > 0 && <span className="badge badge-warn">⏳ {pendingPerguntas} pergunta(s) aguardando a Luna</span>}
          {errorInbox > 0 && <span className="badge badge-fail">🩸 {errorInbox} inbox em error</span>}
          <button className="btn btn-sm" onClick={() => setAutoRefresh(!autoRefresh)}>
            <RefreshCw size={12} className={autoRefresh ? 'animate-spin' : ''} style={{ animationDuration: '3s' }} />
            {autoRefresh ? 'auto ON' : 'auto OFF'}
          </button>
        </div>
      </motion.section>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card index={1}>
          <Title icon={ShieldCheck} extra={<button className="btn btn-sm -my-1" onClick={loadAuto}><RefreshCw size={12} />Revalidar</button>}>
            Validação de APIs
          </Title>
          {renderChecks()}
        </Card>
        <Card index={2}>
          <Title icon={Server} extra={<span className="text-[10px] normal-case tracking-normal text-info">countdown = estimativa</span>}>
            Serviços — heartbeats
          </Title>
          {renderServicos()}
        </Card>
      </div>

      <Card index={3}>
        <Title icon={Activity} extra={<button className="btn btn-sm -my-1" onClick={() => setPage('mensageiro')}>ver todas →</button>}>
          Atividade recente
        </Title>
        {renderAtividadeLista(5)}
      </Card>
    </div>
  );

  const PageMensageiro = (
    <div key="mensageiro" className="grid gap-4 xl:grid-cols-5" {...pageAnim}>
      <Card index={0} className="xl:col-span-2">
        <Title icon={Send}>Mensageiro — pipeline oficial</Title>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-[11px] uppercase tracking-wider text-dim">Chat</label>
            <select className="input" value={chatSel} onChange={(e) => { setChatSel(e.target.value); setChatManual(''); }}>
              {chats.map((c) => (
                <option key={c.chat_id} value={c.chat_id}>{c.label} — {c.count} msgs, ativo {timeAgo(c.last_used)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] uppercase tracking-wider text-dim">Ou chat_id manual</label>
            <input className="input mono" placeholder="ex.: 5511999999999" value={chatManual} onChange={(e) => setChatManual(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-[11px] uppercase tracking-wider text-dim">Mensagem</label>
            <textarea className="input min-h-[96px] resize-y" placeholder="Digite a mensagem. Guard-rail ativo: promessas de prazo são bloqueadas."
              value={text} onChange={(e) => setText(e.target.value)} />
            <div className={`mt-1 text-right text-[11px] ${text.length > MAX_CHARS ? 'text-fail' : 'text-dim'}`}>{text.length} / {MAX_CHARS}</div>
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-line bg-bg/60 p-1">
            {(['luna', 'agent:venus'] as const).map((s) => (
              <button key={s} onClick={() => setSender(s)}
                className={`relative flex-1 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${sender === s ? 'text-bg' : 'text-dim hover:text-fg'}`}>
                {sender === s && <motion.span layoutId="sender-pill" className="absolute inset-0 rounded-md bg-gradient-to-r from-luna to-info" transition={{ type: 'spring', stiffness: 400, damping: 32 }} />}
                <span className="relative">{s === 'luna' ? 'Enviar como Luna' : 'Enviar como agent:venus'}</span>
              </button>
            ))}
          </div>
          <button className="btn btn-primary w-full" onClick={enviar} disabled={sending}>
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Enviar pelo pipeline oficial
          </button>
          <AnimatePresence>
            {guardMsg && (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="rounded-lg border border-warn/50 bg-warn/5 p-2.5 text-[12px] text-warn">{guardMsg}</motion.div>
            )}
          </AnimatePresence>
        </div>
      </Card>
      <Card index={1} className="xl:col-span-3">
        <Title icon={Activity} extra={<button className="btn btn-sm -my-1" onClick={loadAtividade}><RefreshCw size={12} />Atualizar</button>}>
          Saídas recentes
        </Title>
        {renderAtividadeLista()}
      </Card>
    </div>
  );

  const PageComando = (
    <div key="comando" className="space-y-4" {...pageAnim}>
      <Card index={0}>
        <Title icon={ArrowLeftRight} extra={
          <span className="text-[10px] normal-case tracking-normal text-luna">a Luna manda por cima — ordem dela é obrigatória; pedido dele passa no julgamento dela</span>
        }>
          LUNA &gt; VÊNUS — cadeia de comando
        </Title>
        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <div className="mb-2 text-[11px] uppercase tracking-wider text-dim">Vênus pergunta → a Luna vê se faz sentido e age</div>
            {tabs([
              { id: 'pending', label: 'aguardando a Luna', count: comando?.perguntas.filter((t) => t.status === 'pending').length },
              { id: 'answered', label: 'answered', count: comando?.perguntas.filter((t) => t.status === 'answered').length },
              { id: 'failed', label: 'failed', count: comando?.perguntas.filter((t) => t.status === 'failed').length },
            ], perguntasTab, setPerguntasTab, 'text-luna')}
            {!comando ? <Skeleton rows={3} /> : (() => {
              const list = comando.perguntas.filter((t) => t.status === perguntasTab);
              if (list.length === 0) return <Empty>Nenhuma pergunta do Vênus neste estado.</Empty>;
              return (
                <ul className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
                  {list.map((t) => (
                    <li key={t.id} className="rounded-xl border border-line/70 bg-bg/50 px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2 text-[12px]">
                        <span className="badge badge-info">venus</span>
                        <span className="mono text-dim">{t.id.slice(0, 8)}</span>
                        <span className="ml-auto text-dim">{timeAgo(t.created_at)}</span>
                        <StatusBadge status={t.status} />
                      </div>
                      <div className="mt-1 whitespace-pre-wrap text-[13px]">{t.prompt}</div>
                      {t.status === 'answered' && t.response && (
                        <div className="mt-2 rounded-lg border border-ok/30 bg-ok/5 p-2 text-[12px] text-ok">{t.response}</div>
                      )}
                      {t.status === 'failed' && t.response && (
                        <div className="mt-2 rounded-lg border border-fail/30 bg-fail/5 p-2 text-[12px] text-fail">{t.response}</div>
                      )}
                      {t.status === 'pending' && (
                        <div className="mt-2 flex gap-2">
                          <input className="input flex-1" placeholder="Resposta da Luna (UPDATE atômico pending → answered)"
                            value={answers[t.id] || ''}
                            onChange={(e) => setAnswers((a) => ({ ...a, [t.id]: e.target.value }))} />
                          <button className="btn btn-primary shrink-0" onClick={() => responderTurno(t)}>
                            <Send size={12} />Responder
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              );
            })()}
          </div>
          <div>
            <div className="mb-2 text-[11px] uppercase tracking-wider text-dim">Luna ordena → Vênus OBRIGATORIAMENTE executa</div>
            <div className="mb-3 space-y-2">
              <textarea className="input min-h-[56px] resize-y" placeholder="Ordem direta pro Vênus — ex.: verifique a inbox e me relate AQUI o resultado"
                value={ordem} onChange={(e) => setOrdem(e.target.value)} />
              <div className="flex gap-2">
                <input className="input flex-1" placeholder="Contexto (opcional)" value={ordemCtx} onChange={(e) => setOrdemCtx(e.target.value)} />
                <button className="btn btn-primary shrink-0" onClick={enviarOrdem} disabled={ordering}>
                  {ordering ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}Ordenar
                </button>
              </div>
            </div>
            {!comando ? <Skeleton rows={3} /> : (() => {
              if (comando.ordens.length === 0) return <Empty>Nenhuma ordem registrada ainda.</Empty>;
              return (
                <ul className="max-h-[340px] space-y-2 overflow-y-auto pr-1">
                  {comando.ordens.map((o) => (
                    <li key={o.id} className="rounded-xl border border-line/70 bg-bg/50 px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2 text-[12px]">
                        <span className="badge badge-luna">luna</span>
                        <span className="mono text-dim">{o.id.slice(0, 8)}</span>
                        <span className="ml-auto text-dim">{timeAgo(o.created_at)}</span>
                        <StatusBadge status={o.status} />
                      </div>
                      <div className="mt-1 text-[13px]">{o.ordem}</div>
                      {o.contexto && <div className="mt-1 text-[11px] text-dim">contexto: {o.contexto}</div>}
                      {o.result && (
                        <div className={`mt-2 rounded-lg border p-2 text-[12px] ${o.status === 'error' ? 'border-fail/30 bg-fail/5 text-fail' : 'border-ok/30 bg-ok/5 text-ok'}`}>{o.result}</div>
                      )}
                      {(o.status === 'done' || o.status === 'error' || o.status === 'ignored') && (
                        <button className="btn btn-sm mt-2" onClick={async () => {
                          try {
                            await postJSON(`/api/comando/${o.id}/reprocessar`, {});
                            toast.success(`ordem ${o.id.slice(0, 8)} voltou para pending`);
                            loadAuto();
                          } catch (e: any) { toast.error(e.message); }
                        }}><RotateCcw size={11} />Reprocessar</button>
                      )}
                    </li>
                  ))}
                </ul>
              );
            })()}
          </div>
        </div>
      </Card>
    </div>
  );

  const PageInbox = (
    <div key="inbox" className="space-y-4" {...pageAnim}>
      <Card index={0}>
        <Title icon={InboxIcon}>Inbox ao vivo — kimiwork_inbox</Title>
        {tabs([
          { id: 'pending', label: 'pending', count: inbox?.filter((e) => e.status === 'pending').length },
          { id: 'processing', label: 'processing', count: inbox?.filter((e) => e.status === 'processing').length },
          { id: 'done', label: 'done', count: inbox?.filter((e) => e.status === 'done').length },
          { id: 'error', label: 'error', count: inbox?.filter((e) => e.status === 'error').length },
        ], inboxTab, setInboxTab)}
        {!inbox ? <Skeleton rows={3} /> : (() => {
          const list = inbox.filter((e) => e.status === inboxTab);
          if (list.length === 0) return <Empty>Nenhum evento com status "{inboxTab}".</Empty>;
          return (
            <ul className="space-y-2">
              {list.map((ev) => (
                <li key={ev.id} className="rounded-xl border border-line/70 bg-bg/50 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2 text-[12px]">
                    <span className="mono text-dim">{ev.id}</span>
                    <span className="badge">{ev.kind}</span>
                    <span className="ml-auto text-dim">{timeAgo(ev.received_at)}</span>
                    <StatusBadge status={ev.status} />
                  </div>
                  <div className="mt-1 text-[13px]"><span className="text-dim">{(ev.payload as any).from}:</span> {(ev.payload as any).text ?? JSON.stringify(ev.payload)}</div>
                  {ev.status === 'processing' && ev.processing_by && (
                    <div className="mt-1 flex items-center gap-1.5 text-[11px] text-luna">
                      <Loader2 size={11} className="animate-spin" />processando por {ev.processing_by}
                    </div>
                  )}
                  {ev.status === 'error' && ev.result?.error && (
                    <div className="mt-1 text-[11px] text-fail">{String(ev.result.error)}</div>
                  )}
                  {(ev.status === 'done' || ev.status === 'error') && (
                    <div className="mt-2 flex gap-2">
                      <button className="btn btn-sm" onClick={() => reprocessar(ev)}><RotateCcw size={11} />Reprocessar</button>
                      <button className="btn btn-sm" onClick={() => escalar(ev)}><ArrowUpRight size={11} />Escalar pra Luna</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          );
        })()}
      </Card>
    </div>
  );

  const PageVenus = (
    <div key="venus" className="space-y-4" {...pageAnim}>
      <Card index={0}>
        <Title icon={Sparkles}>Vênus — varredura</Title>
        <div className="flex flex-wrap items-center gap-3">
          <span className={`badge ${venus?.status === 'online' ? 'badge-ok' : 'badge-fail'}`}>
            <span className={`size-1.5 rounded-full ${venus?.status === 'online' ? 'bg-ok dot-pulse text-ok' : 'bg-fail'}`} />
            {venus?.status ?? '...'}
          </span>
          <span className="badge badge-info">{venus?.processed_by_venus ?? 0} eventos processados</span>
          {venus?.running && (
            <span className="flex items-center gap-1.5 text-[12px] text-luna"><Loader2 size={12} className="animate-spin" />tarefa em execução</span>
          )}
          <div className="ml-auto flex w-full max-w-md gap-2">
            <input className="input" placeholder="Invocar tarefa — ex.: resumir pendências da inbox"
              value={tarefa} onChange={(e) => setTarefa(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && invocarTarefa()} />
            <button className="btn btn-primary shrink-0" onClick={invocarTarefa} disabled={invoking}>
              {invoking ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}Invocar
            </button>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-1 border-b border-line/70">
          {(['log', 'erros'] as const).map((t) => (
            <button key={t} onClick={() => setVenusTab(t)}
              className={`px-3 py-1.5 text-[12px] font-medium ${venusTab === t ? 'border-b-2 border-luna text-txt' : 'text-dim hover:text-txt'}`}>
              {t === 'log' ? 'Log da varredura' : `Erros & incidências${venusErros && (venusErros.incidencias.length + venusErros.log.length) > 0 ? ` (${venusErros.incidencias.length + venusErros.log.length})` : ''}`}
            </button>
          ))}
        </div>
        {venusTab === 'log' ? (
          <pre ref={logRef} className="mono mt-3 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-xl border border-line/70 bg-bg/70 p-3 text-dim">
            {venus?.log.join('\n') ?? '...'}
          </pre>
        ) : (
          <div className="mt-3 max-h-80 space-y-3 overflow-y-auto rounded-xl border border-line/70 bg-bg/70 p-3">
            {venusErros?.incidencias.length ? (
              <div>
                <div className="mb-1.5 text-[11px] uppercase tracking-wider text-dim">Incidências — inbox em error (48h)</div>
                <ul className="space-y-1.5">
                  {venusErros.incidencias.map((i) => (
                    <li key={i.id} className="rounded-lg border border-line/60 p-2">
                      <div className="flex flex-wrap items-center gap-2 text-[11px]">
                        <span className="badge badge-fail">error</span>
                        <span className="text-dim">{i.kind}</span>
                        <span className="text-dim">{new Date(i.received_at).toLocaleString('pt-BR')}</span>
                        {i.por && <span className="text-dim">por: {i.por}</span>}
                      </div>
                      <div className="mt-1 text-[12px] text-txt">{i.motivo ?? '(sem motivo registrado)'}</div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="text-[12px] text-dim">Sem incidências em 48h.</div>
            )}
            {venusErros?.log.length ? (
              <div>
                <div className="mb-1.5 text-[11px] uppercase tracking-wider text-dim">Linhas de erro recentes (logs pm2)</div>
                <pre className="mono whitespace-pre-wrap text-[11px] text-fail">{venusErros.log.join('\n')}</pre>
              </div>
            ) : null}
          </div>
        )}
      </Card>
    </div>
  );

  const PageServicos = (
    <div key="servicos" className="space-y-4" {...pageAnim}>
      <Card index={0}>
        <Title icon={Server} extra={<span className="text-[10px] normal-case tracking-normal text-info">countdown = estimativa · heartbeat no prazo = 90s</span>}>
          Serviços — heartbeats
        </Title>
        {renderServicos()}
      </Card>
    </div>
  );

  const PageConfig = (
    <div key="config" className="grid gap-4 xl:grid-cols-2" {...pageAnim}>
      <Card index={0}>
        <Title icon={BrainCircuit}>Cérebro / Modo — escrita atômica no .env</Title>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-[11px] uppercase tracking-wider text-dim">KIMI_ADAPTER_MODE</label>
            <select className="input" value={draftAdapter} onChange={(e) => setDraftAdapter(e.target.value)}>
              {ADAPTER_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] uppercase tracking-wider text-dim">LIVE_BRAIN_PROVIDER</label>
            <select className="input" value={draftProvider} onChange={(e) => setDraftProvider(e.target.value)}>
              {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-line bg-bg/60 px-3 py-2">
            <span className="text-[12px] text-dim">VENUS_AUTONOMO</span>
            <button role="switch" aria-checked={draftVenus} onClick={() => setDraftVenus(!draftVenus)}
              className={`relative h-[22px] w-[42px] rounded-full border transition-colors ${draftVenus ? 'border-luna/60 bg-luna/25' : 'border-line bg-bg'}`}>
              <motion.span layout className={`absolute top-[2px] size-4 rounded-full ${draftVenus ? 'right-[2px] bg-luna' : 'left-[2px] bg-dim'}`}
                transition={{ type: 'spring', stiffness: 500, damping: 32 }} />
            </button>
          </div>
          <button className="btn btn-primary w-full" onClick={aplicarModo} disabled={applying}>
            {applying ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Aplicar no .env
          </button>
          {modo && (
            <div className="mono space-y-1 rounded-lg border border-line bg-bg/60 p-3">
              <div className="flex justify-between"><span className="text-dim">atual</span><span className="text-luna">{modo.KIMI_ADAPTER_MODE}</span></div>
              <div className="flex justify-between"><span className="text-dim">provider</span><span className="text-luna">{modo.LIVE_BRAIN_PROVIDER}</span></div>
              <div className="flex justify-between"><span className="text-dim">vênus autônomo</span><span className="text-luna">{modo.VENUS_AUTONOMO}</span></div>
            </div>
          )}
        </div>
      </Card>
      <Card index={1}>
        <Title icon={Terminal}>Status das integrações</Title>
        {renderChecks()}
        <div className="hint mt-3">As chaves sensíveis são verificadas por presença — valores nunca expostos no painel.</div>
      </Card>
    </div>
  );

  const pages: Record<PageId, React.ReactNode> = {
    geral: PageGeral, mensageiro: PageMensageiro, comando: PageComando,
    inbox: PageInbox, venus: PageVenus, servicos: PageServicos, config: PageConfig,
  };

  return (
    <div className="flex min-h-screen">
      {/* ── SIDEBAR ── */}
      <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r border-line/70 bg-surface/60 backdrop-blur-sm">
        <div className="flex items-center gap-2.5 border-b border-line/70 px-4 py-4">
          <span className="grid size-8 place-items-center rounded-lg bg-luna/15 text-luna"><Moon size={16} /></span>
          <div>
            <div className="text-[13px] font-semibold tracking-[0.18em]">PAINEL DA LUNA</div>
            <div className="text-[10px] text-dim">controle · v2</div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-2">
          {PAGES.map((p) => {
            const Icon = p.icon;
            const alert = (p.id === 'comando' && pendingPerguntas > 0) || (p.id === 'inbox' && errorInbox > 0);
            return (
              <button key={p.id} onClick={() => setPage(p.id)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition-all hover:translate-x-0.5 ${page === p.id ? 'bg-luna/10 font-medium text-luna' : 'text-dim hover:bg-surface hover:text-fg'}`}>
                <Icon size={15} />
                {p.label}
                {alert && <span className="ml-auto size-2 rounded-full bg-fail" />}
              </button>
            );
          })}
        </nav>
        <div className="border-t border-line/70 px-4 py-3 text-[10.5px] text-dim">
          <div className="flex items-center gap-2">
            <span className={`size-2 rounded-full ${allAlive ? 'bg-ok' : 'bg-fail'}`} />
            {servicosLive.length === 0 ? 'carregando…' : `${aliveCount}/${servicosLive.length} serviços vivos`}
          </div>
          <div className="mt-1">auto-refresh em {refreshIn}s · <button className="underline hover:text-fg" onClick={() => setAutoRefresh(!autoRefresh)}>{autoRefresh ? 'ON' : 'OFF'}</button></div>
        </div>
      </aside>

      {/* ── CONTEÚDO ── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-50 border-b border-line/70 bg-bg/80 backdrop-blur-md">
          <div className="flex h-14 items-center gap-4 px-6">
            <span className="text-[13px] font-semibold">{PAGES.find((p) => p.id === page)?.label}</span>
            <div className="ml-auto flex items-center gap-2">
              <span className="hidden text-[10px] uppercase tracking-[0.15em] text-dim sm:inline">modo do cérebro</span>
              <span className="badge badge-luna mono">{modo ? modo.KIMI_ADAPTER_MODE : '...'}</span>
              <span className={`badge ${allAlive ? 'badge-ok' : 'badge-fail'}`}>
                <span className={`size-1.5 rounded-full ${allAlive ? 'bg-ok' : 'bg-fail'}`} />
                {servicosLive.length === 0 ? '...' : allAlive ? `${aliveCount}/${servicosLive.length} vivos` : `${servicosLive.length - aliveCount} parado(s)`}
              </span>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1200px] flex-1 p-6">
          <AnimatePresence mode="wait">
            <motion.div key={page} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
              {pages[page]}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <Toaster theme="dark" position="bottom-right" toastOptions={{
        style: { background: '#161b22', border: '1px solid #30363d', color: '#e6edf3' },
      }} />
    </div>
  );
}
