const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { exec } = require("child_process");
const { promisify } = require("util");

const PORT = 4321;
const execAsync = promisify(exec);

const highscoresPath = path.join(__dirname, "highscores.json");
const publicDir = path.join(__dirname, "public");
const repoRoot = path.resolve(__dirname, "..", "..");
const convexEnvPath = path.join(repoRoot, ".env.local");
const DEFAULT_POKEDEX_CARD_COUNT = 151;
const MIN_POKEDEX_CARD_COUNT = 24;
const POKEDEX_CACHE_MAX_AGE_MS = 5 * 60 * 1000;
const pokedexCache = {
  cards: [],
  loadedAt: 0,
  inFlightPromise: null
};

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function ensureHighscoresFile() {
  if (!fs.existsSync(highscoresPath)) {
    fs.writeFileSync(highscoresPath, JSON.stringify([], null, 2));
  }
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { "Content-Type": MIME_TYPES[".json"] });
  res.end(JSON.stringify(data));
}

function readHighscores() {
  ensureHighscoresFile();
  try {
    return JSON.parse(fs.readFileSync(highscoresPath, "utf8"));
  } catch {
    return [];
  }
}

function parseConvexEnvFile() {
  if (!fs.existsSync(convexEnvPath)) {
    return null;
  }
  const lines = fs.readFileSync(convexEnvPath, "utf8").split(/\r?\n/);
  const vars = {};
  lines.forEach((line) => {
    const [rawKey, ...rest] = line.split("=");
    if (!rawKey || !rest.length) {
      return;
    }
    vars[rawKey.trim()] = rest.join("=").trim();
  });
  if (!vars.CONVEX_SELF_HOSTED_URL || !vars.CONVEX_SELF_HOSTED_ADMIN_KEY) {
    return null;
  }
  return vars;
}

async function runConvexInlineQuery(querySource) {
  const envVars = parseConvexEnvFile();
  if (!envVars) {
    throw new Error("Missing Convex environment values in .env.local.");
  }

  const escapedQuery = JSON.stringify(querySource);
  const command = `npx convex@latest run --codegen disable --typecheck disable --inline-query ${escapedQuery}`;
  const { stdout } = await execAsync(command, {
    cwd: repoRoot,
    env: {
      ...process.env,
      CONVEX_SELF_HOSTED_URL: envVars.CONVEX_SELF_HOSTED_URL,
      CONVEX_SELF_HOSTED_ADMIN_KEY: envVars.CONVEX_SELF_HOSTED_ADMIN_KEY
    }
  });
  return JSON.parse(stdout.trim());
}

function normalizePokedexLimit(rawLimit, fallback = MIN_POKEDEX_CARD_COUNT) {
  const parsed = Number(rawLimit);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.min(DEFAULT_POKEDEX_CARD_COUNT, Math.floor(parsed)));
}

async function fetchPokedexCards(limit) {
  const safeLimit = normalizePokedexLimit(limit, MIN_POKEDEX_CARD_COUNT);
  const querySource = `(await ctx.db.query("pokedex").withIndex("by_dex_number").take(${safeLimit})).map((entry)=>{const dexNumber=Number(entry.national_number ?? entry.dexNumber ?? 0);const name=String(entry.english_name ?? entry.name ?? "Unknown");const type1=String(entry.primary_type ?? entry.type1 ?? "unknown");const type2Raw=entry.secondary_type ?? entry.type2 ?? null;const type2=type2Raw ? String(type2Raw) : null;return { dexNumber, name, type1, type2 };})`;
  const cards = await runConvexInlineQuery(querySource);
  return cards.filter((card) => Number.isFinite(card.dexNumber) && card.dexNumber > 0);
}

async function refreshPokedexCache(limit) {
  if (pokedexCache.inFlightPromise) {
    return pokedexCache.inFlightPromise;
  }

  const targetLimit = normalizePokedexLimit(limit, DEFAULT_POKEDEX_CARD_COUNT);
  pokedexCache.inFlightPromise = fetchPokedexCards(targetLimit)
    .then((cards) => {
      pokedexCache.cards = cards;
      pokedexCache.loadedAt = Date.now();
      return cards;
    })
    .finally(() => {
      pokedexCache.inFlightPromise = null;
    });

  return pokedexCache.inFlightPromise;
}

async function loadPokedexCards(limit) {
  const requestedLimit = normalizePokedexLimit(limit, MIN_POKEDEX_CARD_COUNT);
  const hasEnoughCards = pokedexCache.cards.length >= requestedLimit;
  const isFresh = Date.now() - pokedexCache.loadedAt < POKEDEX_CACHE_MAX_AGE_MS;

  if (hasEnoughCards && isFresh) {
    return pokedexCache.cards.slice(0, requestedLimit);
  }

  if (hasEnoughCards) {
    refreshPokedexCache(Math.max(requestedLimit, pokedexCache.cards.length)).catch(() => {
      // Keep serving stale cards if background refresh fails.
    });
    return pokedexCache.cards.slice(0, requestedLimit);
  }

  const cards = await refreshPokedexCache(requestedLimit);
  return cards.slice(0, requestedLimit);
}

function handleApi(req, res, pathname) {
  if (pathname === "/api/pokedex/deck" && req.method === "GET") {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const limit = normalizePokedexLimit(url.searchParams.get("limit"), MIN_POKEDEX_CARD_COUNT);
    loadPokedexCards(limit)
      .then((cards) => {
        sendJson(res, 200, cards);
      })
      .catch((error) => {
        sendJson(res, 500, { error: `Could not load pokedex cards: ${error.message}` });
      });
    return true;
  }

  if (pathname !== "/api/highscores") {
    return false;
  }

  if (req.method === "GET") {
    sendJson(res, 200, readHighscores());
    return true;
  }

  if (req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      let payload;
      try {
        payload = JSON.parse(body || "{}");
      } catch {
        sendJson(res, 400, { error: "Invalid JSON payload" });
        return;
      }

      const { name, score, cards, rows } = payload;
      if (
        typeof name !== "string" ||
        typeof score !== "number" ||
        typeof cards !== "number" ||
        typeof rows !== "number"
      ) {
        sendJson(res, 400, { error: "Invalid high score data" });
        return;
      }

      let highscores = readHighscores();
      highscores.push({
        name: name.trim().slice(0, 20) || "Player",
        score,
        cards,
        rows,
        date: new Date().toISOString()
      });
      highscores.sort((a, b) => b.score - a.score);
      highscores = highscores.slice(0, 10);
      fs.writeFileSync(highscoresPath, JSON.stringify(highscores, null, 2));
      sendJson(res, 200, highscores);
    });
    return true;
  }

  sendJson(res, 405, { error: "Method not allowed" });
  return true;
}

function serveStatic(req, res, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(publicDir, safePath));
  if (!filePath.startsWith(publicDir)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const { pathname } = url;
  if (handleApi(req, res, pathname)) {
    return;
  }
  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`Card Tower game running at http://localhost:${PORT}`);
  refreshPokedexCache(MIN_POKEDEX_CARD_COUNT)
    .then(() => {
      refreshPokedexCache(DEFAULT_POKEDEX_CARD_COUNT).catch(() => {
        // Ignore background warm errors.
      });
    })
    .catch(() => {
      // Ignore cache warm errors to keep server startup resilient.
    });
});
