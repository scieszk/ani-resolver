import { useEffect, useState, type DragEvent, type FormEvent, type ReactNode } from "react";
import * as Checkbox from "@radix-ui/react-checkbox";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Tooltip from "@radix-ui/react-tooltip";
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Braces,
  Check,
  ChevronRight,
  CircleUserRound,
  Database,
  FileImage,
  FileUp,
  Film,
  History,
  Image as ImageIcon,
  LoaderCircle,
  MoreHorizontal,
  Network,
  Plus,
  RefreshCw,
  ScanSearch,
  Search,
  ServerCog,
  Sparkle,
  Trash2,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";

import { ApiError, webApi } from "./api.js";
import { validateAttachments } from "./files.js";
import { providerRuns, resultItems, summarizeRun, type DisplayResultItem } from "./result-model.js";
import type {
  AniResolverApi,
  StorageStats,
  WebProvider,
  WebRun,
  WebRunTarget,
} from "./types.js";

type AppView = "resolve" | "history" | "providers";

export interface AppProps {
  api?: AniResolverApi;
}

export function App({ api = webApi }: AppProps) {
  const [runs, setRuns] = useState<WebRun[]>([]);
  const [providers, setProviders] = useState<WebProvider[]>([]);
  const [storage, setStorage] = useState<StorageStats | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<AppView>("resolve");
  const [historyQuery, setHistoryQuery] = useState("");
  const [searchedRuns, setSearchedRuns] = useState<WebRun[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([api.listRuns(), api.listProviders(), api.getStorage()])
      .then(([runList, providerList, storageStats]) => {
        if (!active) return;
        setRuns(runList.items);
        setProviders(providerList.items);
        setStorage(storageStats);
        setSelectedRunId((current) => current ?? runList.items[0]?.id ?? null);
      })
      .catch((reason) => active && setError(messageOf(reason)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [api]);

  useEffect(() => {
    const query = historyQuery.trim();
    if (!query) {
      setSearchedRuns(null);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      void api.listRuns(query)
        .then((result) => active && setSearchedRuns(result.items))
        .catch((reason) => active && setError(messageOf(reason)));
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [api, historyQuery]);

  const visibleRuns = searchedRuns ?? runs;
  const selectedRun = [...runs, ...(searchedRuns ?? [])]
    .find((run) => run.id === selectedRunId) ?? null;

  async function createRun(input: Parameters<AniResolverApi["createRun"]>[0]) {
    setBusy(true);
    setError(null);
    try {
      const created = await api.createRun(input);
      setRuns((current) => [created, ...current.filter((run) => run.id !== created.id)]);
      setSelectedRunId(created.id);
      setActiveView("resolve");
      setStorage(await api.getStorage());
    } catch (reason) {
      if (reason instanceof ApiError) {
        const payload = asRecord(reason.payload);
        const failed = asRecord(payload?.run) as WebRun | null;
        if (failed?.id) {
          setRuns((current) => [failed, ...current.filter((run) => run.id !== failed.id)]);
          setSelectedRunId(failed.id);
        }
      }
      setError(messageOf(reason));
    } finally {
      setBusy(false);
    }
  }

  async function deleteRun(id: string) {
    setError(null);
    try {
      await api.deleteRun(id);
      setRuns((current) => {
        const next = current.filter((run) => run.id !== id);
        if (selectedRunId === id) setSelectedRunId(next[0]?.id ?? null);
        return next;
      });
      setSearchedRuns((current) => current?.filter((run) => run.id !== id) ?? null);
      setStorage(await api.getStorage());
    } catch (reason) {
      setError(messageOf(reason));
    }
  }

  async function cleanupStorage() {
    setError(null);
    try {
      setStorage(await api.cleanupStorage());
      const refreshed = await api.listRuns();
      setRuns(refreshed.items);
      if (historyQuery.trim()) {
        setSearchedRuns((await api.listRuns(historyQuery.trim())).items);
      }
    } catch (reason) {
      setError(messageOf(reason));
    }
  }

  const readyProviders = providers.filter((provider) => provider.status === "ready").length;

  return (
    <Tooltip.Provider delayDuration={350}>
      <div className="app-shell">
        <header className="topbar glass">
          <button className="brand" type="button" onClick={() => setActiveView("resolve")}>
            <span className="brand-mark"><ScanSearch size={19} /></span>
            <span className="brand-copy">
              <strong>ani-resolver</strong>
              <small>local index</small>
            </span>
          </button>
          <div className="topbar-actions">
            <span className="service-state"><i /> {readyProviders}/{providers.length || "-"} providers</span>
            {storage && <span className="storage-state">{formatBytes(storage.bytesUsed)} / {formatBytes(storage.maxBytes)}</span>}
            <IconButton label="Providers" onClick={() => setActiveView("providers")}>
              <ServerCog size={18} />
            </IconButton>
          </div>
        </header>

        <div className="workspace">
          <aside className="history-pane glass desktop-history">
            <HistoryList
              runs={visibleRuns}
              selectedRunId={selectedRunId}
              query={historyQuery}
              onQuery={setHistoryQuery}
              onSelect={(id) => {
                setSelectedRunId(id);
                setActiveView("resolve");
              }}
              onDelete={deleteRun}
            />
          </aside>

          <main className={`page resolve-page ${activeView === "resolve" ? "is-active" : ""}`}>
            <Composer providers={providers} busy={busy} onSubmit={createRun} />
            {error && <ErrorBanner message={error} onClose={() => setError(null)} />}
            <RunDetail run={selectedRun} loading={loading} />
          </main>

          <section className={`page mobile-history-page ${activeView === "history" ? "is-active" : ""}`}>
            <HistoryList
              runs={visibleRuns}
              selectedRunId={selectedRunId}
              query={historyQuery}
              onQuery={setHistoryQuery}
              onSelect={(id) => {
                setSelectedRunId(id);
                setActiveView("resolve");
              }}
              onDelete={deleteRun}
            />
          </section>

          <section className={`page providers-page ${activeView === "providers" ? "is-active" : ""}`}>
            <ProvidersView
              providers={providers}
              storage={storage}
              onBack={() => setActiveView("resolve")}
              onCleanup={cleanupStorage}
            />
          </section>
        </div>

        <nav className="mobile-nav glass" aria-label="Primary">
          <MobileNavButton active={activeView === "resolve"} label="Resolve" onClick={() => setActiveView("resolve")}>
            <ScanSearch size={20} />
          </MobileNavButton>
          <MobileNavButton active={activeView === "history"} label="History" onClick={() => setActiveView("history")}>
            <History size={20} />
          </MobileNavButton>
          <MobileNavButton active={activeView === "providers"} label="Providers" onClick={() => setActiveView("providers")}>
            <Network size={20} />
          </MobileNavButton>
        </nav>
      </div>
    </Tooltip.Provider>
  );
}

function Composer({
  providers,
  busy,
  onSubmit,
}: {
  providers: WebProvider[];
  busy: boolean;
  onSubmit: (input: Parameters<AniResolverApi["createRun"]>[0]) => Promise<void>;
}) {
  const [input, setInput] = useState("");
  const [target, setTarget] = useState<WebRunTarget>("auto");
  const [selectedProviders, setSelectedProviders] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!input.trim() && attachments.length === 0) {
      setFileError("Add text, an image, or a torrent");
      return;
    }
    await onSubmit({
      input: input.trim(),
      target,
      providers: selectedProviders.length ? selectedProviders : ["all"],
      attachments,
    });
    setInput("");
    setAttachments([]);
    setFileError(null);
  }

  function addFiles(files: File[]) {
    const next = validateAttachments([...attachments, ...files]);
    setAttachments(next.accepted);
    setFileError(next.rejected.map((item) => `${item.name}: ${item.reason}`).join(" · ") || null);
  }

  function drop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    addFiles([...event.dataTransfer.files]);
  }

  return (
    <form className="composer glass" onSubmit={submit}>
      <div className="composer-topline">
        <div className="target-control" aria-label="Resolution target">
          {(["auto", "work", "character", "image"] as const).map((value) => (
            <button
              type="button"
              key={value}
              className={target === value ? "is-selected" : ""}
              aria-pressed={target === value}
              onClick={() => setTarget(value)}
            >
              {targetIcon(value)}
              <span>{capitalize(value)}</span>
            </button>
          ))}
        </div>
        <ProviderSelector
          providers={providers}
          selected={selectedProviders}
          onChange={setSelectedProviders}
        />
      </div>

      <textarea
        aria-label="Resolution input"
        value={input}
        onChange={(event) => setInput(event.target.value)}
        placeholder="Title, release name, path, magnet, or descriptive clues"
        rows={3}
      />

      {attachments.length > 0 && (
        <div className="attachment-row">
          {attachments.map((file, index) => (
            <span className="attachment-chip" key={`${file.name}-${file.size}-${index}`}>
              {file.type.startsWith("image/") ? <FileImage size={15} /> : <Archive size={15} />}
              <span>{file.name}</span>
              <button type="button" aria-label={`Remove ${file.name}`} onClick={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                <X size={14} />
              </button>
            </span>
          ))}
        </div>
      )}

      {fileError && <p className="field-error">{fileError}</p>}
      <div className="composer-actions">
        <label className="file-button" onDragOver={(event) => event.preventDefault()} onDrop={drop}>
          <FileUp size={17} />
          <span>Add files</span>
          <input
            type="file"
            multiple
            accept="image/jpeg,image/png,.torrent,application/x-bittorrent"
            onChange={(event) => addFiles([...(event.target.files ?? [])])}
          />
        </label>
        <button className="resolve-button" type="submit" disabled={busy}>
          {busy ? <LoaderCircle className="spin" size={18} /> : <Sparkle size={17} />}
          <span>{busy ? "Resolving" : "Resolve"}</span>
          {!busy && <ArrowRight size={17} />}
        </button>
      </div>
    </form>
  );
}

function ProviderSelector({
  providers,
  selected,
  onChange,
}: {
  providers: WebProvider[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button className="provider-trigger" type="button">
          <Network size={16} />
          <span>{selected.length ? `${selected.length} selected` : "Compatible providers"}</span>
          <ChevronRight size={15} />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content glass">
          <div className="dialog-heading">
            <div>
              <Dialog.Title>Providers</Dialog.Title>
              <Dialog.Description>Selection applies to this run.</Dialog.Description>
            </div>
            <Dialog.Close asChild><button className="icon-button" aria-label="Close"><X size={18} /></button></Dialog.Close>
          </div>
          <button className={`provider-choice ${selected.length === 0 ? "is-selected" : ""}`} type="button" onClick={() => onChange([])}>
            <span className="provider-symbol"><Sparkle size={17} /></span>
            <span><strong>All compatible</strong><small>Filtered by target capability</small></span>
            {selected.length === 0 && <Check size={18} />}
          </button>
          <div className="provider-choice-list">
            {providers.map((provider) => {
              const checked = selected.includes(provider.id);
              return (
                <label className={`provider-choice ${checked ? "is-selected" : ""}`} key={provider.id}>
                  <Checkbox.Root
                    className="checkbox-root"
                    checked={checked}
                    disabled={provider.status !== "ready"}
                    onCheckedChange={(value) => onChange(value === true ? [...selected, provider.id] : selected.filter((id) => id !== provider.id))}
                  >
                    <Checkbox.Indicator><Check size={14} /></Checkbox.Indicator>
                  </Checkbox.Root>
                  <span><strong>{provider.label}</strong><small>{provider.capabilities.map(shortCapability).join(" · ")}</small></span>
                  <i className={`status-dot ${provider.status}`} />
                </label>
              );
            })}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function HistoryList({
  runs,
  selectedRunId,
  query,
  onQuery,
  onSelect,
  onDelete,
}: {
  runs: WebRun[];
  selectedRunId: string | null;
  query: string;
  onQuery: (value: string) => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="history-content">
      <div className="pane-heading">
        <div><span className="eyebrow">RUNS</span><strong>History</strong></div>
        <span className="run-count">{runs.length}</span>
      </div>
      <label className="search-field">
        <Search size={16} />
        <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Search input or output" aria-label="Search history" />
        {query && <button type="button" aria-label="Clear search" onClick={() => onQuery("")}><X size={14} /></button>}
      </label>
      <div className="run-list">
        {runs.map((run) => {
          const summary = summarizeRun(run);
          return (
            <article className={`run-card ${run.id === selectedRunId ? "is-selected" : ""}`} key={run.id}>
              <button className="run-card-main" type="button" onClick={() => onSelect(run.id)}>
                <span className={`run-type type-${run.resolvedTarget}`}>{entityIcon(summary.entityType, 16)}</span>
                <span className="run-flow">
                  <span className="run-input">{summary.input}</span>
                  <span className="flow-arrow"><ArrowRight size={12} /></span>
                  <strong className="run-output">{summary.output}</strong>
                  <small>{capitalize(summary.entityType)}{summary.confidence !== undefined ? ` · ${percent(summary.confidence)}` : ""}</small>
                </span>
              </button>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild><button className="run-menu" aria-label={`Actions for ${summary.input}`}><MoreHorizontal size={16} /></button></DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content className="menu-content" sideOffset={5}>
                    <DropdownMenu.Item className="menu-item danger" onSelect={() => void onDelete(run.id)}><Trash2 size={15} /> Delete run</DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </article>
          );
        })}
        {runs.length === 0 && <div className="history-empty"><History size={22} /><span>No runs yet</span></div>}
      </div>
    </div>
  );
}

function RunDetail({ run, loading }: { run: WebRun | null; loading: boolean }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  useEffect(() => setSelectedIndex(0), [run?.id]);
  if (loading) return <div className="detail-state"><LoaderCircle className="spin" /><span>Loading runs</span></div>;
  if (!run) return <EmptyState />;
  if (run.status === "failed") {
    return <div className="detail-state error-state"><X size={24} /><strong>Resolution failed</strong><span>{run.error}</span></div>;
  }
  if (run.status === "pending") return <div className="detail-state"><LoaderCircle className="spin" /><span>Resolving</span></div>;
  const items = resultItems(run.result);
  const selected = items[selectedIndex] ?? items[0];
  if (!selected) return <div className="detail-state"><Search size={24} /><strong>No matches</strong><span>{run.input}</span></div>;
  const evidence = providerRuns(run.result);

  return (
    <section className="result-section">
      <div className="result-toolbar">
        <div className="result-run-label"><span>{formatDate(run.createdAt)}</span><ChevronRight size={13} /><strong>{capitalize(run.resolvedTarget)}</strong></div>
        <RawResultDialog run={run} />
      </div>
      <div className="result-stage glass">
        <div className="result-copy">
          <div className="result-kicker">
            <span className={`entity-badge type-${run.resolvedTarget}`}>{selected.entityType.toUpperCase()}</span>
            {selected.confidence !== undefined && <span className="confidence"><i style={{ "--confidence": selected.confidence } as React.CSSProperties} />{percent(selected.confidence)}</span>}
          </div>
          <h1>{selected.title}</h1>
          {selected.alternateNames.length > 0 && <p className="alternate-names">{selected.alternateNames.slice(0, 3).join(" · ")}</p>}
          {selected.meta.length > 0 && <div className="meta-line">{selected.meta.map((item) => <span key={item}>{item}</span>)}</div>}
          {selected.description && <p className="result-description">{selected.description}</p>}
          {selected.externalIds.length > 0 && (
            <div className="external-ids">
              {selected.externalIds.map((id) => <CopyId key={`${id.source}-${id.id}`} source={id.source} id={id.id} />)}
            </div>
          )}
          {selected.facts.length > 0 && (
            <dl className="fact-grid">
              {selected.facts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
            </dl>
          )}
        </div>
        <ResultImage item={selected} />
      </div>

      {items.length > 1 && (
        <div className="candidate-strip" aria-label="Ranked candidates">
          {items.slice(0, 6).map((item, index) => (
            <button className={index === selectedIndex ? "is-selected" : ""} type="button" key={`${item.title}-${index}`} onClick={() => setSelectedIndex(index)}>
              <span className="candidate-rank">{String(index + 1).padStart(2, "0")}</span>
              <span><strong>{item.title}</strong><small>{capitalize(item.entityType)}</small></span>
              {item.confidence !== undefined && <b>{percent(item.confidence)}</b>}
            </button>
          ))}
        </div>
      )}

      <div className="evidence-band">
        <div className="evidence-heading"><Network size={16} /><span>Provider runs</span></div>
        <div className="evidence-runs">
          {evidence.map((item, index) => {
            const status = String(item.status ?? "unknown");
            return (
              <span className={`evidence-item status-${status}`} key={`${String(item.provider)}-${index}`}>
                <i /> <strong>{String(item.provider)}</strong>
                <small>{status}{typeof item.elapsedMs === "number" ? ` · ${item.elapsedMs}ms` : ""}</small>
              </span>
            );
          })}
          {evidence.length === 0 && <span className="muted">No provider trace</span>}
        </div>
      </div>
    </section>
  );
}

function ResultImage({ item }: { item: DisplayResultItem }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [item.image]);
  return (
    <div className={`result-media ${!item.image || failed ? "is-fallback" : ""}`}>
      {item.image && !failed ? <img src={item.image} alt="" onError={() => setFailed(true)} /> : <span>{entityIcon(item.entityType, 42)}<small>{capitalize(item.entityType)}</small></span>}
    </div>
  );
}

function RawResultDialog({ run }: { run: WebRun }) {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild><button className="raw-button" type="button"><Braces size={16} /><span>JSON</span></button></Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content raw-dialog glass">
          <div className="dialog-heading"><Dialog.Title>Run JSON</Dialog.Title><Dialog.Close asChild><button className="icon-button" aria-label="Close"><X size={18} /></button></Dialog.Close></div>
          <pre>{JSON.stringify(run, null, 2)}</pre>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ProvidersView({
  providers,
  storage,
  onBack,
  onCleanup,
}: {
  providers: WebProvider[];
  storage: StorageStats | null;
  onBack: () => void;
  onCleanup: () => void;
}) {
  const used = storage ? Math.min(1, storage.bytesUsed / storage.maxBytes) : 0;
  return (
    <div className="providers-view">
      <div className="view-heading">
        <button className="icon-button" type="button" aria-label="Back to resolver" onClick={onBack}><ArrowLeft size={19} /></button>
        <div><span className="eyebrow">LOCAL RUNTIME</span><h1>Providers</h1></div>
      </div>
      {storage && (
        <section className="storage-panel glass">
          <div><Database size={19} /><span><strong>{formatBytes(storage.bytesUsed)}</strong><small>{storage.runs} runs · {storage.storedAttachments} stored files</small></span></div>
          <div className="storage-meter"><i style={{ width: `${used * 100}%` }} /></div>
          <button type="button" onClick={onCleanup}><RefreshCw size={16} /> Clean up</button>
        </section>
      )}
      <div className="provider-grid">
        {providers.map((provider) => (
          <article className="provider-card glass" key={provider.id}>
            <div className="provider-card-head">
              <span className="provider-symbol"><Network size={18} /></span>
              <div><h2>{provider.label}</h2><p>{provider.id}</p></div>
              <span className={`provider-status ${provider.status}`}><i /> {provider.status.replace("_", " ")}</span>
            </div>
            <div className="provider-meta"><span>{provider.auth === "none" ? "No auth" : `${capitalize(provider.auth)} auth`}</span><span>{provider.distribution}</span><span>{provider.languages.join(" · ")}</span></div>
            <div className="capability-list">{provider.capabilities.map((capability) => <span key={capability}>{shortCapability(capability)}</span>)}</div>
            <p className="provider-strength">{provider.strengths.join(" · ")}</p>
          </article>
        ))}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="empty-state">
      <div className="empty-art" aria-hidden="true">
        <span className="shelf shelf-one"><BookOpen /><Film /><ImageIcon /></span>
        <span className="shelf shelf-two"><UsersRound /><Archive /><CircleUserRound /></span>
        <ScanSearch className="empty-lens" />
      </div>
      <strong>Ready for a new run</strong>
      <span>Text, image, or torrent</span>
    </div>
  );
}

function ErrorBanner({ message, onClose }: { message: string; onClose: () => void }) {
  return <div className="error-banner"><span>{message}</span><button type="button" aria-label="Dismiss error" onClick={onClose}><X size={16} /></button></div>;
}

function CopyId({ source, id }: { source: string; id: string }) {
  const [copied, setCopied] = useState(false);
  return <button type="button" onClick={() => { void navigator.clipboard?.writeText(`${source}:${id}`); setCopied(true); setTimeout(() => setCopied(false), 900); }}><small>{source}</small><strong>{id}</strong>{copied ? <Check size={13} /> : <Plus size={13} />}</button>;
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return <Tooltip.Root><Tooltip.Trigger asChild><button className="icon-button" type="button" aria-label={label} onClick={onClick}>{children}</button></Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="tooltip-content" sideOffset={6}>{label}</Tooltip.Content></Tooltip.Portal></Tooltip.Root>;
}

function MobileNavButton({ active, label, onClick, children }: { active: boolean; label: string; onClick: () => void; children: ReactNode }) {
  return <button type="button" className={active ? "is-active" : ""} onClick={onClick}>{children}<span>{label}</span></button>;
}

function targetIcon(target: WebRunTarget) {
  if (target === "work") return <Film size={15} />;
  if (target === "character") return <UserRound size={15} />;
  if (target === "image") return <ImageIcon size={15} />;
  return <Sparkle size={15} />;
}

function entityIcon(type: string, size: number) {
  if (type === "work" || type.includes("scene")) return <Film size={size} />;
  if (type === "character") return <UserRound size={size} />;
  if (type === "person") return <CircleUserRound size={size} />;
  if (type === "organization") return <UsersRound size={size} />;
  return <BookOpen size={size} />;
}

function shortCapability(value: string) {
  return value.replace(/_/gu, " ").replace(/(?:search|lookup)$/u, "").trim();
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function capitalize(value: string) {
  return value ? value[0]!.toUpperCase() + value.slice(1).replace(/_/gu, " ") : value;
}

function messageOf(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
