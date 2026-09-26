import type { RouteFeature, Unit } from '../types';
import { fmt } from '../engine/distance';

export default function RouteDetails({
  route,
  unit,
}: {
  route: RouteFeature | null;
  unit: Unit;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
        Route Details
      </div>
      {!route ? (
        <div className="px-4 py-8 text-center text-[12px] text-slate-400">
          Select a route on the map or in the table to inspect it.
        </div>
      ) : (
        <div className="max-h-[420px] overflow-auto px-4 py-3">
          <Field label="Route ID" value={route.routeId} mono />
          <Field label="Route Name" value={route.routeName} />
          <Field label="Length" value={fmt(route.lengthM, unit)} big />
          <Field label="Geometry" value={route.geometryType} />
          <Field label="Vertices" value={route.vertices.toLocaleString()} />
          {route.segments.length > 1 && (
            <div className="mt-3">
              <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-400">
                Segments ({route.segments.length})
              </div>
              <div className="max-h-32 overflow-auto rounded border border-slate-100">
                {route.segmentLengths.map((l, i) => (
                  <div
                    key={i}
                    className="flex justify-between border-b border-slate-50 px-2 py-1 text-[11px] last:border-0"
                  >
                    <span className="text-slate-500">Segment {i + 1}</span>
                    <span className="font-mono text-slate-800">{fmt(l, unit)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {Object.keys(route.attributes).length > 0 && (
            <div className="mt-4 border-t border-slate-100 pt-3">
              <div className="mb-1.5 text-[10px] uppercase tracking-wider text-slate-400">
                Source Attributes
              </div>
              <div className="space-y-1">
                {Object.entries(route.attributes).map(([k, v]) => (
                  <div key={k} className="flex gap-2 text-[11.5px]">
                    <span className="w-28 shrink-0 truncate text-slate-500">{k}</span>
                    <span className="break-words text-slate-800">{String(v)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  mono,
  big,
}: {
  label: string;
  value: string;
  mono?: boolean;
  big?: boolean;
}) {
  return (
    <div className="mb-2.5">
      <div className="text-[10px] uppercase tracking-wider text-slate-400">{label}</div>
      <div
        className={`${big ? 'text-lg font-bold text-blue-700' : 'text-[13px] font-medium text-slate-900'} ${
          mono ? 'font-mono' : ''
        }`}
      >
        {value}
      </div>
    </div>
  );
}
