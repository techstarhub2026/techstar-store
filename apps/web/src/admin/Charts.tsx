import { useMemo, useState } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Table2, TrendingUp } from 'lucide-react';

/**
 * Chart primitives for the admin.
 *
 * Colour follows the validated categorical order (blue, orange, aqua, yellow,
 * magenta, green) — assigned in fixed slot order and never cycled, so a series
 * keeps its colour when a filter changes the series count. Three of these slots
 * fall below 3:1 against the white card surface, so every chart here ships
 * visible labels, a legend and a "Table" view as the required relief.
 *
 * One axis, always: revenue (money) and orders (a count) are never plotted on
 * two y-scales — the dashboard chart switches metric instead.
 */
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'] as const;

const INK = '#212529';
const INK_MUTED = '#8b98a2';
const GRID = '#eceff1';
const AXIS = '#d8dee3';
const SURFACE = '#ffffff';

const axisProps = {
  stroke: AXIS,
  tick: { fill: INK_MUTED, fontSize: 11 },
  tickLine: false,
} as const;

function compact(n: number) {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

export function ChartTooltip({ active, payload, label, money }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: SURFACE, border: '1px solid var(--ts-border)', borderRadius: 6,
      boxShadow: '0 4px 12px rgba(16,24,32,0.12)', padding: '8px 10px', fontSize: 12.5,
    }}>
      <div style={{ fontWeight: 700, marginBottom: 4, color: INK }}>{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey ?? p.name} className="d-flex align-items-center gap-2" style={{ color: INK }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: p.color ?? p.fill, flexShrink: 0 }} />
          <span style={{ color: '#4a5560' }}>{p.name}</span>
          <strong style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>
            {money ? `TZS ${Number(p.value).toLocaleString()}` : Number(p.value).toLocaleString()}
          </strong>
        </div>
      ))}
    </div>
  );
}

