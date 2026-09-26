import type { RouteFeature, Unit } from '../types';
import { fmt } from '../engine/distance';

interface Props {
  routes: RouteFeature[];
  unit: Unit;
  selected?: RouteFeature | null;
  /** True when `routes` is the result of a search filter. */
  filtered?: boolean;
}

interface Card {
  label: string;
  value: string;
  detail: string;
  accent?: boolean;
}

export default function SummaryCards({ routes, unit, selected, filtered = false }: Props) {
  let total = 0;
  let longest: RouteFeature | null = null;
  let shortest: RouteFeature | null = null;

  for (const route of routes) {
    total += route.lengthM;
    if (!longest || route.lengthM > longest.lengthM) longest = route;
    if (!shortest || route.lengthM < shortest.lengthM) shortest = route;
  }

  if (!longest || !shortest) return null;

  const totalCards: Card[] = [
    {
      label: 'Routes',
      value: routes.length.toLocaleString(),
      detail: filtered ? 'Matching filter' : 'Calculated',
    },
    {
      label: 'Total distance',
      value: fmt(total, unit),
      detail: filtered ? 'Across matching routes' : 'Across all routes',
      accent: true,
    },
    { label: 'Average route', value: fmt(total / routes.length, unit), detail: 'Per route' },
    { label: 'Longest route', value: fmt(longest.lengthM, unit), detail: longest.routeId },
    { label: 'Shortest route', value: fmt(shortest.lengthM, unit), detail: shortest.routeId },
  ];

  const selectedCards: Card[] = selected
    ? [
        { label: 'Route ID', value: selected.routeId, detail: 'Selected route' },
        {
          label: 'Route name',
          value: selected.routeName,
          detail: /^ROUTE\d+$/.test(selected.routeName) ? 'Auto-assigned' : 'From source',
        },
        {
          label: 'Length',
          value: fmt(selected.lengthM, unit),
          detail: 'Follows every vertex',
        },
        {
          label: 'Geometry',
          value: selected.geometryType,
          detail: `${selected.segments.length} ${selected.segments.length === 1 ? 'segment' : 'segments'}`,
        },
        {
          label: 'Vertices',
          value: selected.vertices.toLocaleString(),
          detail: 'Points on route',
        },
        ...Object.entries(selected.attributes).map(([key, value]) => ({
          label: key,
          value: String(value),
          detail: 'Attribute',
        })),
      ]
    : [];

  return (
    <>
      {/* Compact stacked rows (mobile) — totals, or just the selected route. */}
      <div className="border border-[#dce5e2] bg-white lg:hidden">
        {!selected ? (
          <dl className="divide-y divide-[#e6ecea]">
            {totalCards.map((card) => (
              <div key={card.label} className="flex min-h-6 items-center justify-between gap-2 px-2.5 py-0.5">
                <dt className="min-w-0 text-[9px] font-bold uppercase tracking-[0.06em] text-[#526b68]">
                  {card.label}
                  <span className="ml-1.5 font-normal normal-case tracking-normal text-[#849692]">
                    {card.detail}
                  </span>
                </dt>
                <dd
                  className={`shrink-0 whitespace-nowrap text-right font-mono text-[11px] font-semibold sm:text-[12px] ${
                    card.accent ? 'text-[#0f8274]' : 'text-[#132629]'
                  }`}
                >
                  {card.value}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <dl className="divide-y divide-[#e6ecea]">
            {selectedCards.map((card) => (
              <div key={card.label} className="flex min-h-6 items-center justify-between gap-2 px-2.5 py-0.5">
                <dt className="min-w-0 text-[9px] font-bold uppercase tracking-[0.06em] text-[#526b68]">
                  {card.label}
                  <span className="ml-1.5 font-normal normal-case tracking-normal text-[#849692]">
                    {card.detail}
                  </span>
                </dt>
                <dd className="shrink-0 whitespace-nowrap text-right font-mono text-[11px] font-semibold text-[#132629] sm:text-[12px]">
                  {card.value}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      {/* Desktop: metric cards — totals, or the selected route in the same card format. */}
      {!selected ? (
        <div className="hidden gap-2.5 lg:grid lg:grid-cols-3 xl:grid-cols-5">
          {totalCards.map((card) => (
            <MetricCard key={card.label} card={card} />
          ))}
        </div>
      ) : (
        <div className="hidden gap-2.5 lg:grid lg:grid-cols-3 xl:grid-cols-5">
          {selectedCards.map((card) => (
            <MetricCard key={card.label} card={card} />
          ))}
        </div>
      )}
    </>
  );
}

function MetricCard({ card }: { card: Card }) {
  return (
    <div className="min-w-0 border border-[#dce5e2] bg-white px-3 py-2.5">
      <div className="truncate text-[9px] font-bold uppercase tracking-[0.09em] text-[#78918b]" title={card.label}>
        {card.label}
      </div>
      <div
        className={`mt-1 truncate font-mono text-[16px] font-semibold tracking-tight ${
          card.accent ? 'text-[#0f8274]' : 'text-[#132629]'
        }`}
        title={card.value}
      >
        {card.value}
      </div>
      <div className="mt-0.5 truncate text-[10px] text-[#849692]" title={card.detail}>
        {card.detail}
      </div>
    </div>
  );
}
