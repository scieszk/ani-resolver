import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type DragEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  DockItem,
  GlassDock,
  LiquefyProvider,
  LiquidButton,
  LiquidCheckbox,
  LiquidChip,
  LiquidDialog,
  LiquidIconButton,
  LiquidSegmented,
  LiquidSelect,
  LiquidSurface,
  LiquidTextArea,
  LiquidTextField,
  LiquidTooltip,
} from "@liquefy-ui/react";
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Bookmark,
  BookmarkCheck,
  Braces,
  Check,
  ChevronRight,
  CircleUserRound,
  Database,
  FileImage,
  FileUp,
  Film,
  Heart,
  History,
  Image as ImageIcon,
  Layers3,
  LoaderCircle,
  Network,
  Plus,
  RefreshCw,
  ScanSearch,
  Search,
  ServerCog,
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
  providerRuns,
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
  WebProvider,
  WebResolvedTarget,
  WebRun,
} from "./types.js";

type AppView = "resolve" | "history" | "favorites" | "providers";
type LibraryMode = "history" | "favorites";
type Selection = { kind: "run" | "favorite"; id: string };
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
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const reducedTransparency = useMediaQuery("(prefers-reduced-transparency: reduce)");
  const webgl = typeof window !== "undefined" && "WebGLRenderingContext" in window;
  const [runs, setRuns] = useState<WebRun[]>([]);
  const [favorites, setFavorites] = useState<WebFavorite[]>([]);
  const [providers, setProviders] = useState<WebProvider[]>([]);
  const [storage, setStorage] = useState<StorageStats | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [activeView, setActiveView] = useState<AppView>("resolve");
  const [libraryMode, setLibraryMode] = useState<LibraryMode>("history");
  const [historyQuery, setHistoryQuery] = useState("");
  const [favoriteQuery, setFavoriteQuery] = useState("");
  const [searchedRuns, setSearchedRuns] = useState<WebRun[] | null>(null);
  const [searchedFavorites, setSearchedFavorites] = useState<WebFavorite[] | null>(null);
  const [ambientImage, setAmbientImage] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([
      api.listRuns(),
      api.listFavorites(),
      api.listProviders(),
      api.getStorage(),
    ])
      .then(([runList, favoriteList, providerList, storageStats]) => {
        if (!active) return;
        setRuns(runList.items);
        setFavorites(favoriteList.items);
        setProviders(providerList.items);
        setStorage(storageStats);
        setSelection((current) => current ?? (
          runList.items[0] ? { kind: "run", id: runList.items[0].id } :
            favoriteList.items[0] ? { kind: "favorite", id: favoriteList.items[0].id } : null
        ));
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
  const selectedRun = selection?.kind === "run"
    ? [...runs, ...(searchedRuns ?? [])].find((run) => run.id === selection.id) ?? null
    : null;
  const selectedFavorite = selection?.kind === "favorite"
    ? [...favorites, ...(searchedFavorites ?? [])].find((favorite) => favorite.id === selection.id) ?? null
    : null;
  const favoriteKeys = useMemo(
    () => new Map(favorites.map((favorite) => [favorite.entityKey, favorite])),
    [favorites],
  );

  async function createRun(input: CreateWebRunInput) {
    setBusy(true);
    setError(null);
    try {
      const created = await api.createRun(input);
      setRuns((current) => [created, ...current.filter((run) => run.id !== created.id)]);
      setSelection({ kind: "run", id: created.id });
      setActiveView("resolve");
      setLibraryMode("history");
      setStorage(await api.getStorage());
    } catch (reason) {
      if (reason instanceof ApiError) {
        const payload = asRecord(reason.payload);
        const failed = asRecord(payload?.run) as WebRun | null;
        if (failed?.id) {
          setRuns((current) => [failed, ...current.filter((run) => run.id !== failed.id)]);
          setSelection({ kind: "run", id: failed.id });
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
      if (selection?.kind === "run" && selection.id === id) {
        const next = runs.find((run) => run.id !== id);
        setSelection(next ? { kind: "run", id: next.id } : null);
      }
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
        await api.deleteFavorite(existing.id);
        setFavorites((current) => current.filter((favorite) => favorite.id !== existing.id));
        setSearchedFavorites((current) => current?.filter((favorite) => favorite.id !== existing.id) ?? null);
        if (selection?.kind === "favorite" && selection.id === existing.id) {
          setSelection(runs[0] ? { kind: "run", id: runs[0].id } : null);
        }
        return;
      }
      if (!runId) throw new Error("This saved snapshot has no source run to refresh from");
      const saved = await api.saveFavorite(runId, item.key);
      setFavorites((current) => [saved, ...current.filter((favorite) => favorite.id !== saved.id)]);
    } catch (reason) {
      setError(messageOf(reason));
    }
  }

  async function deleteFavorite(id: string) {
    setError(null);
    try {
      await api.deleteFavorite(id);
      setFavorites((current) => current.filter((favorite) => favorite.id !== id));
      setSearchedFavorites((current) => current?.filter((favorite) => favorite.id !== id) ?? null);
      if (selection?.kind === "favorite" && selection.id === id) {
        const next = favorites.find((favorite) => favorite.id !== id);
        setSelection(next ? { kind: "favorite", id: next.id } : runs[0] ? { kind: "run", id: runs[0].id } : null);
      }
    } catch (reason) {
      setError(messageOf(reason));
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

  const readyProviders = providers.filter((provider) => provider.status === "ready").length;

  return (
    <LiquefyProvider
      theme="light"
      tint="#bde8ee"
      intensity={0.78}
      wobbliness={0.72}
      motion={!reducedMotion}
      transparency={!reducedTransparency}
      webgl={webgl}
    >
      <div className="app-shell">
        <AmbientBackdrop image={ambientImage} />

        <LiquidSurface className="topbar" radius={18} interactive lensBlur={7}>
          <button className="brand" type="button" onClick={() => setActiveView("resolve")}>
            <span className="brand-mark"><ScanSearch size={19} /></span>
            <span className="brand-copy"><strong>ani-resolver</strong><small>local media index</small></span>
          </button>
          <div className="topbar-actions">
            <span className="service-state"><i /> {readyProviders}/{providers.length || "-"} sources</span>
            {storage && <span className="storage-state">{formatBytes(storage.bytesUsed)} / {formatBytes(storage.maxBytes)}</span>}
            <LiquidTooltip content="Providers">
              <LiquidIconButton label="Providers" size="sm" onClick={() => setActiveView("providers")}><ServerCog size={18} /></LiquidIconButton>
            </LiquidTooltip>
          </div>
        </LiquidSurface>

        <div className="workspace">
          <LiquidSurface className="library-rail desktop-library" radius={18} interactive={false} lensBlur={8}>
            <LibraryRail
              mode={libraryMode}
              runs={visibleRuns}
              favorites={visibleFavorites}
              selection={selection}
              historyQuery={historyQuery}
              favoriteQuery={favoriteQuery}
              onMode={setLibraryMode}
              onHistoryQuery={setHistoryQuery}
              onFavoriteQuery={setFavoriteQuery}
              onSelect={(next) => { setSelection(next); setActiveView("resolve"); }}
              onDeleteRun={deleteRun}
              onDeleteFavorite={deleteFavorite}
            />
          </LiquidSurface>

          <main className={`page resolve-page ${activeView === "resolve" ? "is-active" : ""}`}>
            <Composer providers={providers} busy={busy} onSubmit={createRun} />
            {error && <ErrorBanner message={error} onClose={() => setError(null)} />}
            <RunDetail
              run={selectedRun}
              favorite={selectedFavorite}
              loading={loading}
              favoriteKeys={favoriteKeys}
              onAmbientImage={setAmbientImage}
              onToggleFavorite={toggleFavorite}
            />
          </main>

          <section className={`page mobile-library-page ${activeView === "history" || activeView === "favorites" ? "is-active" : ""}`}>
            <LibraryRail
              mode={activeView === "favorites" ? "favorites" : "history"}
              runs={visibleRuns}
              favorites={visibleFavorites}
              selection={selection}
              historyQuery={historyQuery}
              favoriteQuery={favoriteQuery}
              onMode={(mode) => setActiveView(mode)}
              onHistoryQuery={setHistoryQuery}
              onFavoriteQuery={setFavoriteQuery}
              onSelect={(next) => { setSelection(next); setActiveView("resolve"); }}
              onDeleteRun={deleteRun}
              onDeleteFavorite={deleteFavorite}
            />
          </section>

          <section className={`page providers-page ${activeView === "providers" ? "is-active" : ""}`}>
            <ProvidersView providers={providers} storage={storage} onBack={() => setActiveView("resolve")} onCleanup={cleanupStorage} />
          </section>
        </div>

        <GlassDock className="mobile-nav" label="Primary navigation" position="floating">
          <DockItem active={activeView === "resolve"} icon={<ScanSearch size={20} />} label="Resolve" onClick={() => setActiveView("resolve")} />
          <DockItem active={activeView === "history"} icon={<History size={20} />} label="History" onClick={() => setActiveView("history")} />
          <DockItem active={activeView === "favorites"} icon={<Heart size={20} />} label="Favorites" onClick={() => setActiveView("favorites")} />
          <DockItem active={activeView === "providers"} icon={<Network size={20} />} label="Sources" onClick={() => setActiveView("providers")} />
        </GlassDock>
      </div>
    </LiquefyProvider>
  );
}

function AmbientBackdrop({ image }: { image: string | undefined }) {
  return (
    <div className="ambient-backdrop" aria-hidden="true">
      <div className="ambient-base" />
      {image && <div className="ambient-result" style={{ "--ambient-image": `url("${image.replaceAll('"', "")}")` } as CSSProperties} />}
      <div className="ambient-wash" />
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
      target === "image" ? file.type.startsWith("image/") :
        target === "work" ? isTorrent(file) : false
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
    <LiquidSurface className="composer" radius={20} interactive lensBlur={8}>
      <form onSubmit={submit}>
        <div className="composer-toolbar">
          <LiquidSegmented
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
          <LiquidButton type="button" size="sm" iconBefore={<Network size={16} />} onClick={() => setProviderOpen(true)}>
            {selectedProviders.length ? `${selectedProviders.length} sources` : "Compatible sources"}
          </LiquidButton>
        </div>

        <div className={`query-body query-${target}`}>
          {target === "character" && (
            <div className="character-query-grid">
              <LiquidTextField
                aria-label="Character name"
                label="Character name"
                placeholder="Isla"
                value={inputs.character}
                onChange={(event) => setInputs((current) => ({ ...current, character: event.target.value }))}
                startAdornment={<UserRound size={17} />}
              />
              <LiquidTextField
                aria-label="Work constraint"
                label="Work constraint"
                placeholder="anilist:154587"
                value={workConstraint}
                onChange={(event) => setWorkConstraint(event.target.value)}
                startAdornment={<Layers3 size={17} />}
              />
            </div>
          )}
          {target === "work" && (
            <LiquidTextArea
              aria-label="Work input"
              label="Title or release"
              placeholder="Dungeon Meshi, release name, path, or magnet"
              rows={2}
              value={inputs.work}
              onChange={(event) => setInputs((current) => ({ ...current, work: event.target.value }))}
            />
          )}
          {target === "image" && (
            <LiquidTextField
              aria-label="Image URL"
              label="Image URL"
              placeholder="https://example.com/frame.png"
              value={inputs.image}
              onChange={(event) => setInputs((current) => ({ ...current, image: event.target.value }))}
              startAdornment={<ImageIcon size={17} />}
            />
          )}
        </div>

        {target === "character" && (
          <div className="condition-row">
            <div className="condition-label"><SlidersHorizontal size={16} /><span>Conditions</span><b>{selectedConditions.length}</b></div>
            <div className="selected-conditions">
              {selectedConditions.map(({ field, value }) => (
                <LiquidChip
                  key={`${field}-${value}`}
                  size="sm"
                  variant="tinted"
                  onDelete={() => setAppearance((current) => ({
                    ...current,
                    [field]: current[field].filter((item) => item !== value),
                  }))}
                  deleteLabel={`Remove ${displayTag(value)}`}
                >
                  {isColorField(field) && <i className="color-swatch" style={{ background: tagColor(value) }} />}
                  {displayTag(value)}
                </LiquidChip>
              ))}
              {selectedConditions.length === 0 && <span className="condition-empty">No conditions</span>}
            </div>
            <LiquidButton type="button" size="sm" iconBefore={<Plus size={15} />} onClick={() => setConditionOpen(true)}>Add</LiquidButton>
          </div>
        )}

        {attachments.length > 0 && (
          <div className="attachment-row">
            {attachments.map((file, index) => (
              <LiquidChip
                key={`${file.name}-${file.size}-${index}`}
                icon={file.type.startsWith("image/") ? <FileImage size={14} /> : <Archive size={14} />}
                onDelete={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                deleteLabel={`Remove ${file.name}`}
              >
                {file.name}
              </LiquidChip>
            ))}
          </div>
        )}

        {fieldError && <p className="field-error">{fieldError}</p>}
        <div className="composer-actions">
          {target !== "character" && (
            <label className="file-button" onDragOver={(event) => event.preventDefault()} onDrop={drop}>
              <FileUp size={17} /><span>{target === "image" ? "Add image" : "Add torrent"}</span>
              <input
                type="file"
                multiple
                accept={target === "image" ? "image/jpeg,image/png" : ".torrent,application/x-bittorrent"}
                onChange={(event) => addFiles([...(event.target.files ?? [])])}
              />
            </label>
          )}
          <LiquidButton
            className="resolve-button"
            type="submit"
            size="lg"
            tint="#82d7df"
            isLoading={busy}
            iconBefore={busy ? <LoaderCircle className="spin" size={18} /> : <Sparkles size={17} />}
            iconAfter={!busy ? <ArrowRight size={17} /> : undefined}
            disabled={busy}
          >
            {busy ? "Resolving" : "Resolve"}
          </LiquidButton>
        </div>
      </form>

      <ConditionDialog open={conditionOpen} appearance={appearance} onOpenChange={setConditionOpen} onChange={setAppearance} />
      <ProviderDialog open={providerOpen} providers={compatibleProviders} selected={selectedProviders} onOpenChange={setProviderOpen} onChange={setSelectedProviders} />
    </LiquidSurface>
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
    onChange({
      ...appearance,
      [field]: selected ? appearance[field].filter((item) => item !== value) : [...appearance[field], value],
    });
  }

  function addCustom() {
    const value = customValue.normalize("NFKC").trim().replace(/\s+/gu, "_").toLocaleLowerCase();
    if (!value || appearance[customField].includes(value)) return;
    onChange({ ...appearance, [customField]: [...appearance[customField], value] });
    setCustomValue("");
  }

  return (
    <LiquidDialog className="condition-dialog" open={open} onOpenChange={onOpenChange} title="Character conditions" closeLabel="Close conditions">
      <div className="condition-groups">
        {APPEARANCE_GROUPS.map((group) => (
          <section className="condition-group" key={group.field}>
            <h3>{group.label}</h3>
            <div className="condition-options">
              {group.values.map((option) => {
                const selected = appearance[group.field].includes(option.value);
                return (
                  <button
                    key={option.value}
                    className={selected ? "is-selected" : ""}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggle(group.field, option.value)}
                  >
                    {option.color && <i className="color-swatch" style={{ background: option.color }} />}
                    <span>{option.label}</span>
                    {selected && <Check size={14} />}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      <div className="custom-condition">
        <LiquidSelect
          aria-label="Condition field"
          label="Field"
          value={customField}
          onValueChange={(value) => setCustomField(value as AppearanceField)}
          options={APPEARANCE_GROUPS.map((group) => ({ value: group.field, label: group.label }))}
        />
        <LiquidTextField
          aria-label="Custom condition value"
          label="Custom tag"
          value={customValue}
          onChange={(event) => setCustomValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addCustom();
            }
          }}
        />
        <LiquidButton type="button" iconBefore={<Plus size={15} />} onClick={addCustom}>Add tag</LiquidButton>
      </div>
    </LiquidDialog>
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
    <LiquidDialog open={open} onOpenChange={onOpenChange} title="Sources" closeLabel="Close sources">
      <button className={`provider-choice ${selected.length === 0 ? "is-selected" : ""}`} type="button" onClick={() => onChange([])}>
        <span className="provider-symbol"><Sparkles size={17} /></span>
        <span><strong>All compatible</strong><small>Every ready source for this target</small></span>
        {selected.length === 0 && <Check size={18} />}
      </button>
      <div className="provider-choice-list">
        {providers.map((provider) => {
          const checked = selected.includes(provider.id);
          return (
            <LiquidCheckbox
              className="provider-choice"
              key={provider.id}
              checked={checked}
              disabled={provider.status !== "ready"}
              onCheckedChange={(value) => onChange(value ? [...selected, provider.id] : selected.filter((id) => id !== provider.id))}
              label={<span><strong>{provider.label}</strong><small>{provider.capabilities.map(shortCapability).join(" / ")}</small></span>}
            />
          );
        })}
      </div>
    </LiquidDialog>
  );
}

function LibraryRail({
  mode,
  runs,
  favorites,
  selection,
  historyQuery,
  favoriteQuery,
  onMode,
  onHistoryQuery,
  onFavoriteQuery,
  onSelect,
  onDeleteRun,
  onDeleteFavorite,
}: {
  mode: LibraryMode;
  runs: WebRun[];
  favorites: WebFavorite[];
  selection: Selection | null;
  historyQuery: string;
  favoriteQuery: string;
  onMode: (mode: LibraryMode) => void;
  onHistoryQuery: (value: string) => void;
  onFavoriteQuery: (value: string) => void;
  onSelect: (selection: Selection) => void;
  onDeleteRun: (id: string) => void;
  onDeleteFavorite: (id: string) => void;
}) {
  const query = mode === "history" ? historyQuery : favoriteQuery;
  const onQuery = mode === "history" ? onHistoryQuery : onFavoriteQuery;
  return (
    <div className="library-content">
      <div className="library-heading">
        <div><span className="eyebrow">LIBRARY</span><strong>{mode === "history" ? "History" : "Favorites"}</strong></div>
        <span className="run-count">{mode === "history" ? runs.length : favorites.length}</span>
      </div>
      <LiquidSegmented
        className="library-tabs"
        label="Library view"
        value={mode}
        onValueChange={(value) => onMode(value as LibraryMode)}
        options={[
          { value: "history", label: "History", icon: <History size={15} /> },
          { value: "favorites", label: "Saved", icon: <Bookmark size={15} /> },
        ]}
      />
      <label className="search-field">
        <Search size={16} />
        <input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder={mode === "history" ? "Search input or output" : "Search saved results"}
          aria-label={mode === "history" ? "Search history" : "Search favorites"}
        />
        {query && <button type="button" aria-label="Clear search" onClick={() => onQuery("")}><X size={14} /></button>}
      </label>
      {mode === "history" ? (
        <div className="library-list">
          {runs.map((run) => {
            const summary = summarizeRun(run);
            const selected = selection?.kind === "run" && selection.id === run.id;
            return (
              <article className={`library-item ${selected ? "is-selected" : ""}`} key={run.id}>
                <button className="library-item-main" type="button" onClick={() => onSelect({ kind: "run", id: run.id })}>
                  <span className={`library-type type-${run.resolvedTarget}`}>{entityIcon(summary.entityType, 16)}</span>
                  <span className="library-flow">
                    <span className="library-input">{summary.input}</span>
                    <span className="flow-arrow"><ArrowRight size={11} /></span>
                    <strong>{summary.output}</strong>
                    <small>{capitalize(summary.entityType)}{summary.confidence !== undefined ? ` / ${percent(summary.confidence)}` : ""}</small>
                  </span>
                </button>
                <button className="item-delete" type="button" aria-label={`Delete ${summary.input}`} onClick={() => void onDeleteRun(run.id)}><Trash2 size={15} /></button>
              </article>
            );
          })}
          {runs.length === 0 && <LibraryEmpty icon={<History size={22} />} label="No runs yet" />}
        </div>
      ) : (
        <div className="library-list">
          {favorites.map((favorite) => {
            const selected = selection?.kind === "favorite" && selection.id === favorite.id;
            return (
              <article className={`library-item favorite-item ${selected ? "is-selected" : ""}`} key={favorite.id}>
                <button className="library-item-main" type="button" onClick={() => onSelect({ kind: "favorite", id: favorite.id })}>
                  <FavoriteThumb favorite={favorite} />
                  <span className="library-flow">
                    <span className="library-input">{capitalize(favorite.entityType)}</span>
                    <strong>{favorite.title}</strong>
                    <small>{formatDate(favorite.createdAt)}</small>
                  </span>
                </button>
                <button className="item-delete" type="button" aria-label={`Remove ${favorite.title} from favorites`} onClick={() => void onDeleteFavorite(favorite.id)}><X size={15} /></button>
              </article>
            );
          })}
          {favorites.length === 0 && <LibraryEmpty icon={<Bookmark size={22} />} label="No saved results" />}
        </div>
      )}
    </div>
  );
}

function FavoriteThumb({ favorite }: { favorite: WebFavorite }) {
  return favorite.image
    ? <span className="favorite-thumb"><img src={favorite.image} alt="" /></span>
    : <span className={`library-type type-${favorite.entityType}`}>{entityIcon(favorite.entityType, 16)}</span>;
}

function LibraryEmpty({ icon, label }: { icon: ReactNode; label: string }) {
  return <div className="library-empty">{icon}<span>{label}</span></div>;
}

function RunDetail({
  run,
  favorite,
  loading,
  favoriteKeys,
  onAmbientImage,
  onToggleFavorite,
}: {
  run: WebRun | null;
  favorite: WebFavorite | null;
  loading: boolean;
  favoriteKeys: Map<string, WebFavorite>;
  onAmbientImage: (image: string | undefined) => void;
  onToggleFavorite: (runId: string | undefined, item: DisplayResultItem) => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectionKey = run ? `run:${run.id}` : favorite ? `favorite:${favorite.id}` : "empty";
  useEffect(() => setSelectedIndex(0), [selectionKey]);

  const items = favorite ? resultItems({ items: [favorite.candidate] }) : resultItems(run?.result);
  const selected = items[selectedIndex] ?? items[0];
  useEffect(() => onAmbientImage(selected?.image), [onAmbientImage, selected?.image]);

  if (loading) return <DetailState icon={<LoaderCircle className="spin" />} label="Loading library" />;
  if (!run && !favorite) return <EmptyState />;
  if (run?.status === "failed") return <DetailState icon={<X size={24} />} title="Resolution failed" label={run.error ?? "Unknown error"} error />;
  if (run?.status === "pending") return <DetailState icon={<LoaderCircle className="spin" />} label="Resolving" />;
  if (!selected) return <DetailState icon={<Search size={24} />} title="No matches" label={run?.input ?? favorite?.title ?? ""} />;

  const evidence = run ? providerRuns(run.result) : [];
  const saved = favoriteKeys.has(selected.key);
  const target = run?.resolvedTarget ?? favorite?.entityType ?? selected.entityType;
  const date = run?.createdAt ?? favorite?.createdAt ?? new Date().toISOString();

  return (
    <section className="result-section">
      <div className="result-toolbar">
        <div className="result-run-label"><span>{formatDate(date)}</span><ChevronRight size={13} /><strong>{capitalize(target)}</strong></div>
        <div className="result-tools">
          <LiquidTooltip content={saved ? "Remove favorite" : "Save result"}>
            <LiquidIconButton
              label={saved ? `Remove ${selected.title} from favorites` : `Save ${selected.title}`}
              size="sm"
              onClick={() => void onToggleFavorite(run?.id ?? favorite?.sourceRunId, selected)}
            >
              {saved ? <BookmarkCheck size={17} /> : <Bookmark size={17} />}
            </LiquidIconButton>
          </LiquidTooltip>
          {run && <RawResultDialog run={run} />}
        </div>
      </div>

      <div className="result-canvas">
        <div className="result-copy">
          <div className="result-kicker">
            <span className={`entity-badge type-${target}`}>{selected.entityType.toUpperCase()}</span>
            {selected.confidence !== undefined && <span className="confidence"><i style={{ "--confidence": selected.confidence } as CSSProperties} />{percent(selected.confidence)}</span>}
          </div>
          <h1>{selected.title}</h1>
          {selected.alternateNames.length > 0 && <p className="alternate-names">{selected.alternateNames.slice(0, 3).join(" / ")}</p>}
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
          {items.slice(0, 8).map((item, index) => (
            <button className={index === selectedIndex ? "is-selected" : ""} type="button" key={item.key} onClick={() => setSelectedIndex(index)}>
              <span className="candidate-rank">{String(index + 1).padStart(2, "0")}</span>
              <span><strong>{item.title}</strong><small>{capitalize(item.entityType)}</small></span>
              {item.confidence !== undefined && <b>{percent(item.confidence)}</b>}
            </button>
          ))}
        </div>
      )}

      {run && (
        <div className="evidence-band">
          <div className="evidence-heading"><Network size={16} /><span>Provider runs</span></div>
          <div className="evidence-runs">
            {evidence.map((item, index) => {
              const status = String(item.status ?? "unknown");
              return (
                <span className={`evidence-item status-${status}`} key={`${String(item.provider)}-${index}`}>
                  <i /><strong>{String(item.provider)}</strong>
                  <small>{status}{typeof item.elapsedMs === "number" ? ` / ${item.elapsedMs}ms` : ""}</small>
                </span>
              );
            })}
            {evidence.length === 0 && <span className="muted">No provider trace</span>}
          </div>
        </div>
      )}
    </section>
  );
}

function ResultImage({ item }: { item: DisplayResultItem }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [item.image]);
  return (
    <div className={`result-media ${!item.image || failed ? "is-fallback" : ""}`}>
      {item.image && !failed
        ? <img src={item.image} alt="" onError={() => setFailed(true)} />
        : <span>{entityIcon(item.entityType, 42)}<small>{capitalize(item.entityType)}</small></span>}
    </div>
  );
}

function RawResultDialog({ run }: { run: WebRun }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <LiquidTooltip content="Run JSON">
        <LiquidIconButton label="Run JSON" size="sm" onClick={() => setOpen(true)}><Braces size={17} /></LiquidIconButton>
      </LiquidTooltip>
      <LiquidDialog className="raw-dialog" open={open} onOpenChange={setOpen} title="Run JSON" closeLabel="Close JSON">
        <pre>{JSON.stringify(run, null, 2)}</pre>
      </LiquidDialog>
    </>
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
        <LiquidIconButton label="Back to resolver" size="sm" onClick={onBack}><ArrowLeft size={19} /></LiquidIconButton>
        <div><span className="eyebrow">LOCAL RUNTIME</span><h1>Providers</h1></div>
      </div>
      {storage && (
        <LiquidSurface className="storage-panel" radius={16} interactive={false}>
          <div><Database size={19} /><span><strong>{formatBytes(storage.bytesUsed)}</strong><small>{storage.runs} runs / {storage.storedAttachments} stored files</small></span></div>
          <div className="storage-meter"><i style={{ width: `${used * 100}%` }} /></div>
          <LiquidButton type="button" size="sm" iconBefore={<RefreshCw size={16} />} onClick={onCleanup}>Clean up</LiquidButton>
        </LiquidSurface>
      )}
      <div className="provider-grid">
        {providers.map((provider) => (
          <article className="provider-card" key={provider.id}>
            <div className="provider-card-head">
              <span className="provider-symbol"><Network size={18} /></span>
              <div><h2>{provider.label}</h2><p>{provider.id}</p></div>
              <span className={`provider-status ${provider.status}`}><i /> {provider.status.replace("_", " ")}</span>
            </div>
            <div className="provider-meta"><span>{provider.auth === "none" ? "No auth" : `${capitalize(provider.auth)} auth`}</span><span>{provider.distribution}</span><span>{provider.languages.join(" / ")}</span></div>
            <div className="capability-list">{provider.capabilities.map((capability) => <span key={capability}>{shortCapability(capability)}</span>)}</div>
            <p className="provider-strength">{provider.strengths.join(" / ")}</p>
          </article>
        ))}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="empty-state">
      <div className="empty-photo"><img src={DEFAULT_BACKGROUND} alt="" /></div>
      <div className="empty-copy"><ScanSearch size={25} /><strong>Ready for a new run</strong><span>No result selected</span></div>
    </div>
  );
}

function DetailState({ icon, title, label, error = false }: { icon: ReactNode; title?: string; label: string; error?: boolean }) {
  return <div className={`detail-state ${error ? "error-state" : ""}`}>{icon}{title && <strong>{title}</strong>}<span>{label}</span></div>;
}

function ErrorBanner({ message, onClose }: { message: string; onClose: () => void }) {
  return <div className="error-banner"><span>{message}</span><button type="button" aria-label="Dismiss error" onClick={onClose}><X size={16} /></button></div>;
}

function CopyId({ source, id }: { source: string; id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" onClick={() => {
      void navigator.clipboard?.writeText(`${source}:${id}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 900);
    }}>
      <small>{source}</small><strong>{id}</strong>{copied ? <Check size={13} /> : <Plus size={13} />}
    </button>
  );
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
  if (rawSource === "tmdb-tv" || rawSource === "tmdb-movie") {
    return { source: "tmdb", id, mediaKind: rawSource === "tmdb-tv" ? "tv" : "movie" };
  }
  return { source: rawSource === "bgm" ? "bangumi" : rawSource, id };
}

function emptyAppearance(): WebCharacterAppearance {
  return {
    hairColors: [],
    eyeColors: [],
    hairStyles: [],
    genders: [],
    apparentAges: [],
    clothing: [],
    traits: [],
  };
}

function appearanceEntries(appearance: WebCharacterAppearance) {
  return (Object.entries(appearance) as Array<[AppearanceField, string[]]>)
    .flatMap(([field, values]) => values.map((value) => ({ field, value })));
}

function namedValues(values: string[]) {
  return values.map((value) => ({ value, label: displayTag(value) }));
}

function colorValues(values: string[]) {
  return values.map((value) => ({ value, label: displayTag(value), color: tagColor(value) }));
}

function tagColor(value: string) {
  const colors: Record<string, string> = {
    white: "#f8fbff",
    silver: "#b9c4cc",
    black: "#23282d",
    blond: "#f3d36a",
    brown: "#8a6048",
    red: "#e36065",
    blue: "#59a7df",
    green: "#66b88a",
    purple: "#9674c8",
    pink: "#ee91b3",
    orange: "#ee9b50",
    yellow: "#e7ca44",
  };
  return colors[value] ?? "#9fb4bd";
}

function isColorField(field: AppearanceField) {
  return field === "hairColors" || field === "eyeColors";
}

function displayTag(value: string) {
  return value.replace(/[_-]+/gu, " ").replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

function isTorrent(file: File) {
  return file.type === "application/x-bittorrent" || file.name.toLocaleLowerCase().endsWith(".torrent");
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
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, [query]);
  return matches;
}
