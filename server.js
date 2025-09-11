// server.js
// --------------------------------------------
// API simples para gerar PDF a partir de HTML
// Compatível com Render.com e Node 20.x
// --------------------------------------------

const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer'); // usa puppeteer completo

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' })); // recebe HTML grande

const PORT = process.env.PORT || 10000;

let _browser = null;

// Lança o browser (Puppeteer já resolve executablePath sozinho)
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

// Healthcheck simples
app.get('/health', (_req, res) => res.status(200).send('ok'));

// Endpoint principal: recebe { html } e devolve PDF
app.post('/api/gerar-pdf', async (req, res) => {
  try {
    const { html } = req.body || {};
    if (typeof html !== 'string' || !html.trim()) {
      return res.status(400).json({ error: 'Body inválido. Esperado { html: "<html...>" }' });
    }

    console.log(`🚀 /api/gerar-pdf chamado. HTML length: ${html.length}`);

    const browser = await getBrowser();
    const page = await browser.newPage();

    // Viewport e mídia de impressão
    await page.setViewport({ width: 1123, height: 1588, deviceScaleFactor: 1 }); // ~A4 @96dpi
    await page.emulateMediaType('print');

    // Garante uma base HTML válida
    const fullHtml = /^<!doctype/i.test(html) ? html : `<!doctype html>
<html lang="pt-br">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body>${html}</body></html>`;

    await page.setContent(fullHtml, {
      waitUntil: ['load', 'domcontentloaded', 'networkidle0'],
      timeout: 60_000,
    });

    // Gera PDF (A4, usa @page do CSS do front)
    const pdf = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      format: 'A4', // ignorado se preferCSSPageSize:true + @page size
      margin: { top: 0, bottom: 0, left: 0, right: 0 },
    });

    await page.close();

    // 🔧 Converte para Buffer se for Uint8Array
    const buf = Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf);

    console.log(`✅ PDF gerado. Bytes: ${buf.length}`);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="prova.pdf"',
      'Cache-Control': 'no-store',
      'Content-Length': String(buf.length),
    });

    // Envia binário de verdade
    return res.status(200).end(buf);
  } catch (err) {
    console.error('Erro ao gerar PDF:', err);
    return res.status(500).json({
      error: 'Falha ao gerar PDF',
      detail: err && err.message ? err.message : String(err),
    });
  }
});

// Sobe o servidor
app.listen(PORT, () => {
  console.log(`Servidor ouvindo em http://localhost:${PORT}`);
});

// Encerramento limpo na Render
async function closeBrowser() {
  if (_browser) {
    try { await _browser.close(); } catch (_) {}
    _browser = null;
  }
}
process.on('SIGTERM', async () => { await closeBrowser(); process.exit(0); });
process.on('SIGINT', async () => { await closeBrowser(); process.exit(0); });
