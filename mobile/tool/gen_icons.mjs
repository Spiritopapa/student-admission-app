// SchoolRunner Android launcher icon generator (no dependencies).
// Android launcher icons MUST be indexed-colour PNGs (colour type 3;
// AAPT2 rejects RGB icons on release builds). Master stays full RGB.
import { deflateSync, crc32 } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const resDir = join(rootDir, "android", "app", "src", "main", "res");
const INDIGO = [79, 70, 229], TEAL = [13, 148, 136], AMBER = [245, 158, 11];
const WHITE = [255, 255, 255], FACE = [230, 232, 240];

// CRC-32 comes from node:zlib (validated against Python's zlib).
function u32(v) { return [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]; }
function chunk(t, d) { const tb = Buffer.from(t, "ascii"); return Buffer.concat([Buffer.from(u32(d.length)), tb, d, Buffer.from(u32(crc32(Buffer.concat([tb, d]))))]); }
const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function ihdr(size, ct) { const b = Buffer.alloc(13); b.writeUInt32BE(size, 0); b.writeUInt32BE(size, 4); b[8] = 8; b[9] = ct; return b; }

function encodeIndexed(size, pal, alphas, idxFn) {
  const plte = Buffer.alloc(pal.length * 3);
  pal.forEach(([r, g, b], i) => { plte[i * 3] = r; plte[i * 3 + 1] = g; plte[i * 3 + 2] = b; });
  const textee = chunk("tEXt", Buffer.from("Author\u0000SchoolRunner", "latin1"));
  const trns = chunk("tRNS", Buffer.from(alphas));
  const stride = 1 + size, raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) { raw[y * stride] = 0; for (let x = 0; x < size; x++) raw[y * stride + 1 + x] = idxFn(x, y); }
  return Buffer.concat([SIG, chunk("IHDR", ihdr(size, 3)), textee, chunk("PLTE", plte), trns, chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

function encodeRgb(size, pxFn) {
  const stride = 1 + size * 3, raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) { raw[y * stride] = 0; for (let x = 0; x < size; x++) { const [r, g, b] = pxFn(x, y); const o = y * stride + 1 + x * 3; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; } }
  return Buffer.concat([SIG, chunk("IHDR", ihdr(size, 2)), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const inRect = (px, py, x0, y0, w, h) => px >= x0 && px <= x0 + w && py >= y0 && py <= y0 + h;
function inRR(px, py, x0, y0, w, h, r) {
  if (!inRect(px, py, x0, y0, w, h)) return false;
  const cx = Math.min(Math.max(px, x0 + r), x0 + w - r), cy = Math.min(Math.max(py, y0 + r), y0 + h - r);
  const dx = px - cx, dy = py - cy; return dx * dx + dy * dy <= r * r;
}
function dSeg(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby)));
  const dx = px - (ax + t * abx), dy = py - (ay + t * aby); return Math.sqrt(dx * dx + dy * dy);
}
const inDia = (px, py, cx, cy, r) => Math.abs(px - cx) / r + Math.abs(py - cy) / r <= 1;
function lerp(a, b, t) { return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)]; }

function painter(size) {
  const pal = [], alphas = [], seen = new Map();
  const idx = (rgb, a) => { const k = rgb[0] * 65536 + rgb[1] * 256 + rgb[2]; if (seen.has(k)) return seen.get(k); const i = pal.length; pal.push(rgb); alphas.push(a); seen.set(k, i); return i; };
  const iT = idx([0, 0, 0], 0); // transparent corner
  const iW = idx(WHITE, 255), iF = idx(FACE, 255), iA = idx(AMBER, 255);
  const rows = new Array(size);
  for (let y = 0; y < size; y++) rows[y] = idx(lerp(INDIGO, TEAL, (y + 0.5) / size), 255);
  const fn = (x, y) => {
    const nx = (x + 0.5) / size, ny = (y + 0.5) / size;
    if (!inRR(nx, ny, 0, 0, 1, 1, 0.22)) return iT; // Android-style rounded corners
    if (inRR(nx, ny, 0.15, 0.25, 0.7, 0.16, 0.045)) return iW;
    if (inRect(nx, ny, 0.335, 0.41, 0.33, 0.17)) return iF;
    if (dSeg(nx, ny, 0.85, 0.33, 0.925, 0.52) < 0.018) return iA;
    if (inDia(nx, ny, 0.935, 0.585, 0.032)) return iA;
    return rows[y];
  };
  return { pal, alphas, fn };
}

const TARGETS = [["mipmap-mdpi", 48], ["mipmap-hdpi", 72], ["mipmap-xhdpi", 96], ["mipmap-xxhdpi", 144], ["mipmap-xxxhdpi", 192]];
for (const [dir, size] of TARGETS) {
  const { pal, alphas, fn } = painter(size);
  const out = join(resDir, dir, "ic_launcher.png");
  mkdirSync(join(resDir, dir), { recursive: true });
  writeFileSync(out, encodeIndexed(size, pal, alphas, fn));
  console.log("wrote " + out + " (" + size + "x" + size + ", palette " + pal.length + ")");
}

const mdir = join(rootDir, "assets", "icon");
mkdirSync(mdir, { recursive: true });
const mpath = join(mdir, "app_icon.png");
writeFileSync(mpath, encodeRgb(1024, (x, y) => {
  const s = 1024, nx = (x + 0.5) / s, ny = (y + 0.5) / s;
  let bg = lerp(INDIGO, TEAL, ny);
  if (nx > 0.5 && ny > 0.5) { const t = Math.pow(Math.max(0, (nx - 0.5) / 0.5) * ((ny - 0.5) / 0.5), 1.4); bg = lerp(bg, AMBER, t * 0.5); }
  if (inRR(nx, ny, 0.15, 0.25, 0.7, 0.16, 0.045)) return WHITE;
  if (inRect(nx, ny, 0.335, 0.41, 0.33, 0.17)) return FACE;
  if (dSeg(nx, ny, 0.85, 0.33, 0.925, 0.52) < 0.018) return AMBER;
  if (inDia(nx, ny, 0.935, 0.585, 0.032)) return AMBER;
  return bg;
}));
console.log("wrote " + mpath + " (1024x1024)");