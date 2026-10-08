"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Toaster, toast } from "sonner";
import {
  Moon, BrainCircuit, ShieldCheck, Send, Activity, Server, Inbox, ArrowLeftRight,
  Sparkles, CheckCircle2, XCircle, RefreshCw, RotateCcw, ChevronDown, ArrowUpRight, Loader2,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Tipos — espelham os contratos de lib/store.ts (NAO mudar ao plugar no real)
// ---------------------------------------------------------------------------
type Modo = { KIMI_ADAPTER_MODE: string; LIVE_BRAIN_PROVIDER: string; VENUS_AUTONOMO: string };
type Check = { id: string; label: string; ok: boolean; detail: string };
type Chat = { chat_id: string; label: string; count: number; last_used: string };
type Msg = { id: string; conversation_id: string; chat_id: string; sender: string; body: string; send_state: string; created_at: string };
type CtxLine = { sender: string; direction: string; body: string; created_at: string };
type Servico = { service: string; pid: number; state: string; seconds_since: number; alive: boolean; status: string; next_beat_in_s: number; progress: number; interval_s: number };
type InboxEvent = { id: string; kind: string; payload: Record<string, any>; status: string; received_at: string; processed_at: string | null; processing_by: string | null; result: Record<string, any> | null };
type Turno = { id: string; session_key: string; prompt: string; status: string; response: string | null; answered_at: string | null; created_at: string };
type VenusInfo = { status: string; running: boolean; processed_by_venus: number; log: string[] };

// allowlists espelhadas do store (a validacao final e server-side, fail-closed)
const ADAPTER_MODES = ['mock', 'kimi-web', 'kimi-api', 'kimi-cli', 'kimi-web-local', 'gemini', 'pi', 'kimiwork'];
const PROVIDERS = ['kimi', 'kimiwork'];

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

const cardAnim = (i: number) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.45, delay: i * 0.06, ease: [0.22, 1, 0.36, 1] as const },
});

function Card({ children, className = '', index }: { children: React.ReactNode; className?: string; index: number }) {
  return (
    <motion.section {...cardAnim(index)} className={`card card-hover ${className}`}>
      {children}
    </motion.section>
  );
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
  return <div className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-[13px] text-dim">{children}</div>;
}
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    queued: 'badge-info', sent: 'badge-ok', failed: 'badge-fail',
    pending: 'badge-info', processing: 'badge-luna', done: 'badge-ok',
    error: 'badge-fail', answered: 'badge-ok',
  };
  return <span className={`badge ${map[status] || 'badge'}`}>{status}</span>;
}
function SenderChip({ sender }: { sender: string }) {
  if (sender === 'luna') return <span className="badge badge-luna">Luna</span>;
  if (sender === 'agent:venus') return <span className="badge badge-info">agent:venus</span>;
  return <span className="badge">contact</span>;
}

