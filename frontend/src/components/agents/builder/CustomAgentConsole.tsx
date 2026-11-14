"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { AppShell, Panel } from "@/components/AppShell";
import { BuildPanel } from "@/components/agents/builder/BuildPanel";
import {
  BTN_GHOST,
  BTN_GHOST_PLAIN,
  BTN_PRIMARY,
  CODE_BOX,
  Field,
  INPUT,
  LABEL,
  Notice,
  StatusBadge,
  WalletGate,
} from "@/components/agents/builder/BuilderUi";
import { LimitsPanel, StrategyPanel } from "@/components/agents/builder/SpecPanels";
import { LegalSignInNotice } from "@/components/legal/LegalSignInNotice";
import { useDcaWalletAuth } from "@/hooks/useDcaWalletAuth";
import {
  BuilderApiError,
  builderApi,
  errorText,
  formatScore,
  formatTime,
  formatUsd,
  isAbort,
  shortAddress,
  type AomiState,
  type BuilderAgent,
  type BuilderEvaluation,
  type BuilderRun,
  type BuilderSignal,
  type ChatEvent,
} from "@/lib/builderClient";

const RUNS_REFRESH_MS = 30_000;

export function CustomAgentConsole({ agentId }: { agentId: string }) {
  const { publicKey } = useWallet();
  const { wallet, token, busy: authBusy, error: authError, isAuthenticated } = useDcaWalletAuth();
  const [agent, setAgent] = useState<BuilderAgent | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [aomi, setAomi] = useState<AomiState | null>(null);
  const [activityTick, setActivityTick] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setAgent(null);
    setLoadError(null);
    builderApi
      .get(agentId, controller.signal)
      .then(setAgent)
      .catch((err) => {
        if (!isAbort(err)) setLoadError(errorText(err));
      });
    return () => controller.abort();
  }, [agentId]);

  const onAgent = useCallback((next: BuilderAgent) => setAgent(next), []);
  const bumpActivity = useCallback(() => setActivityTick((tick) => tick + 1), []);

  if (!agent) {
    return (
      <AppShell title="Custom agent">
        {loadError ? (
          <div className="space-y-4">
            <Notice tone="warn">{loadError}</Notice>
            <Link href="/agents" className={BTN_GHOST}>
              Back to marketplace
            </Link>
          </div>
        ) : (
          <p className="font-mono text-xs text-muted-foreground">Loading agent {agentId}…</p>
        )}
      </AppShell>
    );
  }

  const phantomAddress = publicKey?.toBase58() ?? null;

  return (
    <AppShell title={agent.spec.name} subtitle={agent.spec.description}>
      <div className="space-y-6">
        <Panel title="Agent" action={<StatusBadge status={agent.build_status} />}>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <Field label="Template">{agent.spec.strategy.template}</Field>
            <Field label="Build status">{agent.build_status}</Field>
            <Field label="Spec sha">{agent.spec_sha}</Field>
            <Field label="App name">{agent.app_name}</Field>
            <Field label="Agent id">{agent.id}</Field>
            <Field label="Owner">
              <span title={agent.owner_wallet}>{shortAddress(agent.owner_wallet)}</span>
            </Field>
          </div>
        </Panel>

        <WalletGate
          authBusy={authBusy}
          authError={authError}
          isAuthenticated={isAuthenticated}
          purpose="check signals, use the agent wallet and chat"
        />

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="min-w-0 space-y-6 lg:col-span-2">
            <SignalsPanel
              agentId={agent.id}
              token={token}
              defaultWallet={aomi?.wallet?.address ?? phantomAddress}
              defaultWalletSource={aomi?.wallet?.address ? "Aomi agent wallet" : phantomAddress ? "connected wallet" : null}
              onRun={bumpActivity}
            />
            <ChatPanel agentId={agent.id} token={token} onReply={bumpActivity} />
            <RunLogPanel agentId={agent.id} refreshTick={activityTick} />
            <SourcePanel agentId={agent.id} buildStatus={agent.build_status} />
          </div>
          <div className="min-w-0 space-y-6">
            <AomiWalletPanel
              agentId={agent.id}
              token={token}
              quote={agent.spec.limits.quote}
              refreshTick={activityTick}
              state={aomi}
              onState={setAomi}
            />
            <LimitsPanel limits={agent.spec.limits} />
            <StrategyPanel agent={agent} />
            <BuildPanel agent={agent} token={token} wallet={wallet} onAgent={onAgent} />
          </div>
        </div>

        <LegalSignInNotice />
      </div>
    </AppShell>
  );
}

