// server.js
const express = require("express");
const cors = require("cors");
const puppeteer = require("puppeteer");

const app = express();

// --- Config ---
const PORT = process.env.PORT || 3000;
const ALLOWED_ORIGINS = [
  // ajuste conforme necessário:
  /\.netlify\.app$/,
  /\.netlify\.com$/,
  /localhost:\d+$/,
  /127\.0\.0\.1:\d+$/,
  /render\.com$/,
];

// --- Middlewares ---
app.use(express.json({ limit: "15mb" }));
app.use(
  cors({
    origin: (origin, cb) => {
      // em dev (sem origin) ou se bater local/file
      if (!origin) return cb(null, true);
      if (ALLOWED_ORIGINS.some((re) => re.test(origin))) return cb(null, true);
      return cb(new Error("Origin not allowed by CORS"), false);
    },
  })
);

// --- Puppeteer (singleton) ---
let _browser = null;
async function getBrowser() {
  if (_browser && _browser.process() && !_browser.process().killed) return _browser;

  _browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-zygote",
      "--single-process",
    ],
    // em Render, usar o Chrome baixado pelo postinstall do puppeteer (default)
  });

  // fecha com o processo
  const cleanup = async () => {
    try { await _browser?.close(); } catch {}
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  return _browser;
}

// --- Healthcheck ---
app.get("/healthz", (_req, res) => {
  res.status(200).json({ ok: true, uptime: process.uptime() });
});

// --- Endpoint principal ---
app.post("/api/gerar-pdf", async (req, res) => {
  try {
    const { html } = req.body || {};
    if (!html || typeof html !== "string" || html.length < 20) {
      return res.status(400).json({ error: "HTML inválido ou vazio." });
    }

    const browser = await getBrowser();
    const page = await browser.newPage();

    // Evita travar em redes externas; garante fonts/images quando possível
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      // bloqueia recursos pesados que não afetam PDF
      const blocked = new Set(["media", "font"]);
      if (blocked.has(request.resourceType())) return request.abort();
      request.continue();
    });

    // Injeta HTML diretamente
    await page.setContent(html, {
      waitUntil: ["load", "domcontentloaded", "networkidle0"],
    });

    // Emula impressão respeitando CSS/KaTeX
    await page.emulateMediaType("print");

    // Gera PDF A4 respeitando @page e tamanhos CSS
    const pdfBuffer = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true, // respeita @page size e margens do seu HTML
      format: "A4",            // fallback se @page não estiver presente
    });

    await page.close();

    // Retorna binário com o content-type correto
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'inline; filename="prova.pdf"');
    return res.status(200).send(pdfBuffer);
  } catch (err) {
    console.error("Erro ao gerar PDF:", err);
    return res.status(500).json({ error: "Falha ao gerar PDF", detail: String(err && err.message || err) });
  }
});

// --- Start ---
app.listen(PORT, () => {
  console.log(`PDF service listening on :${PORT}`);
});
