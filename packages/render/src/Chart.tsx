import type { ReactNode } from 'react';
import type { ChartBlock } from '../../core/src/model';

// Categorical series colours, in fixed order. The page (app tokens or the exported document's :root) supplies
// --series-N with light/dark steps; the hex fallbacks keep the chart readable anywhere those variables are absent.
const seriesFallback = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const colors = seriesFallback.map((hex, index) => `var(--series-${index + 1}, ${hex})`);
export function ChartRead({ block, locale, renderText }: { block: ChartBlock; locale: 'zh-CN' | 'en'; renderText?: (nodeId: string, field: 'title' | 'label' | 'name', value: string) => ReactNode }) {
  const data = block.series.map((series) => ({ ...series, data: block.categories.map((category) => series.values[category.id] ?? null) }));
  const values = data.flatMap((series) => series.data).filter((value): value is number => value !== null && Number.isFinite(value));
  const min = Math.min(0, ...values); const max = Math.max(0, ...values); const span = max - min || 1;
  const y = (value: number) => 220 - (value - min) / span * 190;
  const width = 500 / Math.max(block.categories.length, 1);
  const x = (index: number) => 60 + width * (index + .5);
  const zero = y(0);
  const format = (value: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
  const pieData = data[0]?.data ?? [];
  const total = pieData.reduce<number>((sum, value) => sum + Math.max(0, value ?? 0), 0);
  let angle = -Math.PI / 2;
  return <figure className="chart-card read-chart hcd-block hcd-chart-wrap" data-block-id={block.id} data-hcd-block-id={renderText ? block.id : undefined}>
    <figcaption className="chart-title">{block.title ? renderText ? renderText(block.id, 'title', block.title) : block.title : (locale === 'zh-CN' ? '图表' : 'Chart')} {block.unit && <small>({block.unit})</small>}</figcaption>
    {values.length === 0 ? <p>{locale === 'zh-CN' ? '暂无数据' : 'No data'}</p> : <svg className="read-chart-svg" viewBox="0 0 600 265" role="img" aria-label={block.title || (locale === 'zh-CN' ? '图表' : 'Chart')}>
      <desc>{data.map((series) => `${series.name}: ${block.categories.map((category, i) => `${category.label} ${series.data[i] ?? '—'}`).join(', ')}`).join('; ')}</desc>
      {block.kind === 'pie' ? <g>{total === 0 && <circle cx="300" cy="125" r="95" fill="none" stroke="currentColor" opacity=".2"/>}{pieData.map((raw, index) => {
        const value = Math.max(0, raw ?? 0); if (!value || !total) return null;
        const start = angle; angle += value / total * Math.PI * 2;
        const label = `${block.categories[index]!.label}: ${format(value)} ${block.unit}`;
        if (value === total) return <circle key={index} cx="300" cy="125" r="95" fill={colors[index % colors.length]}><title>{label}</title></circle>;
        const point = (a: number) => `${300 + 95 * Math.cos(a)} ${125 + 95 * Math.sin(a)}`;
        return <path key={index} d={`M 300 125 L ${point(start)} A 95 95 0 ${angle - start > Math.PI ? 1 : 0} 1 ${point(angle)} Z`} fill={colors[index % colors.length]}><title>{label}</title></path>;
      })}</g> : <>
        {[0, 1, 2, 3, 4].map((i) => { const value = min + span * i / 4; return <g key={i}><line x1="60" x2="560" y1={y(value)} y2={y(value)} className="chart-gridline"/><text x="52" y={y(value) + 4} textAnchor="end">{format(value)}</text></g>; })}
        <line x1="60" x2="560" y1={zero} y2={zero} className="chart-zero" data-baseline-y={zero}/>
        {block.categories.map((category, i) => <text key={category.id} x={x(i)} y="244" textAnchor="middle">{category.label.length > 12 ? `${category.label.slice(0, 11)}…` : category.label}</text>)}
        {data.map((series, seriesIndex) => {
          const color = colors[seriesIndex % colors.length];
          if (block.kind === 'line') {
            let connected = false;
            const path = series.data.map((value, i) => { if (value === null) { connected = false; return ''; } const command = connected ? 'L' : 'M'; connected = true; return `${command} ${x(i)} ${y(value)}`; }).join(' ');
            return <g key={series.id} data-series={series.name}><path data-line="true" d={path} fill="none" stroke={color} strokeWidth="2"/>{series.data.map((value, i) => value === null ? null : <circle key={i} cx={x(i)} cy={y(value)} r="3" fill={color}><title>{`${series.name}: ${block.categories[i]!.label} ${format(value)}`}</title></circle>)}</g>;
          }
          const barWidth = width * .7 / Math.max(1, data.length);
          return <g key={series.id} data-series={series.name}>{series.data.map((value, i) => value === null ? null : <rect key={i} data-value={value} x={x(i) - width * .35 + seriesIndex * barWidth} y={Math.min(zero, y(value))} width={Math.max(.5, barWidth - 1)} height={Math.abs(y(value) - zero)} fill={color}><title>{`${series.name}: ${block.categories[i]!.label} ${format(value)}`}</title></rect>)}</g>;
        })}
      </>}
    </svg>}
    <ul className="read-chart-legend">{(block.kind === 'pie' ? block.categories.map(category => ({ id: category.id, field: 'label' as const, value: category.label })) : data.map(series => ({ id: series.id, field: 'name' as const, value: series.name }))).map((item, i) => <li key={item.id} data-hcd-block-id={renderText ? item.id : undefined}><i style={{ background: colors[i % colors.length] }}/>{renderText ? renderText(item.id, item.field, item.value) : item.value}</li>)}</ul>
    {block.kind === 'pie' && values.some((value) => value < 0) && <p className="chart-data-note">{locale === 'zh-CN' ? '饼图只绘制正值，负值保留在数据表中。' : 'Pie slices show positive values. Negative values remain in the data table.'}</p>}
    <details className="chart-data"><summary>{locale === 'zh-CN' ? '查看数据' : 'View data'}</summary><div className="table-scroll"><table><thead><tr><th>{locale === 'zh-CN' ? '分类' : 'Category'}</th>{data.map((series) => <th key={series.id} data-hcd-block-id={renderText ? series.id : undefined}>{renderText ? renderText(series.id, 'name', series.name) : series.name}</th>)}</tr></thead><tbody>{block.categories.map((category, i) => <tr key={category.id} data-hcd-block-id={renderText ? category.id : undefined}><th scope="row">{renderText ? renderText(category.id, 'label', category.label) : category.label}</th>{data.map((series) => <td key={series.id}>{series.data[i] === null ? '—' : format(series.data[i]!)} {block.unit}</td>)}</tr>)}</tbody></table></div></details>
  </figure>;
}

