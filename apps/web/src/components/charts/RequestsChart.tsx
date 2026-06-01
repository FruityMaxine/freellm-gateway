import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartFrame } from './ChartFrame';

interface Props {
  data: Array<{ t: string; success: number; failed: number }>;
}

export function RequestsChart({ data }: Props) {
  return (
    <ChartFrame title="Requests · 24h" description="success vs. failed">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 0, right: 8, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id="ok" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.55} />
              <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="bad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-error)" stopOpacity={0.45} />
              <stop offset="100%" stopColor="var(--color-error)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--color-hairline)" strokeDasharray="3 3" />
          <XAxis dataKey="t" stroke="var(--color-muted)" tick={{ fontSize: 10 }} />
          <YAxis stroke="var(--color-muted)" tick={{ fontSize: 10 }} />
          <Tooltip
            contentStyle={{
              background: 'var(--color-surface-elevated)',
              border: '1px solid var(--color-hairline-strong)',
              borderRadius: 'var(--radius-md)',
              fontSize: 12,
            }}
          />
          <Area type="monotone" dataKey="success" stroke="var(--color-primary)" fill="url(#ok)" />
          <Area type="monotone" dataKey="failed" stroke="var(--color-error)" fill="url(#bad)" />
        </AreaChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
