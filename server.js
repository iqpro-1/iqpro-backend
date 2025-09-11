// server.js
// --------------------------------------------
// API para gerar PDF a partir de HTML (Render.com / Node 20.x)
// com timeout maior e limite de concorrência de páginas
// --------------------------------------------
const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');

const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' }));

const PORT = process.env.PORT || 10000;

// Concorrência máxima de páginas abertas simultaneamente.
// Ajuste via env: PDF_CONCURRENCY=1..3 (2 é um bom ponto de partida em planos free)
const MAX_CONCURRENT = Number(process.env.PDF_CONCURRENCY || 2);

// Timeouts (ms)
const NAV_TIMEOUT   = Number(process.env.PDF_NAV_TIMEOUT   || 120_000);
const CONTENT_TIMEOUT = Number(process.env.PDF_CONTENT_TIMEOUT || 120_000);
const PROTOCOL_TIMEOUT = Number(process.env.PDF_PROTOCOL_TIMEOUT || 180_000);

let _browser = null;

// --------- Semáforo simples p/ limitar concorrência ----------
let active = 0;
const queue = [];
function acquire() {
  if (active < MAX_CONCURRENT) { active++; return Promise.resolve(); }
  return new Promise(resolve => queue.push(resolve));
}
function release() {
  active--;
  const next = queue.shift();
  if (next) { active++; next(); }
}
// -------------------------------------------------------------

async function getBrowser() {
  if (_browser) return _browser;

  _browser = await puppeteer.launch({
    headless: 'new',
    protocolTimeout: PROTOCOL_TIMEOUT, // <— evita Target.createTarget timeout
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-features=TranslateUI,BlinkGenPropertyTrees',
    ],
  });

  console.log('🧭 Chrome iniciado pelo Puppeteer');
  return _browser;
}

app.get('/health', (_req, res) => res.status(200).send('ok'));

app.post('/api/gerar-pdf', async (req, res) => {
  const { html } = req.body || {};
  if (typeof html !== 'string' || !html.trim()) {
    return res.status(400).json({ error: 'Body inválido. Esperado { html: "<html...>" }' });
  }

  console.log(`🚀 /api/gerar-pdf chamado. HTML length: ${html.length}`);

  await acquire();
  let page;
  try {
    const browser = await getBrowser();

    // abrir página (pode ser o gargalo — por isso o semáforo acima)
    page = await browser.newPage();

    // timeouts mais folgados por página
    page.setDefaultNavigationTimeout(NAV_TIMEOUT);
    page.setDefaultTimeout(CONTENT_TIMEOUT);

    await page.setViewport({ width: 1123, height: 1588, deviceScaleFactor: 1 });
    await page.emulateMediaType('print');

    const fullHtml = /^<!doctype/i.test(html) ? html : `<!doctype html>
<html lang="pt-br">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body>${html}</body>
</html>`;

    // Carrega HTML e espera rede ficar ociosa
    await page.setContent(fullHtml, {
      waitUntil: ['load', 'domcontentloaded', 'networkidle0'],
      timeout: CONTENT_TIMEOUT,
    });

    // garante fontes (útil para KaTeX / webfonts)
    try { await page.evaluate(() => document.fonts && document.fonts.ready); } catch {}

    const pdf = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      format: 'A4',
      margin: { top: 0, bottom: 0, left: 0, right: 0 },
      timeout: CONTENT_TIMEOUT, // puppeteer v22+ aceita timeout aqui
    });

    console.log(`✅ PDF gerado. Bytes: ${pdf.length}`);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="prova.pdf"',
      'Cache-Control': 'no-store',
    });
    return res.status(200).send(pdf);
  } catch (err) {
    console.error('Erro ao gerar PDF:', err);
    return res.status(500).json({
      error: 'Falha ao gerar PDF',
      detail: err?.message || String(err),
    });
  } finally {
    try { await page?.close(); } catch {}
    release();
  }
});

app.listen(PORT, () => {
  console.log(`Servidor ouvindo em http://localhost:${PORT}`);
});

async function closeBrowser() {
  if (_browser) {
    try { await _browser.close(); } catch {}
    _browser = null;
  }
}
process.on('SIGTERM', async () => { await closeBrowser(); process.exit(0); });
process.on('SIGINT',  async () => { await closeBrowser(); process.exit(0); });
