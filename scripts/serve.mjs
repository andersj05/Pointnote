import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve('samples');
http
  .createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(
        new URL(req.url, 'http://localhost').pathname,
      );
      const path = resolve(
        root,
        `.${pathname === '/' ? '/report.html' : pathname}`,
      );
      if (!path.startsWith(root + sep)) {
        res.writeHead(403).end();
        return;
      }
      const bytes = await readFile(path);
      res.writeHead(200, {
        'Content-Type':
          {
            '.html': 'text/html',
            '.css': 'text/css',
            '.js': 'text/javascript',
            '.svg': 'image/svg+xml',
          }[extname(path)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(bytes);
    } catch {
      res.writeHead(404).end('Not found');
    }
  })
  .listen(4173, '127.0.0.1', () =>
    console.log('Pointnote samples: http://127.0.0.1:4173'),
  );