export default function Painel() {
  // estado dos modulos
  const [modo, setModo] = useState<Modo | null>(null);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [atividade, setAtividade] = useState<Msg[]>([]);
  const [servicos, setServicos] = useState<Servico[] | null>(null);
  const [servicosAt, setServicosAt] = useState<number>(0);
  const [inbox, setInbox] = useState<InboxEvent[] | null>(null);
  const [turnos, setTurnos] = useState<Turno[] | null>(null);
  const [venus, setVenus] = useState<VenusInfo | null>(null);
  const [tick, setTick] = useState(0);

  // UI
  const [inboxTab, setInboxTab] = useState<'pending' | 'processing' | 'done' | 'error'>('pending');
  const [turnosTab, setTurnosTab] = useState<'pending' | 'answered' | 'failed'>('pending');
  const [chatSel, setChatSel] = useState('productions');
  const [sender, setSender] = useState<'luna' | 'agent:venus'>('luna');
  const [text, setText] = useState('');
  const [sendResult, setSendResult] = useState<string | null>(null);
  const [guardMsg, setGuardMsg] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [contexto, setContexto] = useState<CtxLine[] | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [draftAdapter, setDraftAdapter] = useState('kimi-api');
  const [draftProvider, setDraftProvider] = useState('kimi');
  const [draftVenus, setDraftVenus] = useState(true);
  const [applying, setApplying] = useState(false);
  const [invoking, setInvoking] = useState(false);
  const [tarefa, setTarefa] = useState('');
  const logRef = useRef<HTMLPreElement>(null);
  const mensageiroRef = useRef<HTMLDivElement>(null);

  // -------------------------------------------------------------------------
  // loaders
  // -------------------------------------------------------------------------
  const loadModo = useCallback(async () => {
    const m = await getJSON<Modo>('/api/modo');
    setModo(m);
    setDraftAdapter(m.KIMI_ADAPTER_MODE);
    setDraftProvider(m.LIVE_BRAIN_PROVIDER);
    setDraftVenus(m.VENUS_AUTONOMO === 'true');
  }, []);

  const loadAuto = useCallback(async () => {
    // modulos com auto-refresh de 10s: validacao, servicos, inbox, turnos (+venus p/ log vivo)
    const run = async <T,>(p: Promise<T>, set: (v: T) => void) => { try { set(await p); } catch { /* mantem estado anterior */ } };
    run(getJSON<Check[]>('/api/validacao'), setChecks);
    run(getJSON<Servico[]>('/api/servicos').then((s) => { setServicosAt(Date.now()); return s; }), setServicos);
    run(getJSON<InboxEvent[]>('/api/inbox'), setInbox);
    run(getJSON<Turno[]>('/api/turnos'), setTurnos);
    run(getJSON<VenusInfo>('/api/venus'), setVenus);
  }, []);

  const loadAtividade = useCallback(async () => {
    try { setAtividade(await getJSON<Msg[]>('/api/atividade')); } catch { /* noop */ }
  }, []);

  useEffect(() => {
    loadModo().catch(() => toast.error('falha ao ler modo atual'));
    getJSON<Chat[]>('/api/chats').then((c) => { setChats(c); setChatSel(c[0]?.chat_id || 'productions'); }).catch(() => {});
    loadAtividade();
    loadAuto();
    const t10 = setInterval(loadAuto, 10_000);
    const t1 = setInterval(() => setTick((x) => x + 1), 1_000);
    return () => { clearInterval(t10); clearInterval(t1); };
  }, [loadModo, loadAtividade, loadAuto]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [venus?.log]);

  // countdown derivado do snapshot + relogio de 1s (estimativa, rotulado)
  const now = Date.now();
  const tickDelta = servicosAt ? Math.floor((now - servicosAt) / 1000) : 0;
  const servicosLive = (servicos || []).map((s) => {
    const since = s.seconds_since + tickDelta;
    return {
      ...s,
      since,
      alive: since <= 90,
      remaining: Math.max(0, s.interval_s - since),
      progress: Math.min(1, since / s.interval_s),
    };
  });
  const allAlive = servicosLive.length > 0 && servicosLive.every((s) => s.alive);
  const aliveCount = servicosLive.filter((s) => s.alive).length;

  // -------------------------------------------------------------------------
  // acoes
  // -------------------------------------------------------------------------
  async function aplicarModo() {
    setApplying(true);
    try {
      const changes: Array<[string, string]> = [];
      if (modo && draftAdapter !== modo.KIMI_ADAPTER_MODE) changes.push(['KIMI_ADAPTER_MODE', draftAdapter]);
      if (modo && draftProvider !== modo.LIVE_BRAIN_PROVIDER) changes.push(['LIVE_BRAIN_PROVIDER', draftProvider]);
      if (modo && String(draftVenus) !== modo.VENUS_AUTONOMO) changes.push(['VENUS_AUTONOMO', String(draftVenus)]);
      if (changes.length === 0) { toast.info('nenhuma alteracao para aplicar'); return; }
      for (const [key, value] of changes) {
        const r = await postJSON<{ ok: boolean; gravado?: Record<string, string>; error?: string }>('/api/modo', { key, value });
        if (!r.ok) { toast.error(`${key}: ${r.error}`); return; }
        toast.success(`${key} = ${value}`, { description: 'gravado no .env (mock)' });
      }
      await loadModo();
    } finally { setApplying(false); }
  }

  async function enviar() {
    if (!text.trim()) { toast.error('mensagem vazia'); return; }
    setSending(true); setGuardMsg(null); setSendResult(null);
    try {
      const r = await postJSON<{ ok: boolean; id?: string; send_state?: string; error?: string; blocked?: boolean }>('/api/mensagem', {
        chat_id: chatSel, body: text, sender,
      });
      setSendResult(`id=${r.id}  send_state=${r.send_state}  (o whatsplay entrega em seguida)`);
      toast.success(`mensagem enfileirada como ${sender}`, { description: `id ${r.id}` });
      setText('');
      setTimeout(loadAtividade, 2600); // mostra queued -> sent no feed
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
    setChatSel(m.chat_id);
    setSender(m.sender === 'agent:venus' ? 'agent:venus' : 'luna');
    setText(`[retomando ${m.chat_id}] `);
    mensageiroRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    toast.info('contexto carregado no mensageiro', { description: m.chat_id });
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
      toast.success(`escalado para a Luna`, { description: `turno ${r.turno_id} (channel geral)` });
      loadAuto();
    } catch (e: any) { toast.error(e.message); }
  }

  async function responderTurno(t: Turno) {
    const resp = (answers[t.id] || '').trim();
    if (!resp) { toast.error('resposta vazia'); return; }
    try {
      await postJSON(`/api/turnos/${t.id}/responder`, { response: resp });
      toast.success(`turno ${t.id} respondido (UPDATE atomico)`);
      setAnswers((a) => ({ ...a, [t.id]: '' }));
      loadAuto();
    } catch (e: any) { toast.error(e.message); }
  }

  async function invocarTarefa() {
    if (!tarefa.trim()) { toast.error('tarefa vazia'); return; }
    setInvoking(true);
    try {
      await postJSON('/api/venus/tarefa', { tarefa });
      toast.success('tarefa invocada', { description: 'node scripts/venus/venus.mjs --tarefa (mock)' });
      setTarefa('');
      setTimeout(loadAuto, 800);
    } catch (e: any) { toast.error(e.message); }
    finally { setInvoking(false); }
  }

  // -------------------------------------------------------------------------
  // render
  // -------------------------------------------------------------------------
  return (
    <div className="min-h-screen">
      {/* ---------- header ---------- */}
      <header className="sticky top-0 z-50 border-b border-line/70 bg-bg/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-4 px-5">
          <div className="flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-lg bg-luna/15 text-luna">
              <Moon size={16} />
            </span>
            <span className="text-[13px] font-semibold tracking-[0.2em]">PAINEL DA LUNA</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-[10px] uppercase tracking-[0.15em] text-dim sm:inline">modo do cerebro</span>
            <span className="badge badge-luna mono">{modo ? modo.KIMI_ADAPTER_MODE : '...'}</span>
          </div>
          <div className="flex items-center gap-2 border-l border-line pl-4">
            <span className={`dot-pulse size-2 rounded-full ${allAlive ? 'bg-ok text-ok' : 'bg-fail text-fail'}`} />
            <span className="text-[12px] text-dim">
              {servicosLive.length === 0 ? 'carregando' : allAlive ? `${aliveCount}/${servicosLive.length} servicos vivos` : `${servicosLive.length - aliveCount} parado(s)`}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1440px] grid-cols-12 gap-4 p-5">
        {/* ---------- 1. CEREBRO / MODO ---------- */}
        <Card index={0} className="col-span-12 lg:col-span-4">
          <Title icon={BrainCircuit}>Cerebro / Modo</Title>
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
              <button
                role="switch" aria-checked={draftVenus}
                onClick={() => setDraftVenus(!draftVenus)}
                className={`relative h-[22px] w-[42px] rounded-full border transition-colors ${draftVenus ? 'border-luna/60 bg-luna/25' : 'border-line bg-bg'}`}
              >
                <motion.span layout className={`absolute top-[2px] size-4 rounded-full ${draftVenus ? 'right-[2px] bg-luna' : 'left-[2px] bg-dim'}`} transition={{ type: 'spring', stiffness: 500, damping: 32 }} />
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
                <div className="flex justify-between"><span className="text-dim">venus autonomo</span><span className="text-luna">{modo.VENUS_AUTONOMO}</span></div>
              </div>
            )}
          </div>
        </Card>

        {/* ---------- 2. VALIDACAO ---------- */}
        <Card index={1} className="col-span-12 lg:col-span-4">
          <Title icon={ShieldCheck} extra={
            <button className="btn btn-sm -my-1" onClick={loadAuto}><RefreshCw size={12} />Revalidar</button>
          }>Validacao de APIs</Title>
          {!checks ? <Skeleton rows={5} /> : (
            <ul className="divide-y divide-line/50">
              {checks.map((c) => (
                <motion.li key={c.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-start gap-2.5 py-2">
                  {c.ok
                    ? <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-ok" />
                    : <XCircle size={15} className="mt-0.5 shrink-0 text-fail" />}
                  <div className="min-w-0">
                    <div className="text-[13px] leading-tight">{c.label}</div>
                    <div className="truncate text-[11px] text-dim">{c.detail}</div>
                  </div>
                </motion.li>
              ))}
            </ul>
          )}
        </Card>

        {/* ---------- 3. MENSAGEIRO ---------- */}
        <Card index={2} className="col-span-12 lg:col-span-4">
          <div ref={mensageiroRef} className="scroll-mt-20">
            <Title icon={Send}>Mensageiro</Title>
          </div>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-wider text-dim">Chat</label>
              <select className="input" value={chatSel} onChange={(e) => setChatSel(e.target.value)}>
                {chats.map((c) => (
                  <option key={c.chat_id} value={c.chat_id}>
                    {c.label} — {c.count} msgs, ativo {timeAgo(c.last_used)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-wider text-dim">Mensagem</label>
              <textarea
                className="input min-h-[88px] resize-y"
                placeholder="Digite a mensagem. Guard-rail ativo: promessas de prazo sao bloqueadas."
                value={text} onChange={(e) => setText(e.target.value)}
              />
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
              {sendResult && (
                <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="mono rounded-lg border border-ok/40 bg-ok/5 p-2.5 text-ok">{sendResult}</motion.div>
              )}
              {guardMsg && (
                <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="rounded-lg border border-warn/50 bg-warn/5 p-2.5 text-[12px] text-warn">{guardMsg}</motion.div>
              )}
            </AnimatePresence>
          </div>
        </Card>

        {/* ---------- 4. ATIVIDADE ---------- */}
        <Card index={3} className="col-span-12 xl:col-span-6">
          <Title icon={Activity} extra={
            <button className="btn btn-sm -my-1" onClick={loadAtividade}><RefreshCw size={12} />Atualizar</button>
          }>Atividade — saidas recentes</Title>
          {atividade.length === 0 ? <Empty>Nenhuma mensagem de saida registrada.</Empty> : (
            <ul className="space-y-2">
              {atividade.map((m) => (
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
          )}
        </Card>

        {/* ---------- 5. SERVICOS ---------- */}
        <Card index={4} className="col-span-12 xl:col-span-6">
          <Title icon={Server} extra={<span className="text-[10px] normal-case tracking-normal text-info">countdown = estimativa</span>}>
            Servicos — heartbeats
          </Title>
          {!servicosLive.length ? <Skeleton rows={4} /> : (
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
                      <motion.div
                        className={`h-full rounded-full ${s.alive ? 'bg-gradient-to-r from-info to-luna' : 'bg-fail'}`}
                        animate={{ width: `${s.progress * 100}%` }}
                        transition={{ duration: 1, ease: 'linear' }}
                      />
                    </div>
                    <span className="w-40 text-right text-[11px] text-dim">
                      prox. beat ~{s.remaining}s <span className="text-dim/60">(estimativa)</span>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* ---------- 6. INBOX ---------- */}
        <Card index={5} className="col-span-12 xl:col-span-6">
          <Title icon={Inbox}>Inbox ao vivo — kimiwork_inbox</Title>
          <div className="relative mb-3 flex gap-1 border-b border-line/70">
            {(['pending', 'processing', 'done', 'error'] as const).map((t) => (
              <button key={t} onClick={() => setInboxTab(t)}
                className={`relative px-3 py-1.5 text-[12px] transition-colors ${inboxTab === t ? 'text-info' : 'text-dim hover:text-fg'}`}>
                {t}
                {inbox && <span className="ml-1 text-[10px] opacity-70">{inbox.filter((e) => e.status === t).length}</span>}
                {inboxTab === t && <motion.span layoutId="inbox-tab" className="absolute inset-x-2 -bottom-px h-0.5 rounded bg-info" />}
              </button>
            ))}
          </div>
          {!inbox ? <Skeleton rows={3} /> : (
            (() => {
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
            })()
          )}
        </Card>

        {/* ---------- 7. TURNOS ---------- */}
        <Card index={6} className="col-span-12 xl:col-span-6">
          <Title icon={ArrowLeftRight}>Turnos Venus &lt;-&gt; Luna — channel geral</Title>
          <div className="relative mb-3 flex gap-1 border-b border-line/70">
            {(['pending', 'answered', 'failed'] as const).map((t) => (
              <button key={t} onClick={() => setTurnosTab(t)}
                className={`relative px-3 py-1.5 text-[12px] transition-colors ${turnosTab === t ? 'text-luna' : 'text-dim hover:text-fg'}`}>
                {t === 'pending' ? 'aguardando a Luna' : t}
                {turnos && <span className="ml-1 text-[10px] opacity-70">{turnos.filter((x) => x.status === t).length}</span>}
                {turnosTab === t && <motion.span layoutId="turnos-tab" className="absolute inset-x-2 -bottom-px h-0.5 rounded bg-luna" />}
              </button>
            ))}
          </div>
          {!turnos ? <Skeleton rows={3} /> : (
            (() => {
              const list = turnos.filter((t) => t.status === turnosTab);
              if (list.length === 0) return <Empty>Nenhum turno neste estado.</Empty>;
              return (
                <ul className="space-y-2">
                  {list.map((t) => (
                    <li key={t.id} className="rounded-xl border border-line/70 bg-bg/50 px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2 text-[12px]">
                        <span className="mono text-dim">{t.id}</span>
                        <span className="mono text-dim">{t.session_key}</span>
                        <span className="ml-auto text-dim">{timeAgo(t.created_at)}</span>
                        <StatusBadge status={t.status} />
                      </div>
                      <div className="mt-1 text-[13px]">{t.prompt}</div>
                      {t.status === 'answered' && t.response && (
                        <div className="mt-2 rounded-lg border border-ok/30 bg-ok/5 p-2 text-[12px] text-ok">{t.response}</div>
                      )}
                      {t.status === 'failed' && t.response && (
                        <div className="mt-2 rounded-lg border border-fail/30 bg-fail/5 p-2 text-[12px] text-fail">{t.response}</div>
                      )}
                      {t.status === 'pending' && (
                        <div className="mt-2 flex gap-2">
                          <input
                            className="input flex-1"
                            placeholder="Resposta da Luna (UPDATE atomico pending -> answered)"
                            value={answers[t.id] || ''}
                            onChange={(e) => setAnswers((a) => ({ ...a, [t.id]: e.target.value }))}
                          />
                          <button className="btn btn-primary shrink-0" onClick={() => responderTurno(t)}>
                            <Send size={12} />Responder
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              );
            })()
          )}
        </Card>

        {/* ---------- 8. VENUS ---------- */}
        <Card index={7} className="col-span-12">
          <Title icon={Sparkles}>Venus — varredura</Title>
          <div className="flex flex-wrap items-center gap-3">
            <span className={`badge ${venus?.status === 'online' ? 'badge-ok' : 'badge-fail'}`}>
              <span className={`size-1.5 rounded-full ${venus?.status === 'online' ? 'bg-ok dot-pulse text-ok' : 'bg-fail'}`} />
              {venus?.status ?? '...'}
            </span>
            <span className="badge badge-info">{venus?.processed_by_venus ?? 0} eventos processados</span>
            {venus?.running && (
              <span className="flex items-center gap-1.5 text-[12px] text-luna"><Loader2 size={12} className="animate-spin" />tarefa em execucao</span>
            )}
            <div className="ml-auto flex w-full max-w-md gap-2">
              <input className="input" placeholder='Invocar tarefa — ex.: resumir pendencias da inbox'
                value={tarefa} onChange={(e) => setTarefa(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && invocarTarefa()} />
              <button className="btn btn-primary shrink-0" onClick={invocarTarefa} disabled={invoking}>
                {invoking ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}Invocar
              </button>
            </div>
          </div>
          <pre ref={logRef} className="mono mt-3 max-h-52 overflow-y-auto whitespace-pre-wrap rounded-xl border border-line/70 bg-bg/70 p-3 text-dim">
            {venus?.log.join('\n') ?? '...'}
          </pre>
        </Card>
      </main>

      <Toaster theme="dark" position="bottom-right" toastOptions={{
        style: { background: '#161b22', border: '1px solid #30363d', color: '#e6edf3' },
      }} />
    </div>
  );
}
