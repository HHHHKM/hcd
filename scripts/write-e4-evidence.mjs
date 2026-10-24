import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const before = JSON.parse(readFileSync('outputs/E4-before-copy-manifest.json', 'utf8'));
const reports = process.argv.slice(2);
if (!reports.length) throw new Error('Pass actual E4-after JSON reports, oldest to newest');
const cells = new Map();
for (const reportPath of reports) {
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  for (const row of report.observations) cells.set(`${row.name}-${row.width}-${row.theme}`, { ...row, reportPath });
}
const observations = [...cells.values()];
const issues = observations.filter((row) => row.status === 'failed' || row.status === 'visual-issue');
const names = [...new Set(observations.map((row) => row.name))];
const headers = '| 组 | 界面 | 改前（1440浅 / 390浅 / 1440深 / 390深） | 改后（同序） |\n| --- | --- | --- | --- |\n';
let table = headers;
const mapping = [];
for (const name of names) {
  const rows = observations.filter((row) => row.name === name);
  const links = { before: [], after: [] };
  for (const [width, theme] of [[1440, 'light'], [390, 'light'], [1440, 'dark'], [390, 'dark']]) {
    const row = rows.find((candidate) => candidate.width === width && candidate.theme === theme);
    const key = `${name}-${width}-${theme}`;
    const beforePath = `outputs/E4-before-${key}.png`;
    if (existsSync(beforePath)) links.before.push(`[${width}${theme === 'light' ? '浅' : '深'}](E4-before-${key}.png)`);
    else links.before.push(`${width}${theme === 'light' ? '浅' : '深'}：N/A（移动端只读）`);
    if (!row) links.after.push(`${width}${theme}：缺少结果`);
    else if (row.status.startsWith('not-applicable')) links.after.push(`${width}${theme === 'light' ? '浅' : '深'}：N/A（移动端只读）`);
    else if (row.screenshot && existsSync(`outputs/${row.screenshot}`)) {
      const destination = `outputs/E4-after-${key}.png`;
      if (`outputs/${row.screenshot}` !== destination) copyFileSync(`outputs/${row.screenshot}`, destination);
      links.after.push(`[${width}${theme === 'light' ? '浅' : '深'}${row.status === 'captured' ? '' : '（问题）'}](E4-after-${key}.png)`);
    } else links.after.push(`${width}${theme}：失败（${row.status}）`);
    mapping.push({ name, width, theme, before: existsSync(beforePath) ? beforePath : null,
      after: row?.screenshot ?? null, status: row?.status ?? 'missing', reportPath: row?.reportPath });
  }
  table += `| ${rows[0]?.group ?? '?'} | ${name} | ${links.before.join(' / ')} | ${links.after.join(' / ')} |\n`;
}
const markdown = `# E4 界面截图证据\n\n` +
  `真实 Chrome、真实 createApp + dist、一次性 SQLite；不替换前端或 API 响应。${observations.length} 个矩阵单元，` +
  `${observations.filter((row) => row.status === 'captured').length} 个实际截图通过，${issues.length} 个问题，` +
  `${observations.filter((row) => row.status.startsWith('not-applicable')).length} 个移动编辑状态不适用。\n\n` +
  `改前来源见 [复制追溯](E4-before-copy-manifest.json)；原始 ZIP 隔离补验选区见 ` +
  `[来源/sha256/真实命令](E4-before-mobile-selection-source.json)。6 个 390 编辑器单元为现有产品移动只读限制，` +
  `未伪造或计作完成编辑态截图。通知空态最终采用正常 pointer check/click，所有失败尝试均保留。\n\n` +
  table + `\n结果来源：${reports.map((path) => `[${path.split('/').at(-1)}](${path.split('/').at(-1)})`).join('、')}。\n`;
writeFileSync('outputs/E4-evidence.md', markdown);
writeFileSync('outputs/E4-screenshot-mapping.json', JSON.stringify({ sources: reports, observations, issues, mapping,
  beforeCount: before.actualSurfaceCaptures, actualCaptures: observations.filter((row) => row.status === 'captured').length }, null, 2));
console.log(JSON.stringify({ cells: observations.length, surfaces: names.length, issues: issues.length }));