// ---------------------------------------------------------------- signals

function ActionBadge({ action }: { action: string }) {
  const tone =
    action === "buy"
      ? "bg-signal text-primary-foreground"
      : action === "sell"
        ? "border border-warn/60 text-warn"
        : "border border-grid text-muted-foreground";
  return (
    <span className={`px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] ${tone}`}>
      {action}
    </span>
  );
}

function signalTone(signal: string) {
  return signal === "bullish" ? "text-signal" : signal === "bearish" ? "text-warn" : "text-muted-foreground";
}

function SignalRow({ signal }: { signal: BuilderSignal }) {
  const resolved = signal.token && "symbol" in signal.token ? signal.token : null;
  const tokenError = signal.token && "error" in signal.token ? signal.token.error : null;
  const counts = signal.signal_counts;
  const analysts = signal.analysts ?? [];
  const headlines = signal.headlines ?? [];

  return (
    <div className="border border-grid">
      <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-3">
        <div className="flex min-w-0 items-center gap-3">
          {resolved?.icon && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={resolved.icon} alt="" width={28} height={28} className="h-7 w-7 shrink-0 rounded-full" />
          )}
          <div className="min-w-0">
            <div className="font-display text-base font-bold">
              {resolved?.symbol ?? signal.symbol}
              {resolved && resolved.symbol !== signal.symbol && (
                <span className="ml-2 font-mono text-[10px] font-normal uppercase tracking-[0.14em] text-muted-foreground">
                  {signal.symbol}
                </span>
              )}
            </div>
            {resolved?.name && <div className="truncate text-xs text-muted-foreground">{resolved.name}</div>}
          </div>
        </div>
        <ActionBadge action={signal.action} />
      </div>

      <div className="grid grid-cols-2 gap-4 border-t border-grid px-3 py-3 sm:grid-cols-4">
        <Field label="Price">{formatUsd(signal.price)}</Field>
        <Field label="Composite score">{formatScore(signal.composite_score)}</Field>
        <Field label="Confidence">{signal.confidence ?? "-"}</Field>
        <Field label="Analysts">
          {counts ? (
            <span>
              <span className="text-signal">{counts.bullish} bullish</span>
              {" · "}
              <span className="text-warn">{counts.bearish} bearish</span>
              {" · "}
              <span className="text-muted-foreground">{counts.neutral} neutral</span>
            </span>
          ) : (
            "-"
          )}
        </Field>
      </div>

      <div className="border-t border-grid px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        as of {formatTime(signal.as_of)} · source {signal.data_source ?? "-"}
        {signal.bars != null && ` · ${signal.bars} bars`}
        {resolved?.usd_price != null && ` · token price ${formatUsd(resolved.usd_price)}`}
      </div>
      {tokenError && (
        <div className="border-t border-warn/30 px-3 py-2 font-mono text-xs text-warn">Token: {tokenError}</div>
      )}

      {analysts.length > 0 && (
        <details className="border-t border-grid">
          <summary className="cursor-pointer px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground">
            {analysts.length} analysts
          </summary>
          <div className="divide-y divide-[var(--grid)] border-t border-grid">
            {analysts.map((item, index) => (
              <div key={`${item.analyst}-${index}`} className="grid gap-1 px-3 py-2 font-mono text-xs sm:grid-cols-[11rem_6rem_1fr]">
                <div className="text-foreground">
                  {item.analyst}
                  <span className="ml-2 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                    {item.domain}
                  </span>
                </div>
                <div className={`uppercase tracking-[0.12em] ${signalTone(item.signal)}`}>
                  {item.signal} {item.confidence}
                </div>
                <div className="break-words text-muted-foreground">{item.reasoning}</div>
              </div>
            ))}
          </div>
        </details>
      )}

      {headlines.length > 0 && (
        <details className="border-t border-grid">
          <summary className="cursor-pointer px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground">
            {headlines.length} headlines
          </summary>
          <ul className="space-y-1 border-t border-grid px-3 py-2 text-xs text-muted-foreground">
            {headlines.map((headline, index) => (
              <li key={index}>{headline}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function SignalsPanel({
  agentId,
  token,
  defaultWallet,
  defaultWalletSource,
  onRun,
}: {
  agentId: string;
  token: string | null;
  defaultWallet: string | null;
  defaultWalletSource: string | null;
  onRun: () => void;
}) {
  const [override, setOverride] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [evaluation, setEvaluation] = useState<BuilderEvaluation | null>(null);

  const target = override.trim() || defaultWallet || "";

  async function check() {
    if (!token || !target) return;
    setBusy(true);
    setError(null);
    try {
      setEvaluation(await builderApi.preview(agentId, target, token));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
      onRun();
    }
  }

  const signals = evaluation?.signals ?? [];
  const notes = evaluation?.notes ?? [];
  const orders = evaluation?.orders ?? [];
  const evalWallet = evaluation?.wallet;

  return (
    <Panel title="Signals">
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            value={override}
            onChange={(event) => setOverride(event.target.value)}
            disabled={busy}
            spellCheck={false}
            placeholder={defaultWallet ?? "Solana wallet address to evaluate"}
            className={`${INPUT} min-w-0 flex-1 text-xs`}
          />
          <button
            type="button"
            onClick={() => void check()}
            disabled={busy || !token || !target}
            className={BTN_PRIMARY}
          >
            {busy ? "Checking…" : "Check signals now"}
          </button>
        </div>
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {override.trim()
            ? "Evaluating the address typed above."
            : defaultWallet
              ? `Evaluating the ${defaultWalletSource}: ${shortAddress(defaultWallet)}. Type an address to use another wallet.`
              : "No wallet address available. Connect a wallet or type an address."}
          {" "}Preview only reads data. It never builds a transaction.
        </p>
        {!token && (
          <p className="font-mono text-xs text-muted-foreground">Sign in with your wallet to check signals.</p>
        )}
        {busy && (
          <p className="animate-pulse font-mono text-xs text-muted-foreground">
            Waiting for the evaluation. This request usually takes 3 to 20 seconds.
          </p>
        )}
        {error && <Notice tone="warn">{error}</Notice>}

        {!evaluation && !busy && !error && (
          <p className="font-mono text-xs text-muted-foreground">No evaluation requested in this session yet.</p>
        )}

        {evaluation && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 border-t border-grid pt-4 sm:grid-cols-4">
              <Field label="Run id">{evaluation.run_id}</Field>
              {evalWallet && (
                <>
                  <Field label="Wallet">
                    <span title={evalWallet.address}>{shortAddress(evalWallet.address)}</span>
                  </Field>
                  <Field label={`Cash (${evalWallet.quote})`}>{formatUsd(evalWallet.cash_usd)}</Field>
                  <Field label="Spent today">{formatUsd(evalWallet.spent_today_usd)}</Field>
                </>
              )}
            </div>

            {signals.length === 0 ? (
              <p className="font-mono text-xs text-muted-foreground">The evaluation returned no signals.</p>
            ) : (
              <div className="space-y-3">
                {signals.map((signal) => (
                  <SignalRow key={signal.symbol} signal={signal} />
                ))}
              </div>
            )}

            <div>
              <div className={LABEL}>Notes</div>
              {notes.length === 0 ? (
                <p className="mt-2 font-mono text-xs text-muted-foreground">No notes returned.</p>
              ) : (
                <ul className="mt-2 list-disc space-y-1 pl-5 font-mono text-xs text-muted-foreground">
                  {notes.map((note, index) => (
                    <li key={index} className="break-words">
                      {note}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <div className={LABEL}>Orders the agent would place</div>
              {orders.length === 0 ? (
                <p className="mt-2 font-mono text-xs text-muted-foreground">
                  No orders. The agent would not trade on this evaluation.
                </p>
              ) : (
                <div className="mt-2 space-y-2">
                  {orders.map((order) => (
                    <div
                      key={order.index}
                      className="flex flex-wrap items-center gap-x-4 gap-y-1 border border-grid px-3 py-2 font-mono text-xs"
                    >
                      <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">would place</span>
                      <ActionBadge action={order.side} />
                      <span className="text-foreground">{order.token_symbol || order.symbol}</span>
                      <span className="text-foreground">{formatUsd(order.usd)}</span>
                      <span className="break-words text-muted-foreground">{order.reason}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

// ------------------------------------------------------------ aomi wallet

function AomiWalletPanel({
  agentId,
  token,
  quote,
  refreshTick,
  state,
  onState,
}: {
  agentId: string;
  token: string | null;
  quote: string;
  refreshTick: number;
  state: AomiState | null;
  onState: (state: AomiState | null) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [manualTick, setManualTick] = useState(0);

  useEffect(() => {
    if (!token) {
      onState(null);
      setError(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    builderApi
      .aomi(agentId, token, controller.signal)
      .then((data) => {
        onState(data);
        setError(null);
      })
      .catch((err) => {
        if (isAbort(err)) return;
        onState(null);
        setError(errorText(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [agentId, token, refreshTick, manualTick, onState]);

  async function createWallet() {
    if (!token) return;
    setCreating(true);
    setCreateError(null);
    try {
      onState(await builderApi.createAomiWallet(agentId, token));
    } catch (err) {
      setCreateError(errorText(err));
    } finally {
      setCreating(false);
    }
  }

  async function copy(address: string) {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const address = state?.wallet?.address;

  return (
    <Panel
      title="Agent wallet (Aomi)"
      action={
        token ? (
          <button
            type="button"
            onClick={() => setManualTick((tick) => tick + 1)}
            disabled={loading}
            className={BTN_GHOST}
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        ) : undefined
      }
    >
      <div className="space-y-3 font-mono text-xs">
        {!token && <p className="text-muted-foreground">Sign in with your wallet to see your agent wallet.</p>}
        {token && !state && !error && <p className="text-muted-foreground">Loading agent wallet…</p>}

        {error && (
          <>
            <p className="uppercase tracking-[0.14em] text-warn">Not connected</p>
            <p className="break-words text-warn">{error}</p>
          </>
        )}

        {state && (
          <>
            <p className={`uppercase tracking-[0.14em] ${state.connected ? "text-signal" : "text-warn"}`}>
              {state.connected ? "Connected" : "Not connected"}
            </p>
            {state.reason && <p className="break-words text-muted-foreground">{state.reason}</p>}
            {(state.app || state.lane) && (
              <div className="grid grid-cols-2 gap-4">
                {state.app && <Field label="Aomi app">{state.app}</Field>}
                {state.lane && <Field label="Lane">{state.lane}</Field>}
              </div>
            )}
            {state.wallet && address ? (
              <>
                <div>
                  <div className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground">Address</div>
                  <p className="mt-1 break-all text-foreground">{address}</p>
                  <button type="button" onClick={() => void copy(address)} className={`${BTN_GHOST} mt-2`}>
                    {copied ? "Copied" : "Copy address"}
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="SOL">{state.wallet.sol ?? "-"}</Field>
                  <Field label={quote}>{state.wallet.cash_usd ?? "-"}</Field>
                </div>
              </>
            ) : (
              <>
                <p className="text-muted-foreground">No agent wallet exists for this agent yet.</p>
                <button
                  type="button"
                  onClick={() => void createWallet()}
                  disabled={creating}
                  className={BTN_PRIMARY}
                >
                  {creating ? "Creating…" : "Create agent wallet"}
                </button>
              </>
            )}
          </>
        )}
        {createError && <p className="break-words text-warn">{createError}</p>}
      </div>
    </Panel>
  );
}

// ------------------------------------------------------------------- chat

type ChatLine =
  | { id: string; role: "user"; content: string }
  | { id: string; role: "agent"; content: string; events: ChatEvent[] }
  | { id: string; role: "system"; content: string };

function ChatPanel({
  agentId,
  token,
  onReply,
}: {
  agentId: string;
  token: string | null;
  onReply: () => void;
}) {
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const seq = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [lines, busy]);

  const nextId = () => `line-${(seq.current += 1)}`;

  async function send(event: FormEvent) {
    event.preventDefault();
    const message = input.trim();
    if (!message || !token) return;
    setBusy(true);
    setInput("");
    setLines((current) => [...current, { id: nextId(), role: "user", content: message }]);
    try {
      const data = await builderApi.chat(agentId, { message, session_id: sessionId }, token);
      if (data.session_id) setSessionId(data.session_id);
      setLines((current) => [
        ...current,
        { id: nextId(), role: "agent", content: data.reply ?? "", events: data.events ?? [] },
      ]);
    } catch (err) {
      const prefix = err instanceof BuilderApiError && err.status ? `HTTP ${err.status}: ` : "";
      const text = err instanceof Error ? err.message : String(err);
      setLines((current) => [...current, { id: nextId(), role: "system", content: `${prefix}${text}` }]);
    } finally {
      setBusy(false);
      onReply();
    }
  }

  return (
    <Panel
      title="Chat"
      action={
        sessionId ? (
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            session {shortAddress(sessionId)}
          </span>
        ) : undefined
      }
    >
      <div ref={listRef} className="flex max-h-[420px] flex-col gap-4 overflow-y-auto pr-1">
        {lines.length === 0 && (
          <p className="font-mono text-xs text-muted-foreground">No messages in this session yet.</p>
        )}
        {lines.map((line) => (
          <div
            key={line.id}
            className={`rounded border px-4 py-3 text-sm leading-relaxed ${
              line.role === "user"
                ? "border-grid bg-surface/60 text-foreground"
                : line.role === "system"
                  ? "border-warn/40 bg-warn/5 text-warn"
                  : "border-signal/30 bg-surface/30 text-muted-foreground"
            }`}
          >
            <div
              className={`mb-1.5 font-mono text-[10px] uppercase tracking-[0.18em] ${
                line.role === "system" ? "text-warn" : "text-signal"
              }`}
            >
              {line.role === "user" ? "You" : line.role === "system" ? "System" : "Agent"}
            </div>
            {line.role === "agent" && !line.content ? (
              <p className="font-mono text-xs">The agent returned an empty reply.</p>
            ) : (
              <p className={`whitespace-pre-wrap break-words ${line.role === "system" ? "font-mono text-xs" : ""}`}>
                {line.content}
              </p>
            )}
            {line.role === "agent" && line.events.length > 0 && (
              <div className="mt-3 space-y-2 border-t border-grid pt-3">
                {line.events.map((item, index) => (
                  <div key={index} className="font-mono text-[11px] leading-relaxed">
                    <span className="uppercase tracking-[0.14em] text-signal">{item.type}</span>
                    {item.tool && <span className="ml-2 text-foreground">{item.tool}</span>}
                    {item.summary && (
                      <p className="mt-0.5 whitespace-pre-wrap break-words text-muted-foreground">{item.summary}</p>
                    )}
                    {item.signature && (
                      <a
                        href={`https://solscan.io/tx/${item.signature}`}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-0.5 block truncate text-foreground underline"
                      >
                        {item.signature}
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="animate-pulse font-mono text-xs text-muted-foreground">Waiting for the agent…</div>}
      </div>
      <form onSubmit={send} className="mt-4 border-t border-grid pt-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            disabled={busy || !token}
            placeholder={token ? "Message the agent" : "Sign in with wallet to chat"}
            className={`${INPUT} min-w-0 flex-1`}
          />
          <button type="submit" disabled={busy || !input.trim() || !token} className={BTN_PRIMARY}>
            Send
          </button>
        </div>
      </form>
    </Panel>
  );
}

// ---------------------------------------------------------------- run log

function RunLogPanel({ agentId, refreshTick }: { agentId: string; refreshTick: number }) {
  const [runs, setRuns] = useState<BuilderRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [manualTick, setManualTick] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const load = () => {
      setLoading(true);
      builderApi
        .runs(agentId, controller.signal)
        .then((data) => {
          const sorted = [...(data.runs ?? [])].sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          );
          setRuns(sorted);
          setError(null);
          setFetchedAt(new Date());
        })
        .catch((err) => {
          if (!isAbort(err)) setError(errorText(err));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    };
    load();
    const timer = setInterval(load, RUNS_REFRESH_MS);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [agentId, refreshTick, manualTick]);

  return (
    <Panel
      title="Run log"
      action={
        <button
          type="button"
          onClick={() => setManualTick((tick) => tick + 1)}
          disabled={loading}
          className={BTN_GHOST}
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      }
    >
      <div className="space-y-3">
        {error && <Notice tone="warn">{error}</Notice>}
        {!runs && !error && <p className="font-mono text-xs text-muted-foreground">Loading runs…</p>}
        {runs && runs.length === 0 && (
          <p className="font-mono text-xs text-muted-foreground">This agent has no recorded runs.</p>
        )}
        {runs && runs.length > 0 && (
          <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
            {runs.map((run) => {
              const notes = run.decision?.notes ?? [];
              const orderCount = run.orders?.length ?? 0;
              return (
                <div key={run.id} className="border border-grid px-3 py-2 font-mono text-xs">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span className="text-foreground">{formatTime(run.created_at)}</span>
                    <span className="uppercase tracking-[0.14em] text-signal">{run.caller}</span>
                    <span className="text-muted-foreground" title={run.wallet}>
                      {shortAddress(run.wallet)}
                    </span>
                    <span className="text-muted-foreground">
                      {orderCount} {orderCount === 1 ? "order" : "orders"}
                    </span>
                    <span className="text-muted-foreground">{run.built ? "transactions built" : "not built"}</span>
                  </div>
                  {notes.length > 0 && (
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                      {notes.map((note, index) => (
                        <li key={index} className="break-words">
                          {note}
                        </li>
                      ))}
                    </ul>
                  )}
                  {run.error && <p className="mt-2 break-words text-warn">{run.error}</p>}
                </div>
              );
            })}
          </div>
        )}
        {fetchedAt && (
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Fetched {fetchedAt.toLocaleTimeString()} · refreshes every 30 s
          </p>
        )}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------- generated app

function SourcePanel({ agentId, buildStatus }: { agentId: string; buildStatus: string }) {
  const [files, setFiles] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);

  // Re-fetch when the build status changes: sources appear after the first compile.
  useEffect(() => {
    const controller = new AbortController();
    builderApi
      .source(agentId, controller.signal)
      .then((data) => {
        setFiles(data.files ?? {});
        setError(null);
      })
      .catch((err) => {
        if (isAbort(err)) return;
        setFiles(null);
        setError(errorText(err));
      });
    return () => controller.abort();
  }, [agentId, buildStatus]);

  const names = files ? Object.keys(files) : [];
  const current = active && names.includes(active) ? active : (names[0] ?? null);

  return (
    <Panel title="Generated app">
      {error && <Notice tone="warn">{error}</Notice>}
      {!files && !error && <p className="font-mono text-xs text-muted-foreground">Loading source…</p>}
      {files && names.length === 0 && (
        <p className="font-mono text-xs text-muted-foreground">The server returned no source files.</p>
      )}
      {files && current && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {names.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => setActive(name)}
                className={
                  name === current
                    ? "border border-signal px-2.5 py-1.5 font-mono text-[10px] tracking-[0.06em] text-signal"
                    : BTN_GHOST_PLAIN
                }
              >
                {name}
              </button>
            ))}
          </div>
          <pre className={`${CODE_BOX} max-h-[520px]`}>{files[current]}</pre>
        </div>
      )}
    </Panel>
  );
}
