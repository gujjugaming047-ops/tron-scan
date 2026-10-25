import { createServer as createHttpsServer } from "node:https";
import { request as httpRequest } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.HTTPS_PORT || 4174);
const upstreamPort = Number(process.env.HTTP_PORT || 4173);
const key = readFileSync(path.join(here, "key.pem"));
const cert = readFileSync(path.join(here, "cert.pem"));

const server = createHttpsServer({ key, cert }, (incoming, outgoing) => {
  const upstream = httpRequest(
    {
      hostname: "127.0.0.1",
      port: upstreamPort,
      method: incoming.method,
      path: incoming.url,
      headers: {
        ...incoming.headers,
        host: `127.0.0.1:${upstreamPort}`,
      },
    },
    (response) => {
      outgoing.writeHead(response.statusCode || 502, response.headers);
      response.pipe(outgoing);
    },
  );
  upstream.on("error", () => {
    if (!outgoing.headersSent) {
      outgoing.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    }
    outgoing.end("Upstream HTTP preview is not reachable.");
  });
  incoming.pipe(upstream);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Local HTTPS preview: https://127.0.0.1:${port}`);
  console.log(`TLS terminator for http://127.0.0.1:${upstreamPort}`);
});
