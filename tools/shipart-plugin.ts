// Vite plugin for the ShipArt tool (shipart.html).
// While `npm run dev` runs it adds two addresses the tool talks to:
//   GET  /__shipart/files  every .png in public/assets (so new art shows up in the tool by itself)
//   POST /__shipart/save   writes the layouts the tool sends to public/assets/ships.json
//   GET  /__shipart/info   the project folder's Windows path, if it's shared from Windows into
//                          the container (so ShipArt can offer "Copy folder path"). Worked out
//                          while running, never written to a file: it contains the user's name.
// When building for publishing, it writes the same file list to assets/art-files.json,
// so the online (view-only) ShipArt knows which images exist.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
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

/**
 * The Windows folder `dir` is shared from (e.g. C:\Users\…\GameTestClaude), read from the
 * container's list of mounted folders, or null if it isn't a shared Windows folder.
 */
function windowsPathOf(dir: string): string | null {
  try {
    for (const line of readFileSync('/proc/self/mountinfo', 'utf8').split('\n')) {
      // Fields: id, parent, dev, root, mount point, ... " - " type, source, options.
      const [left, right] = line.split(' - ');
      if (!right) continue;
      const f = left.split(' ');
      const root = f[3];
      const mountPoint = f[4];
      if (!dir.startsWith(mountPoint) || mountPoint === '/') continue;
      // The source is the drive, with "\" written as "\134" (e.g. "C:\134").
      const drive = /^([A-Za-z]:)/.exec(right.split(' ')[1] ?? '')?.[1];
      if (!drive) continue;
      const rest = (root + dir.slice(mountPoint.length)).split('/').filter(Boolean).join('\\');
      return `${drive}\\${rest}`;
    }
  } catch {
    // Not Linux, or no access: no Windows path.
  }
  return null;
}

export function shipArtPlugin(): Plugin {
  let assetsDir = '';
  let root = '';
  return {
    name: 'shipart',
    configResolved(config) {
      root = config.root;
      assetsDir = resolve(config.root, 'public/assets');
    },
    configureServer(server) {
      server.middlewares.use('/__shipart/info', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ windowsRoot: windowsPathOf(root) }));
      });
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
