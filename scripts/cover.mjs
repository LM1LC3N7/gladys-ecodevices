// Generates cover.png (800x534) for gladys-ecodevices: plain Node, no dependency.
// An electricity meter, a DIN-rail module with its inputs and network port, a
// water and a gas meter wired to it, on a gradient (no brand logo).
// Usage: node scripts/cover.mjs cover.png
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const W = 800;
const H = 534;
const px = Buffer.alloc(W * H * 3);
const set = (x, y, [r, g, b], a = 1) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = px[i] * (1 - a) + r * a;
  px[i + 1] = px[i + 1] * (1 - a) + g * a;
  px[i + 2] = px[i + 2] * (1 - a) + b * a;
};
const skyAt = (x, y) => {
  const t = (x / W) * 0.7 + (y / H) * 0.3;
  return [60 + 40 * t, 150 - 90 * t, 220 - 110 * t];
};
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    set(x, y, skyAt(x, y));
  }
}
const white = [255, 255, 255];
const dark = [28, 38, 64];
const sun = [255, 200, 50];
const green = [90, 210, 130];
const disc = (cx, cy, r, color, alpha = 1) => {
  for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y += 1) {
    for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x += 1) {
      const a = Math.max(0, Math.min(1, r - Math.hypot(x - cx, y - cy) + 0.5));
      if (a > 0) set(x, y, color, a * alpha);
    }
  }
};
const box = (x0, y0, x1, y1, r, color, alpha = 1) => {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const cx = Math.min(Math.max(x, x0 + r), x1 - r);
      const cy = Math.min(Math.max(y, y0 + r), y1 - r);
      const a = Math.max(0, Math.min(1, r - Math.hypot(x - cx, y - cy) + 0.5));
      if (a > 0) set(x, y, color, a * alpha);
    }
  }
};
const line = (x0, y0, x1, y1, width, color) => {
  const minX = Math.floor(Math.min(x0, x1) - width);
  const maxX = Math.ceil(Math.max(x0, x1) + width);
  const minY = Math.floor(Math.min(y0, y1) - width);
  const maxY = Math.ceil(Math.max(y0, y1) + width);
  const len2 = (x1 - x0) ** 2 + (y1 - y0) ** 2 || 1;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const t = Math.max(0, Math.min(1, ((x - x0) * (x1 - x0) + (y - y0) * (y1 - y0)) / len2));
      const d = Math.hypot(x - (x0 + t * (x1 - x0)), y - (y0 + t * (y1 - y0)));
      const a = Math.max(0, Math.min(1, width / 2 - d + 0.5));
      if (a > 0) set(x, y, color, a);
    }
  }
};

disc(400, 270, 260, white, 0.05);
const blue = [80, 160, 240];
const amber = [250, 170, 60];

// The electricity meter (teleinformation output) on the left.
box(60, 110, 230, 420, 20, white);
box(80, 140, 210, 200, 8, dark);
for (let k = 0; k < 4; k += 1) {
  box(90 + k * 29, 155, 112 + k * 29, 188, 4, green, 0.9);
}
disc(145, 260, 22, sun);
disc(100, 380, 9, [120, 128, 145]);
disc(190, 380, 9, [120, 128, 145]);

// The DIN-rail module in the middle: two teleinfo and two pulse inputs, a network port.
line(280, 300, 520, 300, 18, [170, 178, 192]);
box(320, 160, 480, 440, 18, white);
box(340, 190, 460, 240, 6, dark);
disc(360, 215, 7, green);
disc(390, 215, 7, green);
disc(420, 215, 7, blue);
disc(440, 215, 7, amber);
box(370, 380, 430, 420, 4, dark);
for (let k = 0; k < 4; k += 1) {
  disc(350 + k * 33, 270, 9, [120, 128, 145]);
}

// Water and gas meters on the right, each with its dial.
for (const [y0, color] of [
  [100, blue],
  [300, amber],
]) {
  box(580, y0, 740, y0 + 150, 20, white);
  disc(660, y0 + 75, 48, dark);
  disc(660, y0 + 75, 40, color, 0.9);
  line(660, y0 + 75, 690, y0 + 50, 6, dark);
}

// The wires from the meters to the module.
line(145, 420, 145, 480, 8, dark);
line(145, 480, 360, 480, 8, dark);
line(360, 480, 360, 440, 8, dark);
line(580, 175, 520, 175, 8, dark);
line(520, 175, 520, 250, 8, dark);
line(520, 250, 480, 250, 8, dark);
line(580, 375, 520, 375, 8, dark);
line(520, 375, 520, 330, 8, dark);
line(520, 330, 480, 330, 8, dark);
// PNG encoding.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 2;
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y += 1) {
  raw[y * (W * 3 + 1)] = 0;
  px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
}
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(process.argv[2] ?? 'cover.png', png);
console.log('cover', png.length, 'bytes');
