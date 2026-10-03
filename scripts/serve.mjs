import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
};

const TEXT_EXT = new Set([
  '.html', '.js', '.mjs', '.css', '.svg', '.json', '.webmanifest', '.txt', '.csv',
]);

function contentType(file) {
  const ext = path.extname(file).toLowerCase();
  const base = MIME[ext] ?? 'application/octet-stream';
  return TEXT_EXT.has(ext) ? `${base}; charset=utf-8` : base;
}

function insideRoot(root, candidate) {
  const rel = path.relative(root, candidate);
  return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

function locate(root, rawUrl) {
  let pathname;
  try {
    pathname = new URL(rawUrl, 'http://127.0.0.1').pathname;
  } catch {
    return { status: 400 };
  }
  let decoded;
  try {
    // Decode before the root check so %2e%2e and %2f cannot leave the directory.
    decoded = decodeURIComponent(pathname);
  } catch {
    return { status: 400 };
  }
  if (decoded.includes('\0')) return { status: 400 };

  const segments = decoded.split(/[/\\]/).filter((segment) => segment.length > 0);
  if (segments.includes('..')) return { status: 403 };

  const candidate = path.resolve(root, ...segments);
  if (!insideRoot(root, candidate)) return { status: 403 };

  let stat;
  try {
    stat = fs.statSync(candidate);
  } catch (error) {
    if (error && error.code === 'ENOENT') return { status: 404 };
    throw error;
  }

  const file = stat.isDirectory() ? path.join(candidate, 'index.html') : candidate;
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return { status: 404 };

  const real = fs.realpathSync(file);
  if (!insideRoot(root, real)) return { status: 403 };
  return { file: real };
}

function send(res, status, body, type) {
  const payload = body ?? Buffer.alloc(0);
  const headers = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Length': payload.length,
  };
  if (type) headers['Content-Type'] = type;
  res.writeHead(status, headers);
  res.end(payload);
}

export function startServer(dir, port) {
  const root = fs.realpathSync(path.resolve(dir));
  const server = http.createServer((req, res) => {
    const found = locate(root, req.url ?? '/');
    if (!found.file) {
      send(res, found.status);
      return;
    }
    send(res, 200, fs.readFileSync(found.file), contentType(found.file));
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('expected a TCP address'));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}/`,
        close() {
          return new Promise((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
            server.closeAllConnections();
          });
        },
      });
    });
  });
}

function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (invokedDirectly()) {
  const dir = process.argv[2];
  const portArg = process.argv[3];
  const port = Number(portArg);
  if (!dir || portArg === undefined || !Number.isInteger(port) || port < 0 || port > 65535) {
    console.error('usage: node scripts/serve.mjs <dir> <port>');
    process.exit(1);
  }
  startServer(dir, port).then(
    (server) => {
      console.log(server.url);
    },
    (error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    },
  );
}
