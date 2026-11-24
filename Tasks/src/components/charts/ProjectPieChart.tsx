import { PieChart, Pie, Cell, Tooltip, Legend } from 'recharts';
import { ResponsiveContainer } from './ResponsiveContainer';
import { chartTooltipProps, projectPieLegendProps } from '../../lib/chartTheme';

export type PieChartDatum = { name: string; value: number };

interface ProjectPieChartProps {
  data: PieChartDatum[];
  getColor: (name: string, index: number) => string;
}

/** Donut chart with legend labels (no overlapping slice text). */
export default function ProjectPieChart({ data, getColor }: ProjectPieChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart margin={{ top: 12, right: 12, bottom: 12, left: 12 }}>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          cx="40%"
          cy="50%"
          innerRadius="52%"
          outerRadius="72%"
          paddingAngle={2}
          label={false}
          isAnimationActive={false}
        >
          {data.map((entry, index) => (
            <Cell key={entry.name} fill={getColor(entry.name, index)} stroke="var(--bg-surface)" strokeWidth={2} />
          ))}
        </Pie>
        <Tooltip
          {...chartTooltipProps}
          formatter={(value, name) => {
            const count = typeof value === 'number' ? value : 0;
            return [`${count} issue${count === 1 ? '' : 's'}`, String(name ?? '')];
          }}
        />
        <Legend {...projectPieLegendProps} />
      </PieChart>
    </ResponsiveContainer>
  );
}
