/**
 * Dashboard 时间序列双轴图（Tick 32 v1.7.4.0）。
 *
 * 左轴 = 请求次数（堆叠 area: success + failed）
 * 右轴 = 估算 cost（line, USD）
 * window 切换由父组件控制（按钮组 1h / 24h / 7d）。
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
import type { TimeseriesBucket, TimeseriesWindow } from '@/lib/admin-hooks';

interface Props {
  data: TimeseriesBucket[];
  window: TimeseriesWindow;
}

/** 把 bucket 起始 ISO 时间格式化成轴标签（按窗口粒度选格式）。 */
function formatTick(iso: string, window: TimeseriesWindow): string {
  const d = new Date(iso);
  if (window === '1h') {
    return `${d.getHours().toString().padStart(2, '0')}:${d
      .getMinutes()
      .toString()
      .padStart(2, '0')}`;
  }
  if (window === '24h') {
    return `${d.getHours().toString().padStart(2, '0')}:00`;
  }
  // 7d
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function TimeseriesChart({ data, window }: Props) {
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
    <ChartFrame title="请求与成本趋势" description={titleMap[window]}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData} margin={{ top: 8, right: 16, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id="ts-ok" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.55} />
              <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="ts-bad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-error)" stopOpacity={0.45} />
              <stop offset="100%" stopColor="var(--color-error)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--color-hairline)" strokeDasharray="3 3" />
          <XAxis dataKey="label" stroke="var(--color-muted)" tick={{ fontSize: 10 }} />
          <YAxis
            yAxisId="left"
            stroke="var(--color-muted)"
            tick={{ fontSize: 10 }}
            label={{
              value: '请求',
              position: 'insideTopLeft',
              fontSize: 10,
              fill: 'var(--color-muted)',
            }}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            stroke="var(--color-warning)"
            tick={{ fontSize: 10 }}
            tickFormatter={(v: number) => `$${v.toFixed(v < 0.01 ? 4 : 2)}`}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--color-surface-elevated)',
              border: '1px solid var(--color-hairline-strong)',
              borderRadius: 'var(--radius-md)',
              fontSize: 12,
            }}
            formatter={(value: number, name: string) => {
              if (name === 'cost') return [`$${value.toFixed(value < 0.01 ? 4 : 4)}`, '成本'];
              if (name === 'success') return [value, '成功'];
              if (name === 'failed') return [value, '失败'];
              return [value, name];
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Area
            yAxisId="left"
            type="monotone"
            dataKey="success"
            stackId="r"
            stroke="var(--color-primary)"
            fill="url(#ts-ok)"
            name="success"
          />
          <Area
            yAxisId="left"
            type="monotone"
            dataKey="failed"
            stackId="r"
            stroke="var(--color-error)"
            fill="url(#ts-bad)"
            name="failed"
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="costUsd"
            stroke="var(--color-warning)"
            strokeWidth={2}
            dot={false}
            name="cost"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
