/** Tiny offline static server for review/v95-deepseek/showcase.html. */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(HERE, "../..");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon"
};

export function startServer({ port = 4600, host = "127.0.0.1" } = {}) {
  const server = createServer(async (req, res) => {
    try {
      if (req.url === "/favicon.ico") {
        res.writeHead(204).end();
        return;
      }
      const url = new URL(req.url || "/", "http://127.0.0.1");
      const pathname = decodeURIComponent(url.pathname === "/" ? "/review/v95-deepseek/showcase.html" : url.pathname);
      const file = resolve(ROOT, "." + pathname);
      if (file !== ROOT && !file.startsWith(ROOT + sep)) {
        res.writeHead(403).end("Forbidden");
        return;
      }
      const data = await readFile(file);
      res.writeHead(200, {
        "Content-Type": MIME[extname(file).toLowerCase()] || "application/octet-stream",
        "Cache-Control": "no-store"
      });
      res.end(data);
    } catch (_error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
    }
  });
  return new Promise((ok, fail) => {
    server.once("error", fail);
    server.listen(port, host, () => {
      const address = server.address();
      ok({
        server,
        port: address.port,
        url: `http://${host}:${address.port}/review/v95-deepseek/showcase.html`,
        close: () => new Promise(done => server.close(done))
      });
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] || 4600);
  const handle = await startServer({ port });
  process.stdout.write(`V9.5 showcase: ${handle.url}\n`);
}
