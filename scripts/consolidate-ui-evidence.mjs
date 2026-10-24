import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

// Keep failed attempts, and replace each cell only with its later real browser result.
const sources = ['E2-surfaces-ui-surfaces-results.json', 'E2-final-ui-surfaces-results.json',
  'E2-nested-ui-surfaces-results.json', 'E2-tail2-ui-surfaces-results.json', 'E2-empty2-ui-surfaces-results.json'];
const reports = sources.map((file) => JSON.parse(readFileSync(`outputs/${file}`, 'utf8')));
const cells = new Map();
reports.forEach((report, index) => report.observations.forEach((observation) => {
  cells.set(`${observation.name}-${observation.width}-${observation.theme}`, {
    ...observation, resultSource: sources[index],
  });
}));
const observations = [...cells.values()];
const issues = observations.filter((row) => ['failed', 'visual-issue'].includes(row.status));
const copyManifest = [];
for (const row of observations) {
  if (row.status !== 'captured') continue;
  const source = `outputs/${row.screenshot}`;
  if (!existsSync(source)) throw new Error(`Missing real screenshot: ${source}`);
  const target = `outputs/E4-before-${row.name}-${row.width}-${row.theme}.png`;
  copyFileSync(source, target);
  copyManifest.push({ source, target, resultSource: row.resultSource });
}
const report = { date: new Date().toISOString(), status: issues.length ? 'issues' : 'passed',
  browser: reports[0].browser, sources, observations, issues,
  runtimeErrors: reports.flatMap((row) => row.runtimeErrors),
  blockedExternalRequests: reports.reduce((sum, row) => sum + row.blockedExternalRequests, 0),
  counts: { matrixCells: observations.length, actualSurfaceCaptures: copyManifest.length,
    notApplicable: observations.filter((row) => row.status.startsWith('not-applicable')).length },
  limitations: [
    '390px native selection and selection summary are not applicable in the observed real mobile reading state. No selection screenshot is claimed.',
    '390px rich/nested editor captures document the product restriction. Actual desktop editor state is checked at 1440px; no mobile editor screenshot is claimed.',
    'The notification empty-state checkbox and mark-read button were outside pointer viewport in the long original modal. The later capture triggers the actual DOM click handler with HTMLElement.click; this is not a successful pointer accessibility check.',
    'Source failures and screenshots are retained. Each later result replaces only the same surface, width and theme.',
  ],
};
writeFileSync('outputs/E2-ui-coverage-final.json', JSON.stringify(report, null, 2));
writeFileSync('outputs/E4-before-copy-manifest.json', JSON.stringify({ source: 'E2-ui-coverage-final.json',
  copies: copyManifest, notApplicable: observations.filter((row) => row.status.startsWith('not-applicable')) }, null, 2));
console.log(JSON.stringify(report.counts));
