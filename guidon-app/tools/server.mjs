// Minimal static server for verification. No deps.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import { pathToFileURL } from "node:url";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  // Reference Library's "Original PDF" tab embeds docs/*.pdf in an <iframe>;
  // without an explicit MIME entry this fell through to the generic
  // application/octet-stream default, which browsers typically treat as
  // "unknown binary, offer a download" rather than rendering inline.
  ".pdf": "application/pdf",
};

export function serve(root, port = 0) {
  const server = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (p.endsWith("/")) p += "index.html";
      const file = join(root, normalize(p).replace(/^(\.\.[/\\])+/, ""));
      const st = await stat(file).catch(() => null);
      if (!st || !st.isFile()) {
        res.writeHead(404, { "content-type": "text/plain" });
        return res.end("404");
      }
      const body = await readFile(file);
      res.writeHead(200, {
        "content-type": MIME[extname(file).toLowerCase()] || "application/octet-stream",
        "content-length": body.length,
        // Service workers require no-cache on the SW script itself to update reliably.
        "cache-control": file.endsWith("sw.js") ? "no-cache" : "public, max-age=0",
      });
      res.end(body);
    } catch (e) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(String(e));
    }
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () =>
      resolve({ server, port: server.address().port, url: `http://127.0.0.1:${server.address().port}/` })
    );
  });
}

// A hand-built `file://${path}` string never matches import.meta.url on
// Windows: the real URL has a third slash (file:///C:/...) and percent-
// encodes spaces/special characters, neither of which a plain string
// concat + backslash swap produces. pathToFileURL() builds the same kind
// of URL import.meta.url actually is, so the comparison works cross-platform.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.argv[2] || "web";
  const port = Number(process.argv[3] || 8099);
  serve(root, port).then(({ url }) => console.log("serving", root, "at", url));
}
