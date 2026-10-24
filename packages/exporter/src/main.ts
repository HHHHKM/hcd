import { chromium } from 'playwright';
import { chromiumRenderer, createExporter } from './app';

// Run only on the private exporter network. Its container has no application data volume.
const browser = await chromium.launch({ headless: true });
const app = createExporter(chromiumRenderer(browser));
app.addHook('onClose', async () => { await browser.close(); });
await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? 4000) });
const stop = () => { void app.close(); };
process.once('SIGTERM', stop); process.once('SIGINT', stop);
