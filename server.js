// backend/server.js
const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');

const app = express();

// — Body parser com limite generoso (para HTML grande futuramente)
app.use(express.json({ limit: '15mb' }));

// — CORS (ajuste a origin para seu domínio Netlify quando souber)
app.use(cors({
  origin: '*', // ex.: 'https://SEU-SITE.netlify.app'
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
}));

// Responder qualquer preflight sem usar app.options('*')
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.sendStatus(204);
  }
  next();
});

// — Rota de saúde
app.get('/health', (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// — Home simples
app.get('/', (req, res) => {
  res.type('text/plain').send('IQPro backend OK');
});

// — Rota real para gerar PDF com Puppeteer
app.post('/api/gerar-pdf', async (req, res) => {
  const { html } = req.body;
  console.log("🚀 /api/gerar-pdf chamado. HTML length:", html?.length || 0);

  if (!html) {
    return res.status(400).json({ error: "HTML ausente" });
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
    console.log("✅ PDF gerado. Bytes:", pdfBuffer.length);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="prova.pdf"',
    });
    res.send(pdfBuffer);

  } catch (err) {
    console.error("❌ Erro ao gerar PDF:", err);
    res.status(500).json({ error: "Erro ao gerar PDF", details: err.message });
  } finally {
    if (browser) await browser.close();
  }
});


// — Porta do Render vem de process.env.PORT
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor ouvindo em http://localhost:${PORT}`);
});
