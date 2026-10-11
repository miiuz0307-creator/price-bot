// Serves the mobile app's web export (APP_DIR) on PORT and forwards /api to the
// real server (API_URL), so the preview behaves like the phone app (same origin).
import { createReadStream, existsSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";

const dir = path.resolve(process.env.APP_DIR ?? "artifacts/price-bot-mobile/dist-web");
const api = new URL(process.env.API_URL ?? "http://127.0.0.1:8080");
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".ico": "image/x-icon", ".ttf": "font/ttf", ".svg": "image/svg+xml" };

http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    const upstream = http.request({ hostname: api.hostname, port: api.port, path: req.url, method: req.method, headers: req.headers }, (response) => {
      res.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(res);
    });
    upstream.on("error", () => { res.writeHead(502); res.end(); });
    req.pipe(upstream);
    return;
  }
  const clean = decodeURIComponent(req.url.split("?")[0]);
  let file = path.join(dir, clean);
  if (!file.startsWith(dir) || !existsSync(file) || statSync(file).isDirectory()) file = path.join(dir, "index.html");
  res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
}).listen(Number(process.env.PORT ?? 8081), () => console.log("app preview ready"));
