/**
 * 模型评分维度雷达图（Tick 44 v1.7.16.0；组 6 Tick 4 v1.18.0.0 扩展多 series 叠加）。
 *
 * 把 ModelScore 的 9 个维度 (availability/latency/rateLimit/quality/context/
 * capability/freshness/cost/stability) 渲染成雷达图，直观看出模型在哪些维度强/弱。
 * 所有维度归一化到 0-1 范围，0.5 是中位，越靠外越好。
 *
 * 两种模式：
 *   - 单模型（向后兼容）：传 {scores, composite}，中心显示综合分。
 *   - 多模型叠加（组 6 Tick 4）：传 {series: [{name, scores, color}]}，多模型对比。
 */
import {
  Legend,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';

export interface ModelScoreDimensions {
  availabilityScore: number;
  latencyScore: number;
  rateLimitScore: number;
  qualityScore: number;
  contextScore: number;
  capabilityScore: number;
  freshnessScore: number;
  costScore: number;
  stabilityScore: number;
}

export interface RadarSeries {
  name: string;
  scores: ModelScoreDimensions;
  color: string;
}

interface Props {
  /** 单模型模式（向后兼容 Models.tsx）。 */
  scores?: ModelScoreDimensions;
  composite?: number | null;
  /** 多模型叠加对比模式（组 6 Tick 4 ModelCompare）。 */
  series?: RadarSeries[];
}

const DIMENSION_LABEL: Record<keyof ModelScoreDimensions, string> = {
  availabilityScore: '可用性',
  latencyScore: '延迟',
  rateLimitScore: '限流',
  qualityScore: '质量',
  contextScore: '上下文',
  capabilityScore: '能力',
  freshnessScore: '新鲜度',
  costScore: '成本',
  stabilityScore: '稳定性',
};

const DIMS = Object.keys(DIMENSION_LABEL) as Array<keyof ModelScoreDimensions>;
const TOOLTIP_STYLE = {
  background: 'var(--color-surface-elevated)',
  border: '1px solid var(--color-hairline-strong)',
  borderRadius: 'var(--radius-md)',
  fontSize: 12,
};

export function ModelScoreRadar({ scores, composite, series }: Props) {
  // 多 series 叠加模式（组 6 Tick 4）。
  if (series && series.length > 0) {
    const data = DIMS.map((key) => {
      const point: Record<string, number | string> = { dimension: DIMENSION_LABEL[key] };
      for (const s of series) point[s.name] = Math.max(0, Math.min(1, s.scores[key]));
      return point;
    });
    return (
      <div className="h-[360px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={data} margin={{ top: 8, right: 16, left: 16, bottom: 8 }}>
            <PolarGrid stroke="var(--color-hairline)" />
            <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 11, fill: 'var(--color-muted)' }} />
            <PolarRadiusAxis domain={[0, 1]} tick={{ fontSize: 9, fill: 'var(--color-muted)' }} tickCount={4} />
            {series.map((s) => (
              <Radar key={s.name} name={s.name} dataKey={s.name} stroke={s.color} fill={s.color} fillOpacity={0.12} />
            ))}
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => v.toFixed(2)} />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // 单模型模式（向后兼容）。
  if (!scores) return null;
  const data = DIMS.map((key) => ({
    dimension: DIMENSION_LABEL[key],
    value: Math.max(0, Math.min(1, scores[key])),
  }));
  return (
    <div className="relative h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} margin={{ top: 8, right: 16, left: 16, bottom: 8 }}>
          <PolarGrid stroke="var(--color-hairline)" />
          <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 11, fill: 'var(--color-muted)' }} />
          <PolarRadiusAxis domain={[0, 1]} tick={{ fontSize: 9, fill: 'var(--color-muted)' }} tickCount={4} />
          <Radar
            name="得分"
            dataKey="value"
            stroke="var(--color-primary)"
            fill="var(--color-primary)"
            fillOpacity={0.4}
          />
          <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [v.toFixed(2), '得分']} />
        </RadarChart>
      </ResponsiveContainer>
      {composite !== undefined && composite !== null && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
          <div className="text-[9px] uppercase tracking-wider text-[var(--color-muted)]">综合</div>
          <div className="tabular text-2xl font-semibold text-[var(--color-primary)]">
            {composite.toFixed(2)}
          </div>
        </div>
      )}
    </div>
  );
}
