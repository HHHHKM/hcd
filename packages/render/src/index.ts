import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChartRead } from './Chart';
import type { Block, Document, Inline, LeafBlock, Module } from '../../core/src/model';

export type RenderOptions = {
  locale?: 'zh-CN' | 'en';
  version?: number;
  exportedAt?: string;
  includePending?: boolean;
  localPreview?: boolean;
  assetUrl?: (id: string) => string | null;
  rawSource?: (id: string) => string | null;
  allowRawScripts?: boolean;
};

const esc = (value: unknown): string => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const attr = (value: unknown): string => esc(value).replaceAll('`', '&#96;');
function safeHref(value: string): string | null {
  try {
    const url = new URL(value);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}
function safeImageSrc(value: string | null): string | null {
  if (!value || value.startsWith('//')) return null;
  if (/^(?:\/|\.\/|\.\.\/|[a-z0-9_-]+\/)/i.test(value)) return value;
  if (/^data:image\/(?:png|jpeg|gif|webp|avif|svg\+xml);base64,[a-z0-9+/]+=*$/i.test(value)) return value;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

export function renderInlineHtml(inline: Inline): string {
  return inline.map((part) => {
    if ('br' in part) return '<br>';
    let value = esc(part.t);
    if (part.code) value = `<code>${value}</code>`;
    if (part.b) value = `<strong>${value}</strong>`;
    if (part.i) value = `<em>${value}</em>`;
    if (part.sup) value = `<sup>${value}</sup>`;
    if (part.sub) value = `<sub>${value}</sub>`;
    const href = part.href ? safeHref(part.href) : null;
    if (href) value = `<a href="${attr(href)}" target="_blank" rel="noopener noreferrer nofollow">${value}</a>`;
    return value;
  }).join('');
}

function renderLeaf(block: LeafBlock, options: RenderOptions): string {
  switch (block.type) {
    case 'heading': return `<h${block.level} class="hcd-block hcd-heading" data-block-id="${attr(block.id)}">${renderInlineHtml(block.text)}</h${block.level}>`;
    case 'paragraph': return `<p class="hcd-block hcd-paragraph" data-block-id="${attr(block.id)}">${renderInlineHtml(block.text)}</p>`;
    case 'quote': return `<blockquote class="hcd-block hcd-quote" data-block-id="${attr(block.id)}">${renderInlineHtml(block.text)}</blockquote>`;
    case 'divider': return `<hr class="hcd-block hcd-divider" data-block-id="${attr(block.id)}">`;
    case 'callout': return `<aside class="hcd-block hcd-callout hcd-tone-${block.tone}" data-block-id="${attr(block.id)}">${block.title ? `<h3>${esc(block.title)}</h3>` : ''}<div>${renderInlineHtml(block.text)}</div></aside>`;
    case 'list': {
      const tag = block.ordered ? 'ol' : 'ul';
      const items = (values: typeof block.items): string => values.map((item) => `<li data-node-id="${attr(item.id)}">${renderInlineHtml(item.text)}${item.items.length ? `<${tag}>${items(item.items)}</${tag}>` : ''}</li>`).join('');
      return `<${tag} class="hcd-block hcd-list" data-block-id="${attr(block.id)}">${items(block.items)}</${tag}>`;
    }
    case 'image': {
      const url = block.asset ? safeImageSrc(options.assetUrl?.(block.asset) ?? null) : null;
      return `<figure class="hcd-block hcd-image hcd-image-${block.width}" data-block-id="${attr(block.id)}">${url ? `<img src="${attr(url)}" alt="${attr(block.alt)}">` : `<div class="hcd-image-missing" role="img" aria-label="${attr(block.alt)}">${esc(block.alt || 'Image')}</div>`}${block.caption ? `<figcaption>${esc(block.caption)}</figcaption>` : ''}</figure>`;
    }
    case 'table': return `<figure class="hcd-block hcd-table-wrap" data-block-id="${attr(block.id)}"><table><caption>${esc(block.caption)}</caption><thead><tr>${block.columns.map((column) => `<th scope="col" style="text-align:${column.align}">${renderInlineHtml(column.header)}</th>`).join('')}</tr></thead><tbody>${block.rows.map((row) => `<tr>${block.columns.map((column) => `<td style="text-align:${column.align}">${renderInlineHtml(row.cells[column.id] ?? [])}</td>`).join('')}</tr>`).join('')}</tbody></table></figure>`;
    case 'chart': return renderToStaticMarkup(createElement(ChartRead, { block, locale: options.locale ?? 'zh-CN' }));
    case 'timeline': return `<ol class="hcd-block hcd-timeline" data-block-id="${attr(block.id)}">${block.items.map((item) => `<li data-node-id="${attr(item.id)}"><span class="hcd-timeline-label">${esc(item.label)}</span><div><h3>${esc(item.title)}</h3><p>${renderInlineHtml(item.text)}</p></div></li>`).join('')}</ol>`;
    case 'kpis': return `<div class="hcd-block hcd-kpis" data-block-id="${attr(block.id)}">${block.items.map((item) => `<article class="hcd-kpi hcd-kpi-${item.tone}" data-node-id="${attr(item.id)}"><span>${esc(item.label)}</span><strong>${esc(item.value)}</strong><small>${esc(item.delta)}</small></article>`).join('')}</div>`;
    case 'raw': {
      const source = options.rawSource?.(block.asset);
      const safe = source === null || source === undefined ? '' : source;
      // srcdoc is escaped as an HTML attribute and always sandboxed; same-origin is never granted.
      const sandbox = block.allowScripts && options.allowRawScripts ? 'allow-scripts' : '';
      return `<iframe class="hcd-block hcd-raw" data-block-id="${attr(block.id)}" title="${attr(block.note || 'Embedded content')}" srcdoc="${attr(safe)}" sandbox="${sandbox}" loading="lazy" referrerpolicy="no-referrer" style="height:${Math.max(80, Math.min(4000, block.height))}px"></iframe>`;
    }
  }
}

function renderBlock(block: Block, options: RenderOptions): string {
  if (block.type === 'columns') return `<div class="hcd-block hcd-columns hcd-ratio-${block.ratio.replaceAll(':', '-')}" data-block-id="${attr(block.id)}">${block.cols.map((column) => `<div class="hcd-column" data-node-id="${attr(column.id)}">${column.blocks.map((child) => renderLeaf(child, options)).join('')}</div>`).join('')}</div>`;
  if (block.type === 'cards') return `<div class="hcd-block hcd-cards hcd-per-row-${block.perRow}" data-block-id="${attr(block.id)}">${block.items.map((card) => `<article class="hcd-card" data-node-id="${attr(card.id)}"><h3>${esc(card.title)}</h3>${card.blocks.map((child) => renderLeaf(child, options)).join('')}</article>`).join('')}</div>`;
  return renderLeaf(block, options);
}

function renderModule(module: Module, options: RenderOptions): string {
  return `<section class="hcd-module" data-module-id="${attr(module.id)}"><h2>${esc(module.title)}</h2>${module.blocks.map((block) => renderBlock(block, options)).join('')}</section>`;
}

export function renderDocumentHtml(doc: Document, options: RenderOptions = {}): string {
  const lang = options.locale ?? 'zh-CN';
  const source = options.version ? `<p class="hcd-source">${lang === 'zh-CN' ? '基于版本' : 'Based on version'} v${options.version}</p>` : '';
  const pending = options.localPreview ? `<p class="hcd-callout" role="note">${lang === 'zh-CN' ? '本地工作副本预览。内容可能包含尚未提交或审核的修改。' : 'Local working copy preview. Content may include changes awaiting submission or review.'}</p>` : options.includePending ? `<p class="hcd-callout" role="note">${lang === 'zh-CN' ? '包含未审核的修改；有冲突的提交已排除。' : 'Includes unreviewed changes. Conflicting submissions were excluded.'}</p>` : '';
  const footer = options.exportedAt ? `<footer class="hcd-source">${esc(doc.title)} · v${options.version ?? 1} · ${esc(options.exportedAt)}</footer>` : '';
  const requestedAccent = doc.theme.overrides.accent ?? '#2148a0';
  const accent = /^#[\da-f]{6}$/i.test(requestedAccent) ? requestedAccent : '#2148a0';
  return `<!doctype html><html lang="${attr(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; frame-src 'self' about:; script-src 'none'; base-uri 'none'; form-action 'none'"><title>${esc(doc.title)}</title><style>${themeCss}</style></head><body><article class="hcd-doc" style="--hcd-accent:${attr(accent)}"><header class="hcd-header"><h1>${esc(doc.title)}</h1>${source}</header>${pending}${doc.modules.map((module) => renderModule(module, options)).join('')}${footer}</article></body></html>`;
}

export const themeCss = `
.read-chart-svg{width:100%;max-height:450px;font:11px system-ui;color:var(--hcd-fg-2)}.read-chart-svg text{fill:currentColor}.chart-gridline{stroke:currentColor;opacity:.12}.chart-zero{stroke:currentColor;opacity:.5}.read-chart-legend{display:flex;flex-wrap:wrap;gap:8px 16px;list-style:none;padding:0;font-size:.85rem}.read-chart-legend i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px}.chart-data-note,.chart-data{font-size:.85rem}.chart-data .table-scroll{overflow:auto}.chart-data summary{cursor:pointer}.chart-title{font-weight:600}
:root{color-scheme:light dark;--hcd-bg:#f2f4f7;--hcd-surface:#fff;--hcd-surface-2:#e8ecf2;--hcd-fg:#152033;--hcd-fg-2:#4a566a;--hcd-line:#d5dbe4;--hcd-success:#2d7a4c;--hcd-danger:#c1351a;--hcd-font-body:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",system-ui,sans-serif;--hcd-font-display:var(--hcd-font-body);--series-1:#2a78d6;--series-2:#eb6834;--series-3:#1baf7a;--series-4:#eda100;--series-5:#e87ba4;--series-6:#008300;--series-7:#6250d6;--series-8:#e34948}
*{box-sizing:border-box}body{margin:0;background:var(--hcd-bg);color:var(--hcd-fg);font:16px/1.75 var(--hcd-font-body)}.hcd-doc{display:block;max-width:1040px;margin:0 auto;padding:48px 36px;background:var(--hcd-surface);min-height:100vh}.hcd-header{border-bottom:1px solid var(--hcd-line);padding-bottom:28px;margin-bottom:38px}.hcd-header h1{font:600 clamp(2rem,5vw,3rem)/1.2 var(--hcd-font-display);margin:0}.hcd-source{color:var(--hcd-fg-2);font-size:.8rem}.hcd-module{margin:42px 0}.hcd-module>h2{font:600 1.45rem/1.4 var(--hcd-font-display);margin:0 0 20px;padding-bottom:10px;border-bottom:1px solid var(--hcd-line)}.hcd-block{margin:1em 0}.hcd-paragraph{max-width:760px}.hcd-heading{font-family:var(--hcd-font-display)}.hcd-quote{border-left:3px solid var(--hcd-accent);padding:.3rem 1rem;color:var(--hcd-fg-2);margin-left:0}.hcd-callout{padding:16px 20px;border-radius:10px;background:color-mix(in srgb,var(--hcd-accent) 9%,var(--hcd-surface));border:1px solid color-mix(in srgb,var(--hcd-accent) 20%,var(--hcd-line))}.hcd-callout h3{margin:0 0 4px;font-size:1rem}.hcd-callout div p{margin:.3rem 0}.hcd-divider{border:0;border-top:1px solid var(--hcd-line);margin:2rem 0}.hcd-image{margin:24px auto;text-align:center}.hcd-image img{max-width:100%;height:auto;border-radius:8px}.hcd-image-small img{max-width:30%}.hcd-image-wide img{max-width:min(960px,100%)}.hcd-image-full{width:100%}.hcd-image-missing{padding:32px;background:var(--hcd-surface-2);color:var(--hcd-fg-2)}figcaption{font-size:.85rem;color:var(--hcd-fg-2);margin-top:8px}.hcd-table-wrap{overflow:auto}table{border-collapse:collapse;min-width:70%;max-width:100%}th,td{border-bottom:1px solid var(--hcd-line);padding:10px 14px;text-align:left}th{background:var(--hcd-surface-2)}.hcd-chart{width:100%;max-height:450px;color:var(--hcd-fg-2);font:12px var(--hcd-font-body)}.hcd-chart text{fill:currentColor}.hcd-chart-legend{display:flex;flex-wrap:wrap;gap:8px 18px;list-style:none;padding:0;color:var(--hcd-fg-2);font-size:.85rem}.hcd-chart-legend i{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--series);margin-right:7px}.hcd-timeline{list-style:none;padding:0}.hcd-timeline li{display:grid;grid-template-columns:120px 1fr;gap:20px;padding:10px 0;border-bottom:1px solid var(--hcd-line)}.hcd-timeline-label{color:var(--hcd-fg-2)}.hcd-timeline h3{margin:0;font-size:1rem}.hcd-timeline p{margin:3px 0}.hcd-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.hcd-kpi{padding:16px;background:var(--hcd-surface-2);border-radius:10px;display:grid;gap:4px}.hcd-kpi strong{font-size:1.8rem;font-variant-numeric:tabular-nums}.hcd-kpi small{color:var(--hcd-fg-2)}.hcd-kpi-good small{color:var(--hcd-success)}.hcd-kpi-bad small{color:var(--hcd-danger)}.hcd-columns,.hcd-cards{display:grid;gap:18px}.hcd-ratio-1-1{grid-template-columns:repeat(2,minmax(0,1fr))}.hcd-ratio-1-2{grid-template-columns:1fr 2fr}.hcd-ratio-2-1{grid-template-columns:2fr 1fr}.hcd-ratio-1-1-1{grid-template-columns:repeat(3,minmax(0,1fr))}.hcd-cards{grid-template-columns:repeat(var(--cols,3),minmax(0,1fr))}.hcd-per-row-2{--cols:2}.hcd-per-row-3{--cols:3}.hcd-per-row-4{--cols:4}.hcd-card{border:1px solid var(--hcd-line);border-radius:10px;padding:16px}.hcd-card h3{font:600 1.1rem var(--hcd-font-display);margin:.2rem 0 .7rem}.hcd-raw{width:100%;border:1px solid var(--hcd-line);border-radius:8px}a{color:var(--hcd-accent);text-underline-offset:3px}@media(prefers-color-scheme:dark){:root{--hcd-bg:#0f141c;--hcd-surface:#161d28;--hcd-surface-2:#1e2734;--hcd-fg:#e5e9f0;--hcd-fg-2:#a8b2c1;--hcd-line:#2b3545;--hcd-success:#6dca95;--hcd-danger:#f08b74;--series-1:#3987e5;--series-2:#d95926;--series-3:#199e70;--series-4:#c98500;--series-5:#d55181;--series-6:#008300;--series-7:#9085e9;--series-8:#e66767}}@media(max-width:720px){.hcd-doc{padding:24px 18px}.hcd-columns,.hcd-ratio-1-1,.hcd-ratio-1-2,.hcd-ratio-2-1,.hcd-ratio-1-1-1{grid-template-columns:1fr}.hcd-cards{grid-template-columns:1fr}.hcd-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.hcd-timeline li{grid-template-columns:1fr;gap:2px}}@media print{body{background:#fff;color:#111}.hcd-doc{max-width:none;padding:0;background:#fff}.hcd-module,.hcd-kpi,.hcd-card,.hcd-timeline li{break-inside:avoid}.hcd-callout,.hcd-kpi,.hcd-card{background:#fff;box-shadow:none}}
`;
