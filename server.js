// server.js
// --------------------------------------------
// API simples para gerar PDF a partir de HTML
// Compatível com Render.com e Node 20.x
// --------------------------------------------

const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer'); // use 'puppeteer' (não 'puppeteer-core')
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' })); // recebe HTML grande

const PORT = process.env.PORT || 10000;

let _browser = null;

// Resolve o caminho do Chrome dinamicamente.
// Prioridades:
// 1) PUPPETEER_EXECUTABLE_PATH (se definido)
// 2) puppeteer.executablePath() (o Chrome/Chromium baixado no postinstall)
// 3) fallbacks comuns do SO (se existirem)
async function getExecutablePath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  try {
    const ep = puppeteer.executablePath();
    if (ep && fs.existsSync(ep)) return ep;
  } catch (_) {}
  const fallbacks = [
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ];
  for (const p of fallbacks) {
    if (fs.existsSync(p)) return p;
  }
  return undefined; // deixa o Puppeteer escolher
}

async function getBrowser() {
  if (_browser) return _browser;

  const executablePath = await getExecutablePath();
  if (executablePath) {
    console.log(`🧭 Usando Chrome em: ${executablePath}`);
  } else {
    console.log('🧭 Usando Chrome baixado pelo puppeteer (executablePath indefinido).');
  }

  _browser = await puppeteer.launch({
    headless: 'new', // ou true
    executablePath,  // pode ser undefined; puppeteer usa o próprio
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote',
      '--font-render-hinting=none',
    ],
  });

  return _browser;
}

// Healthcheck simples (Render usa para verificar se está no ar)
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

    // Garante uma base HTML válida. O front costuma enviar o CSS/KaTeX já no HTML.
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
