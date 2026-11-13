// Vite plugin for the ShipArt tool (shipart.html).
// While `npm run dev` runs it adds two addresses the tool talks to:
//   GET  /__shipart/files  every .png in public/assets (so new art shows up in the tool by itself)
//   POST /__shipart/save   writes the layouts the tool sends to public/assets/ships.json
// When building for publishing, it writes the same file list to assets/art-files.json,
// so the online (view-only) ShipArt knows which images exist.

import { readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { Plugin } from 'vite';

/** Every .png under `dir`, as paths relative to it with forward slashes ("parts/thruster-boost-1.png"). */
function listArt(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.toLowerCase().endsWith('.png')) out.push(relative(dir, p).split('\\').join('/'));
    }
  };
  walk(dir);
  return out.sort();
}

export function shipArtPlugin(): Plugin {
  let assetsDir = '';
  return {
    name: 'shipart',
    configResolved(config) {
      assetsDir = resolve(config.root, 'public/assets');
    },
    configureServer(server) {
      server.middlewares.use('/__shipart/files', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ files: listArt(assetsDir) }));
      });
      server.middlewares.use('/__shipart/save', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('POST only');
          return;
        }
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
          if (body.length > 2_000_000) req.destroy(); // far bigger than any real layout file
        });
        req.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (typeof data !== 'object' || !data || typeof data.ships !== 'object') throw new Error('not a layouts file');
            writeFileSync(join(assetsDir, 'ships.json'), JSON.stringify(data, null, 2) + '\n');
            res.end('saved');
          } catch (e) {
            res.statusCode = 400;
            res.end(`Not saved: ${(e as Error).message}`);
          }
        });
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'assets/art-files.json', source: JSON.stringify({ files: listArt(assetsDir) }) });
    },
  };
}
