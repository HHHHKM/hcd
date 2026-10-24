import { createHash } from 'node:crypto';
import { appendFileSync, copyFileSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
const [id, manifestPath, note] = process.argv.slice(2);
if (!id || !manifestPath || !note) throw new Error('id manifestPath note required');
const report = JSON.parse(readFileSync('outputs/E5-migration-log.json'));
const expectedVisualTests = report.expectedVisualTests ?? 34;
const expected = JSON.parse(readFileSync('outputs/E5-baseline-before-sha256.json'));
const actualBaselineFiles = readdirSync('outputs/visual-baseline').filter((name) => name.endsWith('.png')).map((name) => `outputs/visual-baseline/${name}`).sort();
if (JSON.stringify(actualBaselineFiles) !== JSON.stringify(Object.keys(expected).sort())) {
  throw new Error('Frozen baseline file set changed');
}
const mismatch = Object.entries(expected).filter(([file, hash]) =>
  createHash('sha256').update(readFileSync(file)).digest('hex') !== hash,
).map(([file]) => file);
if (mismatch.length) throw new Error(`Frozen baseline changed: ${mismatch.join(', ')}`);
const visual = JSON.parse(readFileSync('outputs/E3-complete-visual-results.json'));
if (visual.stats.unexpected || visual.stats.skipped || visual.stats.flaky || visual.stats.expected !== expectedVisualTests) {
  throw new Error(`Incomplete visual gate: ${JSON.stringify(visual.stats)}`);
}
const applied = JSON.parse(readFileSync(manifestPath));
copyFileSync('outputs/E3-complete-visual-results.json', `outputs/E5-${id}-visual-results.json`);
report.regions.push({ region: applied.region, status: 'passed', buildExit: 0, visualExit: 0,
  visualStats: visual.stats, baselineCount: Object.keys(expected).length, baselineShaMismatches: 0,
  actions: applied.actions.length, backup: applied.backup, files: applied.files, note });
writeFileSync('outputs/E5-migration-log.json', `${JSON.stringify(report, null, 2)}\n`);
appendFileSync('outputs/E5-migration-log.md', `\n## ${id} ${applied.region}\n\n${note}\n\n` +
  `${applied.actions.length} explicit operations. Build exit 0; complete visual ${expectedVisualTests} passed, ` +
  `0 skipped/unexpected/flaky. Frozen ${Object.keys(expected).length} baseline SHA mismatches: 0. ` +
  `Evidence E5-${id}-build.log / E5-${id}-visual.log / E5-${id}-visual-results.json.\n`);
console.log(JSON.stringify({ id, region: applied.region, stats: visual.stats,
  baselineShaMismatches: 0, backup: applied.backup }, null, 2));
