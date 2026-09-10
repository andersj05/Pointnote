import { zlibSync } from 'fflate';
import { writeFile } from 'node:fs/promises';
// Deterministic RGBA PNGs keep the project free of runtime image dependencies.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), out.length - 4);
  return out;
}
export async function makeIcons() {
  for (const size of [16, 32, 48, 128]) {
    const pixels = Buffer.alloc(size * (size * 4 + 1));
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const nx = x / size,
          ny = y / size;
        const mark =
          (nx > 0.29 && nx < 0.42 && ny > 0.24 && ny < 0.79) ||
          ((nx - 0.47) ** 2 + (ny - 0.4) ** 2 < 0.17 ** 2 && nx > 0.37);
        const i = y * (size * 4 + 1) + 1 + x * 4;
        pixels.set(mark ? [245, 246, 225, 255] : [37, 66, 51, 255], i);
      }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(size);
    header.writeUInt32BE(size, 4);
    header[8] = 8;
    header[9] = 6;
    await writeFile(
      `dist/icon${size}.png`,
      Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', header),
        chunk('IDAT', Buffer.from(zlibSync(pixels))),
        chunk('IEND', Buffer.alloc(0)),
      ]),
    );
  }
}
