'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { TrendPointDto } from '@opspilot/types';

// Palette validated with the dataviz six-checks script against surface
// #0b0f14 (dark): lightness band, chroma, CVD separation, contrast all pass.
const COLOR = {
  opened: '#d97706', // amber-600
  resolved: '#059669', // emerald-600
  succeeded: '#059669',
  failed: '#ef4444', // red-500
};

const GRID = '#1e293b'; // slate-800 — recessive
const INK_MUTED = '#64748b'; // slate-500 — axis text

/** Union of series days → one row per day with zero-fill, oldest first. */
function mergeByDay(
  a: TrendPointDto[],
  b: TrendPointDto[],
  aKey: string,
  bKey: string,
): Record<string, string | number>[] {
  const days = new Map<string, Record<string, string | number>>();
  for (const p of a) days.set(p.day, { day: p.day, [aKey]: p.count, [bKey]: 0 });
  for (const p of b) {
    const row = days.get(p.day) ?? { day: p.day, [aKey]: 0 };
    row[bKey] = p.count;
    days.set(p.day, row);
  }
  return [...days.values()].sort((x, y) => String(x.day).localeCompare(String(y.day)));
}

const tooltipStyle = {
  backgroundColor: '#0f172a',
  border: '1px solid #334155',
  borderRadius: 6,
  fontSize: 12,
  color: '#e6edf3',
};

const shortDay = (day: string) => day.slice(5); // "2026-07-08" → "07-08"

function ChartFrame({ title, children }: { title: string; children: React.ReactElement }) {
  return (
    <div className="rounded-lg border border-slate-800 p-4">
      <h3 className="text-xs uppercase tracking-wider text-slate-500">{title}</h3>
      <div className="mt-3 h-56">
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function IncidentTrendChart({
  opened,
  resolved,
}: {
  opened: TrendPointDto[];
  resolved: TrendPointDto[];
}) {
  const data = mergeByDay(opened, resolved, 'opened', 'resolved');
  return (
    <ChartFrame title="Incidents — opened vs resolved, last 30 days">
      <LineChart data={data} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="day" tickFormatter={shortDay} tick={{ fill: INK_MUTED, fontSize: 11 }} tickLine={false} axisLine={{ stroke: GRID }} />
        <YAxis allowDecimals={false} tick={{ fill: INK_MUTED, fontSize: 11 }} tickLine={false} axisLine={false} />
        <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: INK_MUTED }} cursor={{ stroke: GRID }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line type="monotone" dataKey="opened" stroke={COLOR.opened} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
        <Line type="monotone" dataKey="resolved" stroke={COLOR.resolved} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
      </LineChart>
    </ChartFrame>
  );
}

export function DeployTrendChart({
  succeeded,
  failed,
}: {
  succeeded: TrendPointDto[];
  failed: TrendPointDto[];
}) {
  const data = mergeByDay(succeeded, failed, 'succeeded', 'failed');
  return (
    <ChartFrame title="Deployments — outcomes, last 30 days">
      <BarChart data={data} margin={{ top: 4, right: 8, left: -24, bottom: 0 }} barCategoryGap="25%">
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="day" tickFormatter={shortDay} tick={{ fill: INK_MUTED, fontSize: 11 }} tickLine={false} axisLine={{ stroke: GRID }} />
        <YAxis allowDecimals={false} tick={{ fill: INK_MUTED, fontSize: 11 }} tickLine={false} axisLine={false} />
        <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: INK_MUTED }} cursor={{ fill: '#1e293b55' }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {/* 2px surface gap between stacked segments per the mark spec */}
        <Bar dataKey="succeeded" stackId="a" fill={COLOR.succeeded} stroke="#0b0f14" strokeWidth={1} />
        <Bar dataKey="failed" stackId="a" fill={COLOR.failed} stroke="#0b0f14" strokeWidth={1} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ChartFrame>
  );
}
