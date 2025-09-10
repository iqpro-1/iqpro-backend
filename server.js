// backend/server.js
const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');

const app = express();

// Body parser (HTML grande)
app.use(express.json({ limit: '15mb' }));

// CORS (ajuste origin depois)
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
}));

// Preflight genérico
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.sendStatus(204);
  }
  next();
});

// Health
app.get('/health', (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// Home
app.get('/', (req, res) => {
  res.type('text/plain').send('IQPro backend OK');
});

// PDF
app.post('/api/gerar-pdf', async (req, res) => {
  const { html } = req.body;
  console.log('🚀 /api/gerar-pdf chamado. HTML length:', html?.length || 0);

  if (!html) return res.status(400).json({ error: 'HTML ausente' });

  let browser;
  try {
    
    // Usa o Chrome/Chromium baixado pelo Puppeteer (postinstall)
const execPath = await puppeteer.executablePath();

browser = await puppeteer.launch({
  headless: 'new',
  executablePath: execPath, // <-- usar o caminho resolvido
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--single-process',
    '--no-zygote'
  ]
});



    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(0);
    page.setDefaultTimeout(0);

    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 0 });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20px', bottom: '20px', left: '20px', right: '20px' },
    });
    console.log('✅ PDF gerado. Bytes:', pdfBuffer.length);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="prova.pdf"',
    });
    res.send(pdfBuffer);
  } catch (err) {
    console.error('❌ Erro ao gerar PDF:', err);
    res.status(500).json({ error: 'Erro ao gerar PDF', details: err.message });
  } finally {
    if (browser) await browser.close();
  }
});

// Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor ouvindo em http://localhost:${PORT}`);
});
