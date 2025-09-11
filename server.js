// server.js
const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

const PORT = process.env.PORT || 10000;
const PDF_TIMEOUT_MS = parseInt(process.env.PDF_TIMEOUT_MS || '120000', 10);
let _browser = null;

const delay = (ms) => new Promise(r => setTimeout(r, ms));

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
      '--font-render-hinting=none',
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
    page.setDefaultNavigationTimeout(PDF_TIMEOUT_MS);
    page.setDefaultTimeout(PDF_TIMEOUT_MS);

    // corta fontes/analytics que atrasam
    await page.setRequestInterception(true);
    page.on('request', (rq) => {
      const url = rq.url();
      if (
        /\.(woff2?|ttf|otf)$/i.test(url) ||
        /google-analytics|googletagmanager|gtag|hotjar|facebook|doubleclick/i.test(url)
      ) return rq.abort();
      rq.continue();
    });

    await page.setViewport({ width: 1123, height: 1588, deviceScaleFactor: 1 });
    await page.emulateMediaType('print');

    const fullHtml = /^<!doctype/i.test(html) ? html : `<!doctype html>
<html lang="pt-br">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body>${html}</body></html>`;

    await page.setContent(fullHtml, { waitUntil: 'domcontentloaded', timeout: PDF_TIMEOUT_MS });

    await page.evaluate(async () => {
      const imgs = Array.from(document.images || []);
      await Promise.all(imgs.map(img => img.decode().catch(() => {})));
    });
    await delay(250);

    const pdfData = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      format: 'A4',
      margin: { top: 0, bottom: 0, left: 0, right: 0 },
      timeout: PDF_TIMEOUT_MS,
    });

    await page.close();

    // 🔑 GARANTE Buffer (evita serialização JSON de TypedArray)
    const pdfBuffer = Buffer.isBuffer(pdfData) ? pdfData : Buffer.from(pdfData);

    console.log(`✅ PDF gerado. Bytes: ${pdfBuffer.length}`);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="prova.pdf"',
      'Content-Length': String(pdfBuffer.length),
      'Cache-Control': 'no-store',
    });
    return res.end(pdfBuffer); // usa end com Buffer
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

async function closeBrowser() {
  if (_browser) { try { await _browser.close(); } catch {} _browser = null; }
}
process.on('SIGTERM', async () => { await closeBrowser(); process.exit(0); });
process.on('SIGINT', async () => { await closeBrowser(); process.exit(0); });
