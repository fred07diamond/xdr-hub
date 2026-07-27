// Generates PNG icons for the Chrome extension. Run with: node gen-icons.js
// Outputs icon-16.png, icon-32.png, icon-48.png, icon-128.png
// No dependencies — pure Node.js with built-in zlib.
const zlib = require("zlib");
const fs = require("fs");

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++)
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const tb = Buffer.from(type);
  const lb = Buffer.allocUnsafe(4);
  lb.writeUInt32BE(data.length);
  const cb = Buffer.allocUnsafe(4);
  cb.writeUInt32BE(crc32(Buffer.concat([tb, data])));
  return Buffer.concat([lb, tb, data, cb]);
}

function createPNG(size) {
  // BLI blue #0a66c2 with rounded corners (radius = 22% of size), RGBA
  const radius = Math.round(size * 0.22);
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rowBytes = 1 + size * 4;
  const raw = Buffer.alloc(rowBytes * size, 0);

  for (let y = 0; y < size; y++) {
    raw[y * rowBytes] = 0; // filter none
    for (let x = 0; x < size; x++) {
      const off = y * rowBytes + 1 + x * 4;
      // Rounded corner check
      let inShape = true;
      if (x < radius && y < radius) {
        inShape = Math.hypot(x - radius, y - radius) <= radius;
      } else if (x >= size - radius && y < radius) {
        inShape = Math.hypot(x - (size - 1 - radius), y - radius) <= radius;
      } else if (x < radius && y >= size - radius) {
        inShape = Math.hypot(x - radius, y - (size - 1 - radius)) <= radius;
      } else if (x >= size - radius && y >= size - radius) {
        inShape = Math.hypot(x - (size - 1 - radius), y - (size - 1 - radius)) <= radius;
      }
      if (inShape) {
        raw[off]     = 10;  // R
        raw[off + 1] = 102; // G
        raw[off + 2] = 194; // B
        raw[off + 3] = 255; // A
      }
    }
  }

  const compressed = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", compressed), chunk("IEND", Buffer.alloc(0))]);
}

for (const size of [16, 32, 48, 128]) {
  const png = createPNG(size);
  fs.writeFileSync(`icon-${size}.png`, png);
  console.log(`icon-${size}.png (${png.length} bytes)`);
}
