// Vite plugin for the ShipArt tool (shipart.html).
// While `npm run dev` runs it adds two addresses the tool talks to:
//   GET  /__shipart/files  every .png in public/assets (so new art shows up in the tool by itself)
//   POST /__shipart/save   writes the layouts the tool sends to public/assets/art.json
//   POST /__shipart/manifest  changes sprite entries in public/assets/manifest.json (speed, loop,
//                          image files), rewriting only those entries' lines
//   POST /__shipart/import-zip?name=vfx.x  unpacks a zip of PNG frames into public/assets/vfx/x/
//                          (frame-01.png, frame-02.png...) and returns their paths
//   GET  /__shipart/info   the project folder's Windows path, if it's shared from Windows into
//                          the container (so ShipArt can offer "Copy folder path"). Worked out
//                          while running, never written to a file: it contains the user's name.
// When building for publishing, it writes the same file list to assets/art-files.json,
// so the online (view-only) ShipArt knows which images exist.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
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

/** A manifest entry on one line, in the file's own style: { "file": "vfx/x.png", "fps": 12 }. */
function entryLine(entry: Record<string, unknown>) {
  const parts = Object.entries(entry)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `"${k}": ${Array.isArray(v) ? `[${v.map((x) => JSON.stringify(x)).join(', ')}]` : JSON.stringify(v)}`);
  return `{ ${parts.join(', ')} }`;
}

/** Replace the lines of these sprite entries in manifest.json, keeping everything else as it is. */
function patchManifest(assetsDir: string, sprites: Record<string, Record<string, unknown>>) {
  const path = join(assetsDir, 'manifest.json');
  let text = readFileSync(path, 'utf8');
  for (const [name, entry] of Object.entries(sprites)) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const line = new RegExp(`^(\\s*"${escaped}":\\s*)\\{.*\\}(,?)\\s*$`, 'm');
    if (!line.test(text)) throw new Error(`no entry named ${name} in manifest.json`);
    text = text.replace(line, (_m, start: string, comma: string) => `${start}${entryLine(entry)}${comma}`);
  }
  JSON.parse(text); // never write a broken file
  writeFileSync(path, text);
}

/** The files in a zip archive (folders skipped). Handles normal and "stored" (uncompressed) entries. */
function unzip(buf: Buffer): { name: string; data: Buffer }[] {
  // The "end of central directory" record sits at the end (before an optional comment).
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--)
    if (buf.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const out: { name: string; data: Buffer }[] = [];
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('damaged zip file');
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    if (name.endsWith('/')) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    if (method === 0) out.push({ name, data: raw });
    else if (method === 8) out.push({ name, data: inflateRawSync(raw) });
    else throw new Error(`${name}: unsupported compression in the zip`);
  }
  return out;
}

/** A PNG's width and height (from its header), or null if it isn't a PNG. */
function pngSize(data: Buffer) {
  if (data.length < 24 || data.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: data.readUInt32BE(16), h: data.readUInt32BE(20) };
}

/**
 * Unpack a zip of PNG frames for effect `name` ("vfx.explosion.t2") into
 * public/assets/vfx/explosion-t2/frame-01.png..., in name order, replacing an
 * earlier import there. All frames must be the same size.
 */
function importZip(assetsDir: string, name: string, zip: Buffer) {
  if (!/^vfx\.[a-z0-9.-]+$/i.test(name)) throw new Error('only vfx.* images can be imported');
  const frames = unzip(zip)
    .filter((f) => /\.png$/i.test(f.name) && !f.name.startsWith('__MACOSX/') && !/(^|\/)\./.test(f.name))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
  if (!frames.length) throw new Error('no PNG images in the zip');
  const sizes = frames.map((f) => pngSize(f.data));
  const first = sizes[0];
  if (!first) throw new Error(`${frames[0].name} is not a PNG`);
  const odd = frames.find((_, i) => !sizes[i] || sizes[i]!.w !== first.w || sizes[i]!.h !== first.h);
  if (odd) throw new Error(`${odd.name} is a different size from ${frames[0].name} (${first.w}×${first.h}); all frames must match`);
  const folder = 'vfx/' + name.replace(/^vfx\./, '').replace(/\./g, '-');
  const dir = join(assetsDir, folder);
  // Replace an earlier import: remove its frames (only PNGs, only in this folder).
  if (existsSync(dir)) for (const f of readdirSync(dir)) if (/\.png$/i.test(f)) rmSync(join(dir, f));
  mkdirSync(dir, { recursive: true });
  const digits = Math.max(2, String(frames.length).length);
  const files = frames.map((f, i) => {
    const file = `${folder}/frame-${String(i + 1).padStart(digits, '0')}.png`;
    writeFileSync(join(assetsDir, file), f.data);
    return file;
  });
  return { files, width: first.w, height: first.h };
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
      server.middlewares.use('/__shipart/import-zip', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('POST only');
          return;
        }
        const name = new URL(req.url ?? '', 'http://x').searchParams.get('name') ?? '';
        const chunks: Buffer[] = [];
        let size = 0;
        req.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 100_000_000) req.destroy(); // a frame sequence won't be this big
          chunks.push(chunk);
        });
        req.on('end', () => {
          res.setHeader('Content-Type', 'application/json');
          try {
            res.end(JSON.stringify(importZip(assetsDir, name, Buffer.concat(chunks))));
          } catch (e) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: (e as Error).message }));
          }
        });
      });
      server.middlewares.use('/__shipart/manifest', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('POST only');
          return;
        }
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (typeof data?.sprites !== 'object') throw new Error('no sprites');
            patchManifest(assetsDir, data.sprites);
            res.end('saved');
          } catch (e) {
            res.statusCode = 400;
            res.end(`Not saved: ${(e as Error).message}`);
          }
        });
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
            writeFileSync(join(assetsDir, 'art.json'), JSON.stringify(data, null, 2) + '\n');
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
