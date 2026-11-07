// SPDX-License-Identifier: MPL-2.0
import { readFile, readdir, mkdir, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
async function zip(root, output) {
  const local = [],
    central = [];
  let offset = 0;
  for (const file of (await readdir(root, { recursive: true })).sort()) {
    if (!(await stat(`${root}/${file}`)).isFile()) continue;
    const name = Buffer.from(file.replaceAll('\\', '/'));
    const data = await readFile(`${root}/${file}`);
    const packed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(8, 8);
    h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(packed.length, 18);
    h.writeUInt32LE(data.length, 22);
    h.writeUInt16LE(name.length, 26);
    local.push(h, name, packed);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(packed.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += h.length + name.length + packed.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length / 2, 8);
  end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(
    central.reduce((n, b) => n + b.length, 0),
    12,
  );
  end.writeUInt32LE(offset, 16);
  await writeFile(output, Buffer.concat([...local, ...central, end]));
}
await mkdir('release', { recursive: true });
for (const target of ['chromium', 'sdk'])
  await zip(`dist/${target}`, `release/ogleans-${target}-v0.2.0-alpha.1.zip`);
const checksums = [];
for (const file of await readdir('release'))
  if (file.endsWith('.zip'))
    checksums.push(
      `${createHash('sha256')
        .update(await readFile(`release/${file}`))
        .digest('hex')}  ${file}`,
    );
await writeFile('release/SHA256SUMS.txt', checksums.join('\n') + '\n');
console.log(checksums.join('\n'));
