const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = 4321;

const highscoresPath = path.join(__dirname, "highscores.json");
const publicDir = path.join(__dirname, "public");

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

function handleApi(req, res, pathname) {
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
});
