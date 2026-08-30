import {
  useEffect,
  useMemo,
  useState,
  type DragEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Bookmark,
  BookmarkCheck,
  Braces,
  Check,
  CircleUserRound,
  Database,
  FileImage,
  FileUp,
  Film,
  History,
  Image as ImageIcon,
  LibraryBig,
  ListFilter,
  LoaderCircle,
  Network,
  Plus,
  RefreshCw,
  ScanSearch,
  Search,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";

import { ApiError, webApi } from "./api.js";
import { validateAttachments } from "./files.js";
import {
  resultItems,
  summarizeRun,
  type DisplayResultItem,
} from "./result-model.js";
import type {
  AniResolverApi,
  CreateWebRunInput,
  StorageStats,
  WebCharacterAppearance,
  WebExternalId,
  WebFavorite,
  WebFavoriteDetail,
  WebProvider,
  WebRelatedEntity,
  WebResolvedTarget,
  WebRun,
} from "./types.js";
import {
  Button,
  Checkbox,
  Chip,
  Dialog,
  EdgeSurface,
  IconButton,
  MobileDock,
  NavItem,
  SegmentedControl,
  SelectField,
  TextArea,
  TextField,
  Tooltip,
} from "./ui.js";

type AppView = "library" | "identify" | "activity" | "settings" | "entity";
type LibraryFilter = "all" | "work" | "character" | "person";
type AppearanceField = keyof WebCharacterAppearance;

const DEFAULT_BACKGROUND = "/archive-room.png";

const APPEARANCE_GROUPS: Array<{
  field: AppearanceField;
  label: string;
  values: Array<{ value: string; label: string; color?: string }>;
}> = [
  {
    field: "hairColors",
    label: "Hair color",
    values: colorValues(["white", "silver", "black", "blond", "brown", "red", "blue", "green", "purple", "pink", "orange"]),
  },
  {
    field: "eyeColors",
    label: "Eye color",
    values: colorValues(["black", "brown", "red", "blue", "green", "purple", "yellow", "pink", "silver"]),
  },
  {
    field: "hairStyles",
    label: "Hair style",
    values: namedValues(["twintails", "ponytail", "long_hair", "short_hair", "braids", "hair_bun"]),
  },
  {
    field: "genders",
    label: "Gender",
    values: namedValues(["female", "male", "nonbinary"]),
  },
  {
    field: "apparentAges",
    label: "Apparent age",
    values: namedValues(["child", "teen", "adult", "senior", "ageless"]),
  },
  {
    field: "clothing",
    label: "Clothing",
    values: namedValues(["school_uniform", "maid", "armor", "military_uniform", "kimono", "glasses"]),
  },
  {
    field: "traits",
    label: "Trait",
    values: namedValues(["expressionless"]),
  },
];

export interface AppProps {
  api?: AniResolverApi;
}

export function App({ api = webApi }: AppProps) {
  const [activeView, setActiveView] = useState<AppView>("library");
  const [runs, setRuns] = useState<WebRun[]>([]);
  const [favorites, setFavorites] = useState<WebFavorite[]>([]);
  const [providers, setProviders] = useState<WebProvider[]>([]);
  const [storage, setStorage] = useState<StorageStats | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedFavoriteId, setSelectedFavoriteId] = useState<string | null>(null);
  const [favoriteDetails, setFavoriteDetails] = useState<Map<string, WebFavoriteDetail>>(new Map());
  const [detailLoading, setDetailLoading] = useState<string | null>(null);
  const [historyQuery, setHistoryQuery] = useState("");
  const [favoriteQuery, setFavoriteQuery] = useState("");
  const [searchedRuns, setSearchedRuns] = useState<WebRun[] | null>(null);
  const [searchedFavorites, setSearchedFavorites] = useState<WebFavorite[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([api.listRuns(), api.listFavorites(), api.listProviders(), api.getStorage()])
      .then(([runList, favoriteList, providerList, storageStats]) => {
        if (!active) return;
        setRuns(runList.items);
        setFavorites(favoriteList.items);
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
    }, 240);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [api, historyQuery]);

  useEffect(() => {
    const query = favoriteQuery.trim();
    if (!query) {
      setSearchedFavorites(null);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      void api.listFavorites(query)
        .then((result) => active && setSearchedFavorites(result.items))
        .catch((reason) => active && setError(messageOf(reason)));
    }, 240);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [api, favoriteQuery]);

  const visibleRuns = searchedRuns ?? runs;
  const visibleFavorites = searchedFavorites ?? favorites;
  const selectedRun = [...runs, ...(searchedRuns ?? [])].find((run) => run.id === selectedRunId) ?? null;
  const selectedFavorite = [...favorites, ...(searchedFavorites ?? [])]
    .find((favorite) => favorite.id === selectedFavoriteId) ?? null;
  const selectedDetail = selectedFavoriteId ? favoriteDetails.get(selectedFavoriteId) ?? null : null;
  const favoriteKeys = useMemo(
    () => new Map(favorites.map((favorite) => [favorite.entityKey, favorite])),
    [favorites],
  );

  async function openFavorite(favorite: WebFavorite, refresh = false) {
    setSelectedFavoriteId(favorite.id);
    setActiveView("entity");
    if (!refresh && favoriteDetails.has(favorite.id)) return;
    setDetailLoading(favorite.id);
    setError(null);
    try {
      const detail = await api.getFavorite(favorite.id);
      if (!detail) throw new Error("This library entry no longer exists");
      setFavoriteDetails((current) => new Map(current).set(favorite.id, detail));
      setFavorites((current) => current.map((item) => item.id === favorite.id ? detail.favorite : item));
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setDetailLoading((current) => current === favorite.id ? null : current);
    }
  }

  async function createRun(input: CreateWebRunInput) {
    setBusy(true);
    setError(null);
    try {
      const created = await api.createRun(input);
      setRuns((current) => [created, ...current.filter((run) => run.id !== created.id)]);
      setSelectedRunId(created.id);
      setActiveView("identify");
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
      setRuns((current) => current.filter((run) => run.id !== id));
      setSearchedRuns((current) => current?.filter((run) => run.id !== id) ?? null);
      if (selectedRunId === id) setSelectedRunId(runs.find((run) => run.id !== id)?.id ?? null);
      setFavorites((current) => current.map((favorite) => {
        if (favorite.sourceRunId !== id) return favorite;
        const { sourceRunId: _sourceRunId, ...retained } = favorite;
        return retained;
      }));
      setStorage(await api.getStorage());
    } catch (reason) {
      setError(messageOf(reason));
    }
  }

  async function toggleFavorite(runId: string | undefined, item: DisplayResultItem) {
    setError(null);
    const existing = favoriteKeys.get(item.key);
    try {
      if (existing) {
        await removeFavorite(existing.id);
        return;
      }
      if (!runId) throw new Error("This result has no source run");
      const saved = await api.saveFavorite(runId, item.key);
      setFavorites((current) => [saved, ...current.filter((favorite) => favorite.id !== saved.id)]);
    } catch (reason) {
      setError(messageOf(reason));
    }
  }

  async function removeFavorite(id: string) {
    await api.deleteFavorite(id);
    setFavorites((current) => current.filter((favorite) => favorite.id !== id));
    setSearchedFavorites((current) => current?.filter((favorite) => favorite.id !== id) ?? null);
    setFavoriteDetails((current) => {
      const next = new Map(current);
      next.delete(id);
      return next;
    });
    if (selectedFavoriteId === id) {
      setSelectedFavoriteId(null);
      setActiveView("library");
    }
  }

  async function cleanupStorage() {
    setError(null);
    try {
      setStorage(await api.cleanupStorage());
      setRuns((await api.listRuns()).items);
      setFavorites((await api.listFavorites()).items);
    } catch (reason) {
      setError(messageOf(reason));
    }
  }

  const navView = activeView === "entity" ? "library" : activeView;

  return (
    <div className="app-shell">
      <div className="app-backdrop" aria-hidden="true" />
      <EdgeSurface className="side-navigation" role="navigation" aria-label="Primary navigation">
        <NavItem active={navView === "library"} icon={<LibraryBig size={21} />} label="Library" onClick={() => setActiveView("library")} />
        <NavItem active={navView === "identify"} icon={<ScanSearch size={21} />} label="Identify" onClick={() => setActiveView("identify")} />
        <NavItem active={navView === "activity"} icon={<History size={21} />} label="Activity" onClick={() => setActiveView("activity")} />
        <span className="nav-spacer" />
        <NavItem active={navView === "settings"} icon={<Settings2 size={21} />} label="Settings" onClick={() => setActiveView("settings")} />
      </EdgeSurface>

      <main className="app-main">
        {error && <ErrorBanner message={error} onClose={() => setError(null)} />}
        {activeView === "library" && (
          <LibraryView
            favorites={visibleFavorites}
            query={favoriteQuery}
            loading={loading}
            onQuery={setFavoriteQuery}
            onOpen={openFavorite}
            onRemove={(id) => void removeFavorite(id).catch((reason) => setError(messageOf(reason)))}
            onIdentify={() => setActiveView("identify")}
          />
        )}
        {activeView === "entity" && (
          <EntityView
            favorite={selectedFavorite}
            detail={selectedDetail}
            loading={detailLoading === selectedFavoriteId}
            onBack={() => setActiveView("library")}
            onRemove={(id) => void removeFavorite(id).catch((reason) => setError(messageOf(reason)))}
            onRetry={() => selectedFavorite && void openFavorite(selectedFavorite, true)}
          />
        )}
        {activeView === "identify" && (
          <IdentifyView
            providers={providers}
            busy={busy}
            run={selectedRun}
            favoriteKeys={favoriteKeys}
            onSubmit={createRun}
            onToggleFavorite={toggleFavorite}
          />
        )}
        {activeView === "activity" && (
          <ActivityView
            runs={visibleRuns}
            query={historyQuery}
            loading={loading}
            onQuery={setHistoryQuery}
            onOpen={(run) => {
              setSelectedRunId(run.id);
              setActiveView("identify");
            }}
            onDelete={(id) => void deleteRun(id)}
          />
        )}
        {activeView === "settings" && (
          <SettingsView providers={providers} storage={storage} onCleanup={cleanupStorage} />
        )}
      </main>

      <MobileDock label="Primary navigation">
        <NavItem active={navView === "library"} icon={<LibraryBig size={20} />} label="Library" onClick={() => setActiveView("library")} />
        <NavItem active={navView === "identify"} icon={<ScanSearch size={20} />} label="Identify" onClick={() => setActiveView("identify")} />
        <NavItem active={navView === "activity"} icon={<History size={20} />} label="Activity" onClick={() => setActiveView("activity")} />
        <NavItem active={navView === "settings"} icon={<Settings2 size={20} />} label="Settings" onClick={() => setActiveView("settings")} />
      </MobileDock>
    </div>
  );
}

