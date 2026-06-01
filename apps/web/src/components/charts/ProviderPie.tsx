import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { ChartFrame } from './ChartFrame';

const COLORS = [
  'var(--color-primary)',
  'var(--color-accent-cyan)',
  'var(--color-accent-magenta)',
  'var(--color-accent-amber)',
  'var(--color-accent-violet)',
  'var(--color-accent-emerald)',
];

interface Props {
  data: Array<{ name: string; value: number }>;
}

export function ProviderPie({ data }: Props) {
  return (
    <ChartFrame title="Provider mix" description="requests · 24h">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius="55%"
            outerRadius="80%"
            paddingAngle={2}
            stroke="var(--color-canvas)"
            strokeWidth={2}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              background: 'var(--color-surface-elevated)',
              border: '1px solid var(--color-hairline-strong)',
              borderRadius: 'var(--radius-md)',
              fontSize: 12,
            }}
          />
        </PieChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
