/**
 * Tick 49 v1.7.21.0：错误率趋势图（Logs 页用）。
 *
 * 左轴 = 错误率（百分比，line: errorRate / clientErrorRate / serverErrorRate）
 * 右轴 = 失败请求总数（堆叠 area: 4xx + 5xx + null）
 * window 切换 1h / 24h / 7d 由父组件控制。
 */
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartFrame } from './ChartFrame';
import type { ErrorRateBucket, TimeseriesWindow } from '@/lib/admin-hooks';

interface Props {
  data: ErrorRateBucket[];
  window: TimeseriesWindow;
}

function formatTick(iso: string, window: TimeseriesWindow): string {
  const d = new Date(iso);
  if (window === '1h') {
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  }
  if (window === '24h') {
    return `${d.getHours().toString().padStart(2, '0')}:00`;
  }
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function formatPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

export function ErrorRateChart({ data, window }: Props) {
  const chartData = data.map((b) => ({
    ...b,
    label: formatTick(b.t, window),
  }));
  const titleMap: Record<TimeseriesWindow, string> = {
    '1h': '近 1 小时 · 每分钟',
    '24h': '近 24 小时 · 每小时',
    '7d': '近 7 天 · 每天',
  };
  return (
    <ChartFrame title="错误率趋势" description={titleMap[window]}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData} margin={{ top: 8, right: 16, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id="er-4xx" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-warning)" stopOpacity={0.45} />
              <stop offset="100%" stopColor="var(--color-warning)" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="er-5xx" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-error)" stopOpacity={0.55} />
              <stop offset="100%" stopColor="var(--color-error)" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="er-null" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-muted)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--color-muted)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--color-hairline)" strokeDasharray="3 3" />
          <XAxis dataKey="label" stroke="var(--color-muted)" tick={{ fontSize: 10 }} />
          <YAxis
            yAxisId="left"
            stroke="var(--color-error)"
            tick={{ fontSize: 10 }}
            tickFormatter={formatPct}
            domain={[0, 'auto']}
            label={{ value: '错误率', position: 'insideTopLeft', fontSize: 10, fill: 'var(--color-muted)' }}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            stroke="var(--color-muted)"
            tick={{ fontSize: 10 }}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--color-surface-elevated)',
              border: '1px solid var(--color-hairline-strong)',
              borderRadius: 'var(--radius-md)',
              fontSize: 12,
            }}
            formatter={(value: number, name: string) => {
              if (name === 'errorRate' || name === 'clientErrorRate' || name === 'serverErrorRate') {
                return [formatPct(value), nameLabel(name)];
              }
              return [value, nameLabel(name)];
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Area
            yAxisId="right"
            type="monotone"
            dataKey="status4xx"
            stackId="err"
            stroke="var(--color-warning)"
            fill="url(#er-4xx)"
            name="status4xx"
          />
          <Area
            yAxisId="right"
            type="monotone"
            dataKey="status5xx"
            stackId="err"
            stroke="var(--color-error)"
            fill="url(#er-5xx)"
            name="status5xx"
          />
          <Area
            yAxisId="right"
            type="monotone"
            dataKey="statusNull"
            stackId="err"
            stroke="var(--color-muted)"
            fill="url(#er-null)"
            name="statusNull"
          />
          <Line
            yAxisId="left"
            type="monotone"
            dataKey="errorRate"
            stroke="var(--color-error)"
            strokeWidth={2}
            dot={false}
            name="errorRate"
          />
          <Line
            yAxisId="left"
            type="monotone"
            dataKey="serverErrorRate"
            stroke="var(--color-warning)"
            strokeWidth={1.5}
            strokeDasharray="4 2"
            dot={false}
            name="serverErrorRate"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

function nameLabel(k: string): string {
  switch (k) {
    case 'errorRate':
      return '错误率(总)';
    case 'clientErrorRate':
      return '4xx 率';
    case 'serverErrorRate':
      return '5xx 率';
    case 'status4xx':
      return '4xx 请求';
    case 'status5xx':
      return '5xx 请求';
    case 'statusNull':
      return '无 status';
    default:
      return k;
  }
}