function LibraryView({
  favorites,
  query,
  loading,
  onQuery,
  onOpen,
  onRemove,
  onIdentify,
}: {
  favorites: WebFavorite[];
  query: string;
  loading: boolean;
  onQuery: (value: string) => void;
  onOpen: (favorite: WebFavorite) => void;
  onRemove: (id: string) => void;
  onIdentify: () => void;
}) {
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const visible = favorites.filter((favorite) => filter === "all" || favorite.entityType === filter);
  return (
    <div className="library-page page-frame">
      <header className="page-heading library-heading">
        <div><span className="section-label">PERSONAL ENCYCLOPEDIA</span><h1>Library</h1></div>
        <Button variant="primary" iconBefore={<Plus size={17} />} onClick={onIdentify}>Add entry</Button>
      </header>

      <div className="library-tools">
        <label className="search-box">
          <Search size={18} />
          <input value={query} onChange={(event) => onQuery(event.target.value)} aria-label="Search library" placeholder="Search your library" />
          {query && <button type="button" aria-label="Clear library search" onClick={() => onQuery("")}><X size={15} /></button>}
        </label>
        <SegmentedControl
          className="library-filter"
          label="Library type"
          value={filter}
          onValueChange={(value) => setFilter(value as LibraryFilter)}
          options={[
            { value: "all", label: "All", icon: <ListFilter size={15} /> },
            { value: "work", label: "Works", icon: <Film size={15} /> },
            { value: "character", label: "Characters", icon: <UserRound size={15} /> },
            { value: "person", label: "People", icon: <CircleUserRound size={15} /> },
          ]}
        />
      </div>

      {loading ? (
        <PageState icon={<LoaderCircle className="spin" />} label="Loading library" />
      ) : visible.length ? (
        <section className="library-grid" aria-label="Saved entries">
          {visible.map((favorite) => (
            <article className={`library-entry type-${favorite.entityType}`} key={favorite.id}>
              <button type="button" className="entry-open" aria-label={`Open ${favorite.title}`} onClick={() => onOpen(favorite)}>
                <EntryImage image={favorite.image} entityType={favorite.entityType} title={favorite.title} />
                <span className="entry-copy">
                  <small>{capitalize(favorite.entityType)}</small>
                  <strong>{favorite.title}</strong>
                  <span>{candidateSubtitle(favorite.candidate) ?? formatDate(favorite.createdAt)}</span>
                </span>
              </button>
              <Tooltip content="Remove from library">
                <IconButton label={`Remove ${favorite.title} from library`} size="sm" onClick={() => onRemove(favorite.id)}><BookmarkCheck size={16} /></IconButton>
              </Tooltip>
            </article>
          ))}
        </section>
      ) : (
        <section className="library-empty-state">
          <img src={DEFAULT_BACKGROUND} alt="" />
          <div><BookOpen size={24} /><h2>{query || filter !== "all" ? "No matching entries" : "Your library is ready"}</h2>
            {!query && filter === "all" && <Button variant="primary" iconBefore={<ScanSearch size={17} />} onClick={onIdentify}>Identify something</Button>}
          </div>
        </section>
      )}
    </div>
  );
}