/** Wraps any chart with a heading and a chart/table toggle (the contrast relief). */
export function ChartCard({
  title,
  subtitle,
  action,
  table,
  children,
  height = 260,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  table?: React.ReactNode;
  children: React.ReactNode;
  height?: number;
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  return (
    <div className="ts-chartcard">
      <div className="ts-chartcard__head">
        <div>
          <h3 className="ts-chartcard__title">{title}</h3>
          {subtitle ? <p className="ts-chartcard__sub">{subtitle}</p> : null}
        </div>
        <div className="d-flex align-items-center gap-2 flex-wrap">
          {action}
          {table ? (
            <div className="ts-segmented" role="group" aria-label="View as">
              <button type="button" className={view === 'chart' ? 'is-on' : ''}
                onClick={() => setView('chart')} aria-pressed={view === 'chart'}>
                <TrendingUp size={13} /> Chart
              </button>
              <button type="button" className={view === 'table' ? 'is-on' : ''}
                onClick={() => setView('table')} aria-pressed={view === 'table'}>
                <Table2 size={13} /> Table
              </button>
            </div>
          ) : null}
        </div>
      </div>
      {view === 'chart' ? (
        <div style={{ width: '100%', height }}>{children}</div>
      ) : (
        <div className="ts-table__wrap" style={{ maxHeight: height, overflowY: 'auto' }}>{table}</div>
      )}
    </div>
  );
}

/** Revenue/orders over time. One measure at a time — never a dual axis. */
export function TrendChart({
  data,
  metric,
  money = false,
}: {
  data: { bucket: string; value: number }[];
  metric: string;
  money?: boolean;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="ts-trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={SERIES[0]} stopOpacity={0.28} />
            <stop offset="100%" stopColor={SERIES[0]} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="bucket" {...axisProps} minTickGap={24} />
        <YAxis {...axisProps} width={54} tickFormatter={compact} />
        <Tooltip content={<ChartTooltip money={money} />} cursor={{ stroke: AXIS, strokeWidth: 1 }} />
        <Area
          type="monotone" dataKey="value" name={metric}
          stroke={SERIES[0]} strokeWidth={2} fill="url(#ts-trend-fill)"
          dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: SURFACE }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Two money measures on one scale — legitimate to compare directly. */
export function GroupedBars({
  data,
  keys,
  money = true,
}: {
  data: Record<string, any>[];
  keys: { key: string; label: string }[];
  money?: boolean;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="bucket" {...axisProps} minTickGap={20} />
        <YAxis {...axisProps} width={54} tickFormatter={compact} />
        <Tooltip content={<ChartTooltip money={money} />} cursor={{ fill: 'rgba(16,24,32,0.04)' }} />
        <Legend wrapperStyle={{ fontSize: 12, color: INK }} iconType="square" iconSize={9} />
        {keys.map((k, i) => (
          <Bar key={k.key} dataKey={k.key} name={k.label} fill={SERIES[i]} radius={[4, 4, 0, 0]} maxBarSize={34} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Composition — a donut with the total in the middle and a labelled legend. */
export function DonutChart({
  data,
  money = false,
  centreLabel,
}: {
  data: { name: string; value: number }[];
  money?: boolean;
  centreLabel?: string;
}) {
  const total = useMemo(() => data.reduce((s, d) => s + d.value, 0), [data]);
  if (!total) return <div className="ts-empty" style={{ padding: 24 }}>Nothing to chart yet.</div>;

  return (
    <div className="d-flex align-items-center gap-3 flex-wrap h-100">
      <div style={{ width: 190, height: 190, position: 'relative', flexShrink: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data} dataKey="value" nameKey="name"
              innerRadius={58} outerRadius={88} paddingAngle={2}
              stroke={SURFACE} strokeWidth={2}
            >
              {data.map((_, i) => <Cell key={i} fill={SERIES[i % SERIES.length]} />)}
            </Pie>
            <Tooltip content={<ChartTooltip money={money} />} />
          </PieChart>
        </ResponsiveContainer>
        <div style={{
          position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
          pointerEvents: 'none', textAlign: 'center',
        }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: INK }}>
              {money ? compact(total) : total.toLocaleString()}
            </div>
            <div style={{ fontSize: 10.5, color: INK_MUTED, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {centreLabel ?? 'Total'}
            </div>
          </div>
        </div>
      </div>

      {/* Legend doubles as the value labels — the relief for sub-3:1 slots. */}
      <ul className="ts-legend">
        {data.map((d, i) => (
          <li key={d.name}>
            <span className="ts-legend__swatch" style={{ background: SERIES[i % SERIES.length] }} />
            <span className="ts-legend__name">{d.name}</span>
            <span className="ts-legend__value">
              {money ? `TZS ${d.value.toLocaleString()}` : d.value.toLocaleString()}
              <small>{Math.round((d.value / total) * 100)}%</small>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Ranked magnitude — horizontal bars read long category names best. */
export function RankedBars({
  data,
  money = false,
}: {
  data: { name: string; value: number }[];
  money?: boolean;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID} horizontal={false} />
        <XAxis type="number" {...axisProps} tickFormatter={compact} />
        <YAxis type="category" dataKey="name" {...axisProps} width={128} />
        <Tooltip content={<ChartTooltip money={money} />} cursor={{ fill: 'rgba(16,24,32,0.04)' }} />
        <Bar dataKey="value" name={money ? 'Revenue' : 'Units'} fill={SERIES[0]} radius={[0, 4, 4, 0]} maxBarSize={22} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** A plain multi-series line — used where every series shares one unit. */
export function MultiLine({
  data,
  keys,
  money = false,
}: {
  data: Record<string, any>[];
  keys: { key: string; label: string }[];
  money?: boolean;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="bucket" {...axisProps} minTickGap={24} />
        <YAxis {...axisProps} width={54} tickFormatter={compact} />
        <Tooltip content={<ChartTooltip money={money} />} cursor={{ stroke: AXIS, strokeWidth: 1 }} />
        <Legend wrapperStyle={{ fontSize: 12 }} iconType="plainline" iconSize={14} />
        {keys.map((k, i) => (
          <Line
            key={k.key} type="monotone" dataKey={k.key} name={k.label}
            stroke={SERIES[i]} strokeWidth={2} dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: SURFACE }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
