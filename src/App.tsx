import { useEffect, useMemo, useRef, useState } from 'react';
import type { FeatureCollection } from 'geojson';
import {
  ChevronDown,
  CircleAlert,
  Download,
  FileSpreadsheet,
  LoaderCircle,
  Search,
  X,
} from 'lucide-react';
import FileUploader from './components/FileUploader';
import MapView from './components/MapView';
import SummaryCards from './components/SummaryCards';
import { buildXlsx, download } from './engine/exporters';
import type { ImportResult, ProgressState, RouteFeature, Unit } from './types';
import {
  calculateDistances,
  defaultFields,
  discardJob,
  groupFiles,
  importRouteFile,
  sampleKml,
} from './services/localApi';
import { routesToGeoJSON } from './engine/geometry';
import { UNIT_LABEL, fmt } from './engine/distance';

const ALL_COLUMNS = '__all__';
const ROUTE_ID_FIELD = '__route_id__';
const ROUTE_NAME_FIELD = '__route_name__';

const INITIAL_PROGRESS: ProgressState = {
  active: false,
  phase: '',
  percent: 0,
  done: 0,
  total: 0,
  current: '',
};

export default function App() {
  const [panelOpen, setPanelOpen] = useState(true);
  const [imported, setImported] = useState<ImportResult | null>(null);
  const [routes, setRoutes] = useState<RouteFeature[]>([]);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [unit, setUnit] = useState<Unit>('km');
  const [idField, setIdField] = useState('');
  const [nameField, setNameField] = useState('');
  const [crsOverride, setCrsOverride] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [errorSection, setErrorSection] = useState<'source' | 'calculate' | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [progress, setProgress] = useState<ProgressState>(INITIAL_PROGRESS);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [fitToken, setFitToken] = useState(0);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [searchField, setSearchField] = useState(ALL_COLUMNS);
  const [filterValue, setFilterValue] = useState('');

  // Debounce typing so the map doesn't re-zoom on every keystroke.
  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedQuery(query), 250);
    return () => window.clearTimeout(id);
  }, [query]);

  // Reset filterValue when searchField changes
  useEffect(() => {
    setFilterValue('');
  }, [searchField]);

  const workVersion = useRef(0);
  const activeJobId = useRef<string | null>(null);
  const calculation = useRef<AbortController | null>(null);

  const invalidateWork = () => {
    workVersion.current += 1;
    calculation.current?.abort();
    calculation.current = null;
    if (activeJobId.current) discardJob(activeJobId.current);
    activeJobId.current = null;
  };

  const handleFiles = async (files: File[]) => {
    invalidateWork();
    const version = workVersion.current;
    setQuery('');
    setDebouncedQuery('');
    setSearchField(ALL_COLUMNS);
    setFilterValue('');
    setError(null);
    setErrorSection(null);
    setWarnings([]);
    setRoutes([]);
    setSelectedIdx(null);
    setFitToken((value) => value + 1);
    const { group: fileGroup, error: groupError } = groupFiles(files);
    if (groupError || !fileGroup) {
      setImported(null);
      setProgress(INITIAL_PROGRESS);
      setError(groupError || 'Unsupported file format.');
      setErrorSection('source');
      return;
    }

    setImported(null);
    setProgress({ ...INITIAL_PROGRESS, active: true, phase: 'Reading routes...', percent: 15 });
    try {
      const result = await importRouteFile(fileGroup);
      if (version !== workVersion.current) {
        discardJob(result.jobId);
        return;
      }
      activeJobId.current = result.jobId;
      setImported(result);
      const defaults = defaultFields(result.fields);
      setIdField(defaults.idField);
      setNameField(defaults.nameField);
      setCrsOverride('');
      setWarnings(result.warnings);
    } catch (e) {
      if (version !== workVersion.current) return;
      setImported(null);
      setError((e as Error).message);
      setErrorSection('source');
    } finally {
      if (version === workVersion.current) setProgress(INITIAL_PROGRESS);
    }
  };

  const handleCalculate = async () => {
    if (!imported) return;
    calculation.current?.abort();
    const controller = new AbortController();
    calculation.current = controller;
    const version = ++workVersion.current;
    setError(null);
    setErrorSection(null);
    setRoutes([]);
    setSelectedIdx(null);
    setProgress({ ...INITIAL_PROGRESS, active: true, phase: 'Processing routes...' });
    try {
      const result = await calculateDistances(
        imported.jobId,
        { idField, nameField, crsOverride: crsOverride || undefined },
        (done, total, current) => {
          if (version !== workVersion.current) return;
          setProgress({
            active: true,
            phase: 'Calculating route distances...',
            percent: Math.round((done / total) * 100),
            done,
            total,
            current,
          });
        },
        controller.signal
      );
      if (version !== workVersion.current) return;
      setRoutes(result.routes);
      setWarnings([...imported.warnings, ...result.warnings]);
      setFitToken((value) => value + 1);
    } catch (e) {
      if (version !== workVersion.current || controller.signal.aborted) return;
      setError((e as Error).message);
      setErrorSection('calculate');
    } finally {
      if (version === workVersion.current) {
        calculation.current = null;
        setProgress((previous) => ({ ...previous, active: false }));
      }
    }
  };

  const handleExportExcel = async () => {
    if (!routes.length) return;
    const version = workVersion.current;
    setExportingExcel(true);
    try {
      const blob = await buildXlsx(routes, imported?.fields ?? [], unit);
      if (version !== workVersion.current) return;
      const baseName = (imported?.fileName ?? 'routes').replace(/\.[^.]+$/, '');
      download(blob, `${baseName}_distances_${unit}.xlsx`);
    } catch {
      if (version !== workVersion.current) return;
      setError('Unable to create the Excel file. Please try again.');
      setErrorSection('calculate');
    } finally {
      if (version === workVersion.current) setExportingExcel(false);
    }
  };

  const geojson: FeatureCollection | null = useMemo(() => {
    if (!routes.length) return null;
    const tolerance = routes.length > 20000 ? 0.0004 : routes.length > 5000 ? 0.0002 : 0.00005;
    return routesToGeoJSON(routes, tolerance);
  }, [routes]);

  const selected = useMemo(
    () => routes.find((route) => route.idx === selectedIdx) ?? null,
    [routes, selectedIdx]
  );

  const columnValues = useMemo(() => {
    if (!routes.length || searchField === ALL_COLUMNS) return [];
    const set = new Set<string>();
    for (const route of routes) {
      let val: unknown;
      if (searchField === ROUTE_ID_FIELD) {
        val = route.routeId;
      } else if (searchField === ROUTE_NAME_FIELD) {
        val = route.routeName;
      } else {
        val = route.attributes[searchField];
      }
      if (val !== undefined && val !== null && String(val).trim() !== '') {
        set.add(String(val));
      }
    }
    return Array.from(set).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
    );
  }, [routes, searchField]);

  // Route indices matching the search; null when search box and filter value are empty.
  const matches = useMemo<Set<number> | null>(() => {
    const term = debouncedQuery.trim().toLowerCase();
    const hasFilterVal = Boolean(filterValue);
    if (!term && !hasFilterVal) return null;

    const has = (value: unknown) => String(value ?? '').toLowerCase().includes(term);

    const found = new Set<number>();
    for (const route of routes) {
      let hitQuery = true;
      if (term) {
        hitQuery =
          searchField === ALL_COLUMNS
            ? has(route.routeId) ||
              has(route.routeName) ||
              Object.values(route.attributes).some(has)
            : searchField === ROUTE_ID_FIELD
              ? has(route.routeId)
              : searchField === ROUTE_NAME_FIELD
                ? has(route.routeName)
                : has(route.attributes[searchField]);
      }

      let hitVal = true;
      if (hasFilterVal && searchField !== ALL_COLUMNS) {
        const val =
          searchField === ROUTE_ID_FIELD
            ? route.routeId
            : searchField === ROUTE_NAME_FIELD
              ? route.routeName
              : route.attributes[searchField];
        hitVal = String(val ?? '') === filterValue;
      }

      if (hitQuery && hitVal) {
        found.add(route.idx);
      }
    }
    return found;
  }, [debouncedQuery, filterValue, searchField, routes]);

  const matchedRoutes = useMemo(
    () => (matches ? routes.filter((route) => matches.has(route.idx)) : routes),
    [matches, routes]
  );

  // A single match is selected automatically, like Point File Creator's search.
  useEffect(() => {
    if (matches && matches.size === 1) setSelectedIdx([...matches][0]);
  }, [matches]);

  const searchFields = [
    { value: ALL_COLUMNS, label: 'All columns' },
    { value: ROUTE_ID_FIELD, label: 'Route ID' },
    { value: ROUTE_NAME_FIELD, label: 'Route name' },
    ...(imported?.fields ?? []).map((field) => ({ value: field, label: field })),
  ];

  const searchBar = (
    <RouteSearch
      query={query}
      onQueryChange={setQuery}
      field={searchField}
      onFieldChange={setSearchField}
      fields={searchFields}
      filterValue={filterValue}
      onFilterValueChange={setFilterValue}
      columnValues={columnValues}
      matchCount={matches ? matches.size : routes.length}
      totalCount={routes.length}
      disabled={!routes.length}
    />
  );
  const totalM = useMemo(() => routes.reduce((sum, route) => sum + route.lengthM, 0), [routes]);
  const nonRouteGeometry = imported
    ? Object.keys(imported.geometryTypes)
        .filter((geometry) => geometry !== 'LineString' && geometry !== 'MultiLineString')
        .join(', ')
    : '';

  return (
    <div className="pfc-shell flex h-screen w-full flex-col overflow-hidden supports-[height:100dvh]:h-dvh">
      {/* Header: brand + hamburger only — matches Point File Creator exactly */}
      <header className="pfc-header flex h-[48px] shrink-0 items-center gap-2 px-3 lg:gap-3 lg:px-4">
        <button
          type="button"
          onClick={() => setPanelOpen((open) => !open)}
          aria-expanded={panelOpen}
          aria-controls="route-panel"
          aria-label={panelOpen ? 'Hide side panel' : 'Show side panel'}
          title={panelOpen ? 'Hide panel' : 'Show panel'}
          className="pfc-menu-button"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <div className="min-w-0">
          <h1 className="truncate text-[13px] font-extrabold tracking-[0.065em] text-[#102f32] sm:text-[15px]">
            <span className="md:hidden">ROUTE CALCULATOR</span>
            <span className="hidden md:inline">ROUTE DISTANCE CALCULATOR</span>
          </h1>
          <p className="truncate text-[9px] tracking-[0.10em] text-[#849692]">
            <span className="md:hidden">TELECOM GIS TOOLKIT</span>
            <span className="hidden md:inline">TELECOM GIS TOOLKIT / LOCAL WORKSPACE</span>
          </p>
        </div>
      </header>

      {/* Mobile: full-screen map with slide-in drawer (Point File Creator pattern).
          Desktop: panel left, map right. */}
      <div className="relative flex min-h-0 flex-1 flex-col lg:flex-row">
        {panelOpen && (
          <button
            type="button"
            aria-label="Close side panel"
            className="pfc-drawer-backdrop"
            onClick={() => setPanelOpen(false)}
          />
        )}

        <aside
          id="route-panel"
          aria-hidden={!panelOpen}
          inert={!panelOpen}
          className={`pfc-sidebar pfc-panel ${panelOpen ? 'is-open' : 'is-closed'}`}
        >
          <div className="flex min-h-0 w-full flex-1 flex-col">
          <div className="pfc-sidebar-mobile-head">
            <span>Route workspace</span>
            <button
              type="button"
              onClick={() => setPanelOpen(false)}
              aria-label="Close side panel"
              className="pfc-menu-button"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div className="pfc-intro shrink-0 border-b px-5 pb-5 pt-6">
            <div className="pfc-kicker mb-2 text-[9px] font-extrabold uppercase">
              Route workspace
            </div>
            <h2 className="text-[20px] font-bold leading-tight tracking-tight text-[#122f31]">
              Import. Measure. Export.
            </h2>
            <p className="mt-2 text-[11.5px] leading-relaxed text-[#6b7f7c]">
              Everything you need for a route is in this one panel.
            </p>
          </div>

          <div className="stage-panel min-h-0 flex-1 overflow-y-auto px-5 py-5">
            <section aria-labelledby="route-file-heading" className="space-y-3">
              <SectionHeading id="route-file-heading" number="01" title="Route file" />
              <FileUploader
                busy={progress.active}
                onFiles={handleFiles}
                onSample={() => handleFiles([sampleKml()])}
              />
              {progress.active && progress.phase.startsWith('Reading') && (
                <ProgressBar progress={progress} />
              )}
              {error && errorSection === 'source' && <Notice kind="error">{error}</Notice>}
              {nonRouteGeometry && (
                <Notice kind="warning">
                  {nonRouteGeometry} geometry detected. Only lines are measured.
                </Notice>
              )}
            </section>

            <section aria-label="Actions" className="pfc-divider mt-5 space-y-3 border-t pt-5">
              <div role="group" aria-label="Distance unit">
                <span className="block text-[9px] font-bold uppercase tracking-[0.08em] text-[#78918b]">
                  Distance unit
                </span>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  {(['km', 'm', 'mi', 'ft'] as Unit[]).map((value) => (
                    <label
                      key={value}
                      className="flex cursor-pointer items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wide text-[#526b68]"
                    >
                      <input
                        type="checkbox"
                        checked={unit === value}
                        onChange={() => setUnit(value)}
                        className="h-3.5 w-3.5 accent-[#0d3437]"
                      />
                      {UNIT_LABEL[value]}
                    </label>
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={handleCalculate}
                disabled={!imported || progress.active}
                className="pfc-action pfc-action-primary"
              >
                {progress.active && !progress.phase.startsWith('Reading') ? (
                  <>
                    <LoaderCircle size={15} className="animate-spin" aria-hidden="true" />
                    Calculating...
                  </>
                ) : (
                  <>Calculate distance</>
                )}
              </button>

              {progress.active && !progress.phase.startsWith('Reading') && (
                <ProgressBar progress={progress} />
              )}
              {error && errorSection === 'calculate' && <Notice kind="error">{error}</Notice>}
              {warnings.map((warning, index) => (
                <Notice key={index} kind="warning">
                  {warning}
                </Notice>
              ))}
              {routes.length > 0 && !progress.active && (
                <p role="status" className="border-l-2 border-[#13a38f] pl-3 text-[11px] leading-relaxed text-[#526b68]">
                  {routes.length.toLocaleString()} routes calculated — total{' '}
                  <span className="font-semibold">{fmt(totalM, unit)}</span>.
                </p>
              )}

              <button
                type="button"
                onClick={handleExportExcel}
                disabled={!routes.length || exportingExcel}
                className="pfc-action pfc-action-export"
              >
                {exportingExcel ? (
                  <>
                    <LoaderCircle size={15} className="animate-spin" aria-hidden="true" />
                    Exporting...
                  </>
                ) : (
                  <>
                    <FileSpreadsheet size={15} aria-hidden="true" />
                    Export Excel
                  </>
                )}
              </button>
              {routes.length > 0 && (
                <p className="flex items-center justify-center gap-1 text-[10px] text-[#849692]">
                  <Download size={11} aria-hidden="true" />
                  {(imported?.fileName ?? 'routes').replace(/\.[^.]+$/, '')}_distances_{unit}.xlsx
                </p>
              )}
            </section>
          </div>
          </div>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white">
          {searchBar}
          {routes.length > 0 && (
            <div className="shrink-0 border-b border-[#dce5e2] bg-[#f7f9f8] px-2 py-1 lg:px-4 lg:py-3">
              {matches && matches.size === 0 ? (
                <p className="px-1 py-1.5 text-[11px] text-[#6b7f7c] lg:py-2">
                  No routes match “{debouncedQuery.trim()}”. All routes stay on the map; clear the
                  search to see totals again.
                </p>
              ) : (
                <SummaryCards
                  routes={matchedRoutes}
                  unit={unit}
                  selected={selected}
                  filtered={matches !== null}
                />
              )}
            </div>
          )}

          <div className="min-h-0 flex-1">
            <MapView
              data={geojson}
              routes={routes}
              selected={selected}
              onSelect={(idx) =>
                setSelectedIdx((prev) => (idx === null ? null : prev === idx ? null : idx))
              }
              fitToken={fitToken}
              matches={matches}
            />
          </div>

        </main>
      </div>
    </div>
  );
}

function RouteSearch({
  query,
  onQueryChange,
  field,
  onFieldChange,
  fields,
  filterValue,
  onFilterValueChange,
  columnValues,
  matchCount,
  totalCount,
  disabled,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  field: string;
  onFieldChange: (value: string) => void;
  fields: { value: string; label: string }[];
  filterValue: string;
  onFilterValueChange: (value: string) => void;
  columnValues: string[];
  matchCount: number;
  totalCount: number;
  disabled: boolean;
}) {
  return (
    /* .map-toolbar exact clone */
    <div
      role="search"
      className="flex h-[49px] w-full shrink-0 items-center gap-3 border-b border-[#dce4e2] bg-[#fbfcfc] px-[15px]"
    >
      {/* .map-search exact clone: width min(330px, 34vw), no border */}
      <div className="flex items-center gap-0 text-[#718783]" style={{ width: 'min(330px, 34vw)' }}>
        <Search size={13} className="shrink-0" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') onQueryChange(''); }}
          disabled={disabled}
          placeholder="Search route ID, name or any field..."
          aria-label="Search routes"
          className="w-full border-0 bg-transparent text-[#2e4a47] outline-none placeholder:text-[#95a4a1] disabled:cursor-not-allowed [&::-webkit-search-cancel-button]:hidden"
          style={{ height: '32px', padding: '0 8px', fontSize: '10.5px' }}
        />
        {query && (
          <button
            type="button"
            onClick={() => onQueryChange('')}
            aria-label="Clear search"
            className="grid shrink-0 place-items-center text-[#78908c] hover:text-[#2c4a47]"
            style={{ background: 'none', border: 0, cursor: 'pointer' }}
          >
            <X size={12} aria-hidden="true" />
          </button>
        )}
      </div>

      {/* .toolbar-divider */}
      <span className="h-5 w-px shrink-0 bg-[#dce4e2]" aria-hidden="true" />

      {/* .status-filter exact clone */}
      <div className="status-filter flex items-center gap-2 text-[#718783]">
        <label className="flex items-center gap-1 text-[#718783]">
          <span className="sr-only">Search in</span>
          <select
            value={field}
            onChange={(e) => {
              onFieldChange(e.target.value);
              onFilterValueChange('');
            }}
            disabled={disabled}
            className="cursor-pointer bg-transparent outline-none disabled:cursor-not-allowed disabled:text-[#a2b0ad]"
            style={{ color: '#536b67', border: 0, fontSize: '10px', fontWeight: 650, height: '30px', paddingLeft: '7px', minWidth: '100px', appearance: 'none' }}
          >
            {fields.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <ChevronDown size={11} className="shrink-0 text-[#78908c]" aria-hidden="true" />
        </label>

        {field !== ALL_COLUMNS && (
          <label className="flex items-center gap-1 text-[#718783]">
            <span className="sr-only">Filter by value</span>
            <select
              value={filterValue}
              onChange={(e) => onFilterValueChange(e.target.value)}
              disabled={disabled || columnValues.length === 0}
              className="cursor-pointer bg-transparent outline-none disabled:cursor-not-allowed disabled:text-[#a2b0ad]"
              style={{ color: '#536b67', border: 0, fontSize: '10px', fontWeight: 650, height: '30px', paddingLeft: '7px', minWidth: '100px', maxWidth: '180px', appearance: 'none' }}
            >
              <option value="">Any value</option>
              {columnValues.map((val) => (
                <option key={val} value={val}>
                  {val}
                </option>
              ))}
            </select>
            <ChevronDown size={11} className="shrink-0 text-[#78908c]" aria-hidden="true" />
          </label>
        )}
      </div>

      {/* .toolbar-count exact clone: ml-auto */}
      <span aria-live="polite" className="ml-auto shrink-0 whitespace-nowrap text-[#879793]" style={{ fontSize: '9.5px' }}>
        <strong className="text-[#174c4d]" style={{ fontSize: '11px' }}>{matchCount.toLocaleString()}</strong>
        {' / '}
        {totalCount.toLocaleString()} routes
      </span>
    </div>
  );
}

function SectionHeading({ id, number, title }: { id: string; number: string; title: string }) {
  return (
    <div className="flex items-baseline gap-2.5">
      <span className="font-mono text-[10px] font-bold text-[#0f9382]">{number}</span>
      <h3 id={id} className="pfc-section-title text-[11px] font-bold uppercase">
        {title}
      </h3>
    </div>
  );
}

function ProgressBar({ progress }: { progress: ProgressState }) {
  return (
    <div aria-live="polite" className="border border-[#cbe5dd] bg-[#f2faf7] p-3">
      <div className="mb-2 flex justify-between gap-3 text-[11px] text-[#395652]">
        <span>{progress.phase}</span>
        <span className="font-mono">{progress.percent}%</span>
      </div>
      <div className="h-1.5 overflow-hidden bg-[#dcece7]">
        <div
          className="h-full bg-[#139483] transition-[width] duration-300"
          style={{ width: `${progress.percent}%` }}
        />
      </div>
      {progress.total > 0 && (
        <p className="mt-2 truncate text-[10px] text-slate-500">
          {progress.done.toLocaleString()} / {progress.total.toLocaleString()} routes
          {progress.current ? ` | ${progress.current}` : ''}
        </p>
      )}
    </div>
  );
}

function Notice({
  kind,
  children,
}: {
  kind: 'error' | 'warning';
  children: React.ReactNode;
}) {
  return (
    <div
      role={kind === 'error' ? 'alert' : 'status'}
      className={`flex gap-2 rounded-md border px-3 py-2.5 text-[11px] leading-relaxed ${
        kind === 'error'
          ? 'border-red-200 bg-red-50 text-red-800'
          : 'border-amber-200 bg-amber-50 text-amber-800'
      }`}
    >
      <CircleAlert size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}
