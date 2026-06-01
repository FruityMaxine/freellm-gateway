import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartFrame } from './ChartFrame';

interface Props {
  data: Array<{ family: string; free: number; paid: number }>;
}

export function ModelMixBar({ data }: Props) {
  return (
    <ChartFrame title="Model families" description="free vs paid count">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, left: 20, bottom: 0 }}>
          <CartesianGrid stroke="var(--color-hairline)" strokeDasharray="3 3" />
          <XAxis type="number" stroke="var(--color-muted)" tick={{ fontSize: 10 }} />
          <YAxis dataKey="family" type="category" stroke="var(--color-muted)" tick={{ fontSize: 11 }} width={80} />
          <Tooltip
            contentStyle={{
              background: 'var(--color-surface-elevated)',
              border: '1px solid var(--color-hairline-strong)',
              borderRadius: 'var(--radius-md)',
              fontSize: 12,
            }}
          />
          <Bar dataKey="free" fill="var(--color-primary)" stackId="x" radius={[0, 0, 0, 4]} />
          <Bar dataKey="paid" fill="var(--color-accent-violet)" stackId="x" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
