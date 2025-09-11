// server.js
const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

const PORT = process.env.PORT || 10000;
const NAV_TIMEOUT_MS = parseInt(process.env.PDF_TIMEOUT_MS || '120000', 10); // 120s

let _browser = null;

async function getBrowser() {
  if (_browser) return _browser;
  _browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote',
      '--font-render-hinting=none'
    ],
  });
  console.log('🧭 Chrome iniciado pelo Puppeteer');
  return _browser;
}

app.get('/health', (_req, res) => res.status(200).send('ok'));

app.post('/api/gerar-pdf', async (req, res) => {
  try {
    const { html } = req.body || {};
    if (typeof html !== 'string' || !html.trim()) {
      return res.status(400).json({ error: 'Body inválido. Esperado { html: "<html...>" }' });
    }

    console.log(`🚀 /api/gerar-pdf chamado. HTML length: ${html.length}`);

    const browser = await getBrowser();
    const page = await browser.newPage();

    // timeouts mais folgados
    page.setDefaultTimeout(NAV_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);

    // bloqueia coisas que não precisamos para o PDF
    await page.setRequestInterception(true);
    const BLOCKED_HOST_SNIPPETS = [
      'googletagmanager', 'google-analytics', 'doubleclick', 'facebook',
      'hotjar', 'segment', 'mixpanel', 'tiktok', 'optimizely',
      'fonts.googleapis.com', 'fonts.gstatic.com'
    ];
    page.on('request', req0 => {
      const url = req0.url();
      const type = req0.resourceType();
      if (type === 'font' || BLOCKED_HOST_SNIPPETS.some(s => url.includes(s))) {
        return req0.abort();
      }
      return req0.continue();
    });

    await page.setViewport({ width: 1123, height: 1588, deviceScaleFactor: 1 });
    await page.emulateMediaType('print');

    const fullHtml = /^<!doctype/i.test(html) ? html : `<!doctype html>
<html lang="pt-br">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body>${html}</body></html>`;

    // ⚠️ Não espere networkidle0 (costuma travar com CDNs).
    await page.setContent(fullHtml, {
      waitUntil: 'domcontentloaded',
      timeout: NAV_TIMEOUT_MS
    });

    // Aguarda SOMENTE as imagens (o essencial para o PDF ficar completo)
    await page.evaluate(async () => {
      const imgs = Array.from(document.images || []);
      await Promise.all(imgs.map(img => img.decode().catch(() => {})));
    });

    // Pequeno grace period para CSS aplicar (sem travar se houver requests pendentes)
    await page.waitForTimeout(300);

    const pdf = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      format: 'A4',
      margin: { top: 0, bottom: 0, left: 0, right: 0 },
      // timeout não existe no page.pdf; o controle é via timeouts acima
    });

    await page.close();

    const buf = Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf);
    console.log(`✅ PDF gerado. Bytes: ${buf.length}`);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="prova.pdf"',
      'Cache-Control': 'no-store',
      'Content-Length': String(buf.length),
    });
    return res.status(200).end(buf);
  } catch (err) {
    console.error('Erro ao gerar PDF:', err);
    return res.status(500).json({
      error: 'Falha ao gerar PDF',
      detail: err && err.message ? err.message : String(err),
    });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor ouvindo em http://localhost:${PORT}`);
});

let _browserClosing = false;
async function closeBrowser() {
  if (_browser && !_browserClosing) {
    _browserClosing = true;
    try { await _browser.close(); } catch (_) {}
    _browser = null;
  }
}
process.on('SIGTERM', async () => { await closeBrowser(); process.exit(0); });
process.on('SIGINT', async () => { await closeBrowser(); process.exit(0); });
