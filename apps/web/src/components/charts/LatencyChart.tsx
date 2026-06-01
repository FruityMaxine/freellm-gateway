import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartFrame } from './ChartFrame';

interface Props {
  data: Array<{ bucket: string; count: number }>;
}

export function LatencyChart({ data }: Props) {
  return (
    <ChartFrame title="Latency distribution" description="p50–p99 (ms)">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 0, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid stroke="var(--color-hairline)" strokeDasharray="3 3" />
          <XAxis dataKey="bucket" stroke="var(--color-muted)" tick={{ fontSize: 10 }} />
          <YAxis stroke="var(--color-muted)" tick={{ fontSize: 10 }} />
          <Tooltip
            contentStyle={{
              background: 'var(--color-surface-elevated)',
              border: '1px solid var(--color-hairline-strong)',
              borderRadius: 'var(--radius-md)',
              fontSize: 12,
            }}
          />
          <Bar dataKey="count" fill="var(--color-accent-cyan)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