function EntityView({
  favorite,
  detail,
  loading,
  onBack,
  onRemove,
  onRetry,
}: {
  favorite: WebFavorite | null;
  detail: WebFavoriteDetail | null;
  loading: boolean;
  onBack: () => void;
  onRemove: (id: string) => void;
  onRetry: () => void;
}) {
  if (!favorite) return <PageState icon={<BookOpen />} label="Entry not found" />;
  const confirmed = resultItems({ items: [favorite.candidate] })[0];
  if (!confirmed) return <PageState icon={<BookOpen />} label="This entry has no readable metadata" />;
  const context = detail?.context;
  const incompleteRuns = context?.providerRuns.filter((run) => (
    (run.status === "ok" && Boolean(run.message))
    || !["ok", "empty", "unsupported"].includes(run.status)
  )) ?? [];
  const relationCount = context
    ? context.works.length + context.characters.length + context.people.length
    : 0;
  return (
    <article className="entity-page page-frame">
      <div className="entity-toolbar">
        <Button variant="quiet" size="sm" iconBefore={<ArrowLeft size={17} />} onClick={onBack}>Library</Button>
        <Tooltip content="Remove from library">
          <IconButton label={`Remove ${favorite.title} from library`} onClick={() => onRemove(favorite.id)}><Trash2 size={17} /></IconButton>
        </Tooltip>
      </div>

      <header className="entity-header">
        <EntryImage image={confirmed.image ?? favorite.image} entityType={confirmed.entityType} title={confirmed.title} large />
        <div className="entity-intro">
          <span className="confirmed-label"><Check size={14} /> Confirmed {capitalize(confirmed.entityType)}</span>
          <h1>{confirmed.title}</h1>
          {confirmed.alternateNames.length > 0 && <p className="entity-aliases">{confirmed.alternateNames.slice(0, 5).join(" / ")}</p>}
          {confirmed.meta.length > 0 && <div className="entity-meta">{confirmed.meta.map((item) => <span key={item}>{item}</span>)}</div>}
          {confirmed.description && <p className="entity-description">{confirmed.description}</p>}
          {confirmed.externalIds.length > 0 && <div className="external-ids">{confirmed.externalIds.map((id) => <CopyId key={`${id.source}-${id.id}`} source={id.source} id={id.id} />)}</div>}
        </div>
      </header>

      {confirmed.facts.length > 0 && (
        <dl className="entity-facts">
          {confirmed.facts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
        </dl>
      )}

      {loading && <PageState compact icon={<LoaderCircle className="spin" />} label="Loading related entries" />}
      {!loading && context && (
        <div className="relation-sections">
          {incompleteRuns.length > 0 && (
            <div className="relation-warning" role="status">
              <Network size={18} />
              <div><strong>Related entries may be incomplete.</strong><span>One or more configured sources could not return all relationship data.</span></div>
              <Button type="button" size="sm" variant="quiet" iconBefore={<RefreshCw size={15} />} onClick={onRetry}>Retry related entries</Button>
            </div>
          )}
          <RelationSection title="Appears in" icon={<Film size={18} />} items={context.works} />
          <RelationSection title="Related characters" icon={<UsersRound size={18} />} items={context.characters} />
          <RelationSection title="People" icon={<CircleUserRound size={18} />} items={context.people} />
          {relationCount === 0 && incompleteRuns.length === 0 && (
            <div className="relation-empty"><Network size={19} /><span>No relationships are available from the configured sources.</span></div>
          )}
        </div>
      )}
    </article>
  );
}

function RelationSection({ title, icon, items }: { title: string; icon: ReactNode; items: WebRelatedEntity[] }) {
  if (!items.length) return null;
  return (
    <section className="relation-section">
      <div className="relation-heading">{icon}<h2>{title}</h2><span>{items.length}</span></div>
      <div className="relation-grid">
        {items.map((item) => (
          <article className={`relation-entry relation-${item.entityType}`} key={relatedKey(item)}>
            <EntryImage image={item.image} entityType={item.entityType} title={item.names[0] ?? item.providerId} />
            <div><small>{item.relation ?? capitalize(item.entityType)}</small><strong>{item.names[0] ?? item.providerId}</strong>
              <span>{[item.year, item.mediaKind?.toUpperCase(), item.names[1]].filter(Boolean).join(" / ")}</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function IdentifyView({
  providers,
  busy,
  run,
  favoriteKeys,
  onSubmit,
  onToggleFavorite,
}: {
  providers: WebProvider[];
  busy: boolean;
  run: WebRun | null;
  favoriteKeys: Map<string, WebFavorite>;
  onSubmit: (input: CreateWebRunInput) => Promise<void>;
  onToggleFavorite: (runId: string | undefined, item: DisplayResultItem) => void;
}) {
  return (
    <div className="identify-page page-frame">
      <header className="page-heading"><div><span className="section-label">ADD TO LIBRARY</span><h1>Identify</h1></div></header>
      <Composer providers={providers} busy={busy} onSubmit={onSubmit} />
      <ResolutionResult run={run} favoriteKeys={favoriteKeys} onToggleFavorite={onToggleFavorite} />
    </div>
  );
}

function Composer({
  providers,
  busy,
  onSubmit,
}: {
  providers: WebProvider[];
  busy: boolean;
  onSubmit: (input: CreateWebRunInput) => Promise<void>;
}) {
  const [target, setTarget] = useState<WebResolvedTarget>("character");
  const [inputs, setInputs] = useState<Record<WebResolvedTarget, string>>({ work: "", character: "", image: "" });
  const [workConstraint, setWorkConstraint] = useState("");
  const [appearance, setAppearance] = useState<WebCharacterAppearance>(emptyAppearance());
  const [selectedProviders, setSelectedProviders] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [conditionOpen, setConditionOpen] = useState(false);
  const [providerOpen, setProviderOpen] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const selectedConditions = appearanceEntries(appearance);
  const compatibleProviders = providers.filter((provider) => supportsTarget(provider, target));

  function changeTarget(value: string) {
    if (value !== "work" && value !== "character" && value !== "image") return;
    setTarget(value);
    setAttachments([]);
    setFieldError(null);
    setSelectedProviders((current) => current.filter((id) =>
      providers.some((provider) => provider.id === id && supportsTarget(provider, value))
    ));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const input = inputs[target].trim();
    const hasConditions = selectedConditions.length > 0;
    if (!input && attachments.length === 0 && !(target === "character" && (hasConditions || workConstraint.trim()))) {
      setFieldError(target === "character" ? "Add a name, work ID, or at least one condition" : "Add text or a compatible file");
      return;
    }
    let work: WebExternalId | undefined;
    if (target === "character" && workConstraint.trim()) {
      work = parseWorkConstraint(workConstraint);
      if (!work) {
        setFieldError("Work constraint must use source:id, for example anilist:154587");
        return;
      }
    }
    setFieldError(null);
    await onSubmit({
      input,
      target,
      providers: selectedProviders.length ? selectedProviders : ["all"],
      attachments,
      ...(target === "character" && hasConditions ? { appearance } : {}),
      ...(work ? { work } : {}),
    });
  }

  function addFiles(files: File[]) {
    const validated = validateAttachments([...attachments, ...files]);
    const compatible = validated.accepted.filter((file) =>
      target === "image" ? file.type.startsWith("image/") : target === "work" ? isTorrent(file) : false
    );
    const incompatible = validated.accepted.filter((file) => !compatible.includes(file));
    setAttachments(compatible);
    const errors = [
      ...validated.rejected.map((item) => `${item.name}: ${item.reason}`),
      ...incompatible.map((file) => `${file.name}: not valid for ${target}`),
    ];
    setFieldError(errors.join(" / ") || null);
  }

  function drop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    addFiles([...event.dataTransfer.files]);
  }

  return (
    <EdgeSurface className="composer">
      <form onSubmit={submit}>
        <div className="composer-toolbar">
          <SegmentedControl
            className="target-control"
            label="Resolution target"
            value={target}
            onValueChange={changeTarget}
            options={[
              { value: "work", label: "Work", icon: <Film size={15} /> },
              { value: "character", label: "Character", icon: <UserRound size={15} /> },
              { value: "image", label: "Image", icon: <ImageIcon size={15} /> },
            ]}
          />
          <Button type="button" size="sm" iconBefore={<Network size={16} />} onClick={() => setProviderOpen(true)}>
            {selectedProviders.length ? `${selectedProviders.length} sources` : "Sources"}
          </Button>
        </div>

        {target === "character" && (
          <div className="character-query-grid">
            <TextField aria-label="Character name" label="Character name" placeholder="Isla" value={inputs.character} onChange={(event) => setInputs((current) => ({ ...current, character: event.target.value }))} startAdornment={<UserRound size={17} />} />
            <TextField aria-label="Work constraint" label="Work constraint" placeholder="anilist:154587" value={workConstraint} onChange={(event) => setWorkConstraint(event.target.value)} startAdornment={<Film size={17} />} />
          </div>
        )}
        {target === "work" && <TextArea aria-label="Work input" label="Title or release" placeholder="Dungeon Meshi, release name, path, or magnet" rows={3} value={inputs.work} onChange={(event) => setInputs((current) => ({ ...current, work: event.target.value }))} />}
        {target === "image" && <TextField aria-label="Image URL" label="Image URL" placeholder="https://example.com/frame.png" value={inputs.image} onChange={(event) => setInputs((current) => ({ ...current, image: event.target.value }))} startAdornment={<ImageIcon size={17} />} />}

        {target === "character" && (
          <div className="condition-row">
            <div className="condition-label"><SlidersHorizontal size={16} /><span>Conditions</span><b>{selectedConditions.length}</b></div>
            <div className="selected-conditions">
              {selectedConditions.map(({ field, value }) => (
                <Chip key={`${field}-${value}`} onDelete={() => setAppearance((current) => ({ ...current, [field]: current[field].filter((item) => item !== value) }))} deleteLabel={`Remove ${displayTag(value)}`}>
                  {isColorField(field) && <i className="color-swatch" style={{ background: tagColor(value) }} />}{displayTag(value)}
                </Chip>
              ))}
              {!selectedConditions.length && <span className="condition-empty">None selected</span>}
            </div>
            <Button type="button" size="sm" iconBefore={<Plus size={15} />} onClick={() => setConditionOpen(true)}>Add</Button>
          </div>
        )}

        {attachments.length > 0 && <div className="attachment-row">{attachments.map((file, index) => (
          <Chip key={`${file.name}-${file.size}-${index}`} icon={file.type.startsWith("image/") ? <FileImage size={14} /> : <Archive size={14} />} onDelete={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))} deleteLabel={`Remove ${file.name}`}>{file.name}</Chip>
        ))}</div>}

        {fieldError && <p className="field-error">{fieldError}</p>}
        <div className="composer-actions">
          {target !== "character" && (
            <label className="file-button" onDragOver={(event) => event.preventDefault()} onDrop={drop}>
              <FileUp size={17} /><span>{target === "image" ? "Add image" : "Add torrent"}</span>
              <input type="file" multiple accept={target === "image" ? "image/jpeg,image/png" : ".torrent,application/x-bittorrent"} onChange={(event) => addFiles([...(event.target.files ?? [])])} />
            </label>
          )}
          <Button className="resolve-button" type="submit" variant="primary" size="lg" loading={busy} iconBefore={busy ? <LoaderCircle className="spin" size={18} /> : <Sparkles size={17} />} iconAfter={!busy ? <ArrowRight size={17} /> : undefined}>{busy ? "Resolving" : "Resolve"}</Button>
        </div>
      </form>
      <ConditionDialog open={conditionOpen} appearance={appearance} onOpenChange={setConditionOpen} onChange={setAppearance} />
      <ProviderDialog open={providerOpen} providers={compatibleProviders} selected={selectedProviders} onOpenChange={setProviderOpen} onChange={setSelectedProviders} />
    </EdgeSurface>
  );
}

function ConditionDialog({
  open,
  appearance,
  onOpenChange,
  onChange,
}: {
  open: boolean;
  appearance: WebCharacterAppearance;
  onOpenChange: (open: boolean) => void;
  onChange: (appearance: WebCharacterAppearance) => void;
}) {
  const [customField, setCustomField] = useState<AppearanceField>("traits");
  const [customValue, setCustomValue] = useState("");
  function toggle(field: AppearanceField, value: string) {
    const selected = appearance[field].includes(value);
    onChange({ ...appearance, [field]: selected ? appearance[field].filter((item) => item !== value) : [...appearance[field], value] });
  }
  function addCustom() {
    const value = customValue.normalize("NFKC").trim().replace(/\s+/gu, "_").toLocaleLowerCase();
    if (!value || appearance[customField].includes(value)) return;
    onChange({ ...appearance, [customField]: [...appearance[customField], value] });
    setCustomValue("");
  }
  return (
    <Dialog className="condition-dialog" open={open} onOpenChange={onOpenChange} title="Character conditions" closeLabel="Close conditions">
      <div className="condition-groups">
        {APPEARANCE_GROUPS.map((group) => (
          <section className="condition-group" key={group.field}><h3>{group.label}</h3><div className="condition-options">
            {group.values.map((option) => {
              const selected = appearance[group.field].includes(option.value);
              return <button key={option.value} className={selected ? "is-selected" : ""} type="button" aria-pressed={selected} onClick={() => toggle(group.field, option.value)}>{option.color && <i className="color-swatch" style={{ background: option.color }} />}<span>{option.label}</span>{selected && <Check size={14} />}</button>;
            })}
          </div></section>
        ))}
      </div>
      <div className="custom-condition">
        <SelectField aria-label="Condition field" label="Field" value={customField} onValueChange={(value) => setCustomField(value as AppearanceField)} options={APPEARANCE_GROUPS.map((group) => ({ value: group.field, label: group.label }))} />
        <TextField aria-label="Custom condition value" label="Custom tag" maxLength={64} value={customValue} onChange={(event) => setCustomValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addCustom(); } }} />
        <Button type="button" iconBefore={<Plus size={15} />} onClick={addCustom}>Add tag</Button>
      </div>
    </Dialog>
  );
}

function ProviderDialog({
  open,
  providers,
  selected,
  onOpenChange,
  onChange,
}: {
  open: boolean;
  providers: WebProvider[];
  selected: string[];
  onOpenChange: (open: boolean) => void;
  onChange: (providers: string[]) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Sources" closeLabel="Close sources">
      <button className={`provider-choice ${selected.length === 0 ? "is-selected" : ""}`} type="button" onClick={() => onChange([])}><span className="provider-symbol"><Sparkles size={17} /></span><span><strong>All compatible</strong><small>Ready sources for this type</small></span>{selected.length === 0 && <Check size={18} />}</button>
      <div className="provider-choice-list">{providers.map((provider) => {
        const checked = selected.includes(provider.id);
        return <Checkbox className="provider-choice" key={provider.id} checked={checked} disabled={provider.status !== "ready"} onCheckedChange={(value) => onChange(value ? [...selected, provider.id] : selected.filter((id) => id !== provider.id))} label={<span><strong>{provider.label}</strong><small>{provider.capabilities.map(shortCapability).join(" / ")}</small></span>} />;
      })}</div>
    </Dialog>
  );
}

function ResolutionResult({
  run,
  favoriteKeys,
  onToggleFavorite,
}: {
  run: WebRun | null;
  favoriteKeys: Map<string, WebFavorite>;
  onToggleFavorite: (runId: string | undefined, item: DisplayResultItem) => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  useEffect(() => setSelectedIndex(0), [run?.id]);
  if (!run) return <PageState icon={<ScanSearch />} label="No identification selected" />;
  if (run.status === "failed") return <PageState icon={<X />} title="Resolution failed" label={run.error ?? "Unknown error"} />;
  if (run.status === "pending") return <PageState icon={<LoaderCircle className="spin" />} label="Resolving" />;
  const items = resultItems(run.result);
  const selected = items[selectedIndex] ?? items[0];
  if (!selected) return <PageState icon={<Search />} title="No matches" label={run.input} />;
  const saved = favoriteKeys.has(selected.key);
  return (
    <section className="resolution-result">
      <div className="result-toolbar"><span>{formatDate(run.createdAt)}</span><RawResultDialog run={run} /></div>
      <div className="result-primary">
        <EntryImage image={selected.image} entityType={selected.entityType} title={selected.title} large />
        <div className="result-copy"><div className="result-kicker"><span className={`entity-badge type-${selected.entityType}`}>{selected.entityType.toUpperCase()}</span>{selected.confidence !== undefined && <span className="confidence">{percent(selected.confidence)}</span>}</div>
          <h2>{selected.title}</h2>
          {selected.alternateNames.length > 0 && <p>{selected.alternateNames.slice(0, 3).join(" / ")}</p>}
          {selected.description && <p className="result-description">{selected.description}</p>}
          {selected.externalIds.length > 0 && <div className="external-ids">{selected.externalIds.map((id) => <CopyId key={`${id.source}-${id.id}`} source={id.source} id={id.id} />)}</div>}
          <Button
            variant={saved ? "secondary" : "primary"}
            iconBefore={saved ? <BookmarkCheck size={17} /> : <Bookmark size={17} />}
            aria-label={saved ? `Remove ${selected.title} from favorites` : `Save ${selected.title}`}
            onClick={() => onToggleFavorite(run.id, selected)}
          >
            {saved ? "Saved" : "Save to library"}
          </Button>
        </div>
      </div>
      {items.length > 1 && <div className="candidate-list" aria-label="Ranked candidates">{items.slice(0, 8).map((item, index) => (
        <button type="button" key={item.key} className={index === selectedIndex ? "is-selected" : ""} onClick={() => setSelectedIndex(index)}><span>{String(index + 1).padStart(2, "0")}</span><strong>{item.title}</strong><small>{capitalize(item.entityType)}</small>{item.confidence !== undefined && <b>{percent(item.confidence)}</b>}</button>
      ))}</div>}
    </section>
  );
}

function ActivityView({
  runs,
  query,
  loading,
  onQuery,
  onOpen,
  onDelete,
}: {
  runs: WebRun[];
  query: string;
  loading: boolean;
  onQuery: (value: string) => void;
  onOpen: (run: WebRun) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="activity-page page-frame">
      <header className="page-heading"><div><span className="section-label">RECENT INPUTS</span><h1>Activity</h1></div></header>
      <label className="search-box activity-search"><Search size={18} /><input value={query} onChange={(event) => onQuery(event.target.value)} aria-label="Search history" placeholder="Search input or result" />{query && <button type="button" aria-label="Clear history search" onClick={() => onQuery("")}><X size={15} /></button>}</label>
      {loading ? <PageState icon={<LoaderCircle className="spin" />} label="Loading activity" /> : (
        <div className="activity-list">{runs.map((run) => {
          const summary = summarizeRun(run);
          return <article className="activity-entry" key={run.id}><button className="activity-open" type="button" aria-label={`Open run ${summary.input}`} onClick={() => onOpen(run)}><span className={`activity-type type-${summary.entityType}`}>{entityIcon(summary.entityType, 17)}</span><span className="activity-flow"><span>{summary.input}</span><ArrowRight size={13} /><strong>{summary.output}</strong></span><small>{formatDate(run.createdAt)}</small></button><IconButton label={`Delete ${summary.input}`} size="sm" onClick={() => onDelete(run.id)}><Trash2 size={15} /></IconButton></article>;
        })}{!runs.length && <PageState compact icon={<History />} label="No activity yet" />}</div>
      )}
    </div>
  );
}

function SettingsView({ providers, storage, onCleanup }: { providers: WebProvider[]; storage: StorageStats | null; onCleanup: () => void }) {
  const used = storage ? Math.min(1, storage.bytesUsed / storage.maxBytes) : 0;
  return (
    <div className="settings-page page-frame">
      <header className="page-heading"><div><span className="section-label">LOCAL DATA</span><h1>Settings</h1></div></header>
      {storage && <section className="settings-section"><div className="settings-section-heading"><div><Database size={19} /><span><h2>Storage</h2><p>{storage.runs} runs and {storage.storedAttachments} stored files</p></span></div><Button size="sm" iconBefore={<RefreshCw size={16} />} onClick={onCleanup}>Clean up</Button></div><div className="storage-line"><i style={{ width: `${used * 100}%` }} /><span>{formatBytes(storage.bytesUsed)} of {formatBytes(storage.maxBytes)}</span></div></section>}
      <section className="settings-section"><div className="settings-section-heading"><div><Network size={19} /><span><h2>Sources</h2><p>Metadata available to identification and library pages</p></span></div></div><div className="provider-list">{providers.map((provider) => <article className="provider-row" key={provider.id}><span className="provider-symbol"><Network size={17} /></span><div><strong>{provider.label}</strong><small>{provider.strengths.join(" / ")}</small></div><span className={`provider-status ${provider.status}`}><i />{provider.status.replace("_", " ")}</span><span className="provider-auth">{provider.auth === "none" ? "No key" : `${capitalize(provider.auth)} auth`}</span></article>)}</div></section>
    </div>
  );
}

function RawResultDialog({ run }: { run: WebRun }) {
  const [open, setOpen] = useState(false);
  return <><Tooltip content="Run JSON"><IconButton label="Run JSON" size="sm" onClick={() => setOpen(true)}><Braces size={17} /></IconButton></Tooltip><Dialog className="raw-dialog" open={open} onOpenChange={setOpen} title="Run JSON" closeLabel="Close JSON"><pre>{JSON.stringify(run, null, 2)}</pre></Dialog></>;
}

function EntryImage({ image, entityType, title, large = false }: { image: string | undefined; entityType: string; title: string; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [image]);
  return <span className={`entry-image ${large ? "entry-image-large" : ""} ${!image || failed ? "is-fallback" : ""}`}>{image && !failed ? <img src={image} alt="" onError={() => setFailed(true)} /> : <span>{entityIcon(entityType, large ? 42 : 28)}<small>{capitalize(entityType)}</small></span>}<i aria-hidden="true" />{large && <b className="sr-only">{title}</b>}</span>;
}

function PageState({ icon, title, label, compact = false }: { icon: ReactNode; title?: string; label: string; compact?: boolean }) {
  return <div className={`page-state ${compact ? "is-compact" : ""}`}>{icon}{title && <strong>{title}</strong>}<span>{label}</span></div>;
}

function ErrorBanner({ message, onClose }: { message: string; onClose: () => void }) {
  return <div className="error-banner" role="alert"><span>{message}</span><button type="button" aria-label="Dismiss error" onClick={onClose}><X size={16} /></button></div>;
}

function CopyId({ source, id }: { source: string; id: string }) {
  const [copied, setCopied] = useState(false);
  return <button type="button" onClick={() => { void navigator.clipboard?.writeText(`${source}:${id}`); setCopied(true); window.setTimeout(() => setCopied(false), 900); }}><small>{source}</small><strong>{id}</strong>{copied ? <Check size={13} /> : <Plus size={13} />}</button>;
}

function entityIcon(type: string, size: number) {
  if (type === "work" || type.includes("scene")) return <Film size={size} />;
  if (type === "character") return <UserRound size={size} />;
  if (type === "person") return <CircleUserRound size={size} />;
  if (type === "organization") return <UsersRound size={size} />;
  return <BookOpen size={size} />;
}

function supportsTarget(provider: WebProvider, target: WebResolvedTarget) {
  if (target === "work") return provider.capabilities.includes("work_search");
  if (target === "character") return provider.capabilities.includes("character_search");
  return provider.capabilities.some((capability) => ["anime_scene_lookup", "reverse_image_lookup", "character_image_lookup"].includes(capability));
}

function parseWorkConstraint(value: string): WebExternalId | undefined {
  const [rawSource, id, ...rest] = value.trim().split(":");
  if (!rawSource || !id || rest.length) return undefined;
  if (rawSource === "tmdb-tv" || rawSource === "tmdb-movie") return { source: "tmdb", id, mediaKind: rawSource === "tmdb-tv" ? "tv" : "movie" };
  return { source: rawSource === "bgm" ? "bangumi" : rawSource, id };
}

function emptyAppearance(): WebCharacterAppearance {
  return { hairColors: [], eyeColors: [], hairStyles: [], genders: [], apparentAges: [], clothing: [], traits: [] };
}

function appearanceEntries(appearance: WebCharacterAppearance) {
  return (Object.entries(appearance) as Array<[AppearanceField, string[]]>).flatMap(([field, values]) => values.map((value) => ({ field, value })));
}

function candidateSubtitle(candidate: unknown): string | undefined {
  const record = asRecord(candidate);
  const names = Array.isArray(record?.names) ? record.names.filter((value): value is string => typeof value === "string" && Boolean(value.trim())) : [];
  return names[1];
}

function relatedKey(item: WebRelatedEntity) {
  const id = item.externalIds[0];
  return id ? `${item.entityType}:${id.source}:${id.id}` : `${item.entityType}:${item.provider}:${item.providerId}`;
}

function namedValues(values: string[]) { return values.map((value) => ({ value, label: displayTag(value) })); }
function colorValues(values: string[]) { return values.map((value) => ({ value, label: displayTag(value), color: tagColor(value) })); }

function tagColor(value: string) {
  const colors: Record<string, string> = { white: "#f8fbff", silver: "#b9c4cc", black: "#23282d", blond: "#f3d36a", brown: "#8a6048", red: "#e36065", blue: "#59a7df", green: "#66b88a", purple: "#9674c8", pink: "#ee91b3", orange: "#ee9b50", yellow: "#e7ca44" };
  return colors[value] ?? "#9fb4bd";
}

function isColorField(field: AppearanceField) { return field === "hairColors" || field === "eyeColors"; }
function displayTag(value: string) { return value.replace(/[_-]+/gu, " ").replace(/\b\w/gu, (letter) => letter.toUpperCase()); }
function isTorrent(file: File) { return file.type === "application/x-bittorrent" || file.name.toLocaleLowerCase().endsWith(".torrent"); }
function shortCapability(value: string) { return value.replace(/_/gu, " ").replace(/(?:search|lookup)$/u, "").trim(); }
function percent(value: number) { return `${Math.round(value * 100)}%`; }
function formatBytes(value: number) { if (value < 1024) return `${value} B`; if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`; return `${(value / 1024 / 1024).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} MB`; }
function formatDate(value: string) { return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value)); }
function capitalize(value: string) { return value ? value[0]!.toUpperCase() + value.slice(1).replace(/_/gu, " ") : value; }
function messageOf(reason: unknown) { return reason instanceof Error ? reason.message : String(reason); }
function asRecord(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
