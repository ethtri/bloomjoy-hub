import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';

/** Loaded only when a detailed sales or partner chart is opened. */
export default function ReportingBarChart({ data, config, dataKey, valueFormatter }: {
  data: Array<Record<string, string | number | null>>; config: ChartConfig;
  dataKey: string; valueFormatter?: (value: number) => string;
}) {
  return <ChartContainer config={config} className="!aspect-auto h-[260px] w-full max-w-full sm:h-[320px]">
    <BarChart data={data} margin={valueFormatter ? { left: 8, right: 8 } : undefined}>
      <CartesianGrid vertical={false} />
      <XAxis dataKey="period" tickLine={false} axisLine={false} />
      <YAxis tickLine={false} axisLine={false} width={valueFormatter ? 64 : 56} tickFormatter={valueFormatter ? value => valueFormatter(Number(value)) : undefined} />
      <ChartTooltip content={<ChartTooltipContent formatter={valueFormatter ? value => valueFormatter(Number(value)) : undefined} />} />
      <Bar dataKey={dataKey} fill={`var(--color-${dataKey})`} radius={[5, 5, 0, 0]} isAnimationActive={false} />
    </BarChart>
  </ChartContainer>;
}
