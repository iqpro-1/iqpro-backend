// server.js — Render-friendly, menos timeout
const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');

const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' }));

const PORT = process.env.PORT || 10000;

// Concorrência (ajuste no painel do Render): PDF_CONCURRENCY=1..3
const MAX_CONCURRENT = Number(process.env.PDF_CONCURRENCY || 2);

// Timeouts (ms)
const NAV_TIMEOUT      = Number(process.env.PDF_NAV_TIMEOUT      || 90_000);
const CONTENT_TIMEOUT  = Number(process.env.PDF_CONTENT_TIMEOUT  || 90_000);
const PROTOCOL_TIMEOUT = Number(process.env.PDF_PROTOCOL_TIMEOUT || 150_000);

let _browser = null;

// Semáforo simples
let active = 0;
const queue = [];
function acquire(){ if(active < MAX_CONCURRENT){ active++; return Promise.resolve(); }
  return new Promise(r => queue.push(r)); }
function release(){ active--; const n = queue.shift(); if(n){ active++; n(); } }

async function getBrowser(){
  if (_browser) return _browser;
  _browser = await puppeteer.launch({
    headless: 'new',
    protocolTimeout: PROTOCOL_TIMEOUT,
    args: [
      '--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage',
      '--disable-gpu','--no-zygote','--no-first-run','--no-default-browser-check',
      '--disable-extensions','--disable-features=TranslateUI,BlinkGenPropertyTrees',
    ],
  });
  _browser.on?.('disconnected', () => { console.warn('⚠️ Browser caiu; reset.'); _browser = null; });
  console.log('🧭 Chrome iniciado pelo Puppeteer');
  return _browser;
}

app.get('/health', (_req,res)=>res.status(200).send('ok'));

app.post('/api/gerar-pdf', async (req,res)=>{
  const { html } = req.body || {};
  if (typeof html !== 'string' || !html.trim()){
    return res.status(400).json({ error:'Body inválido. Esperado { html: "<html...>" }' });
  }
  console.log(`🚀 /api/gerar-pdf chamado. HTML length: ${html.length}`);

  await acquire();
  let page;
  try{
    const browser = await getBrowser();
    page = await browser.newPage();

    // Timeouts por página
    page.setDefaultNavigationTimeout(NAV_TIMEOUT);
    page.setDefaultTimeout(CONTENT_TIMEOUT);

    // Cache ajuda em logo/KaTeX repetidos
    await page.setCacheEnabled(true);

    // Intercepta e bloqueia recursos caros/desnecessários
    await page.setRequestInterception(true);
    page.on('request', req => {
      const t = req.resourceType();
      // Permitimos só o essencial; bloqueia scripts e XHR
      if (t === 'document' || t === 'stylesheet' || t === 'image' || t === 'font') req.continue();
      else req.abort();
    });

    await page.setViewport({ width: 1123, height: 1588, deviceScaleFactor: 1 });
    await page.emulateMediaType('print');

    const fullHtml = /^<!doctype/i.test(html) ? html : `<!doctype html>
<html lang="pt-br"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body>${html}</body></html>`;

    // ⚠️ Não usamos networkidle0 (pode nunca acontecer com CDNs).
    await page.setContent(fullHtml, { waitUntil: 'domcontentloaded', timeout: CONTENT_TIMEOUT });

    // Espera fontes com timeout de segurança
    try {
      await Promise.race([
        page.evaluate(() => document.fonts && document.fonts.ready),
        new Promise((_,rej)=>setTimeout(()=>rej(new Error('fonts-timeout')), 8000)),
      ]);
    } catch(_) {}

    // Espera imagens (com timeout por imagem) — não trava indefinidamente
    try {
      await page.evaluate(async (perImageTimeoutMs = 8000) => {
        const waitImg = (img) => new Promise(resolve => {
          if (img.complete) return resolve();
          const done = () => { img.removeEventListener('load', done); img.removeEventListener('error', done); resolve(); };
          img.addEventListener('load', done); img.addEventListener('error', done);
          setTimeout(done, perImageTimeoutMs);
        });
        const imgs = Array.from(document.images || []);
        await Promise.all(imgs.map(waitImg));
      });
    } catch(_) {}

    const pdf = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      format: 'A4',
      margin: { top: 0, bottom: 0, left: 0, right: 0 },
      timeout: CONTENT_TIMEOUT,
    });

    const buf = Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf);
    console.log(`✅ PDF gerado. Bytes: ${buf.length}`);

    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Length': buf.length,
      'Content-Disposition': 'attachment; filename="prova.pdf"',
      'Cache-Control': 'no-store',
      'Connection': 'close',
    });
    return res.end(buf);
  } catch (err){
    console.error('Erro ao gerar PDF:', err);
    try {
      res.status(500).json({ error:'Falha ao gerar PDF', detail: err?.message || String(err) });
    } catch {}
  } finally {
    try { await page?.close(); } catch {}
    release();
  }
});

app.listen(PORT, ()=>console.log(`Servidor ouvindo em http://localhost:${PORT}`));

async function closeBrowser(){ if (_browser){ try{ await _browser.close(); }catch{} _browser = null; } }
process.on('SIGTERM', async()=>{ await closeBrowser(); process.exit(0); });
process.on('SIGINT',  async()=>{ await closeBrowser(); process.exit(0); });
