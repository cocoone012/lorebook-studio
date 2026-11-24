// Dependency-free ZIP writer. Only explicitly selected project files are shipped.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
require('./build.cjs');
const root = path.resolve(__dirname, '..');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const prefix = 'risu-lorebook-studio/';
const files = ['AGENTS.md', 'START_HERE.md', 'RESUME_PROMPT.txt', 'HANDOFF.md', 'README.md', '.gitignore', 'package.json'];
function collect(relative) {
  // Keep older local releases, but ship only this version in the handoff archive.
  if (/^dist\/lorebook-studio-v.+\.js$/.test(relative) && relative !== 'dist/lorebook-studio-v' + version + '.js') return;
  const full = path.join(root, relative);
  const stat = fs.lstatSync(full);
  if (stat.isSymbolicLink()) throw new Error('Archive does not follow symlinks: ' + relative);
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(full).sort()) collect(relative + '/' + name);
  } else if (stat.isFile()) files.push(relative);
}
for (const folder of ['src', 'scripts', 'tests', 'preview', 'docs', 'dist']) collect(folder);
files.sort();
const manifest = {
  name: '로어북 스튜디오 & 번역기', version,
  handoffDate: '2026-11-24',
  note: 'Source and offline sample data only. No real RisuAI user data, API keys, node_modules, upstream source cache, or logs.',
  files: files.map(file => {
    const data = fs.readFileSync(path.join(root, file));
    return { path: file, bytes: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex') };
  })
};
fs.writeFileSync(path.join(root, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
files.push('MANIFEST.json');
const crcTable = Array.from({ length: 256 }, (_, byte) => {
  let value = byte;
  for (let i = 0; i < 8; i++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(data) {
  let value = 0xffffffff;
  for (const byte of data) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
const date = new Date();
const dosTime = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1);
const dosDate = ((Math.max(date.getUTCFullYear(), 1980) - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
const locals = []; const central = []; let offset = 0;
for (const file of files) {
  const name = Buffer.from(prefix + file, 'utf8');
  const data = fs.readFileSync(path.join(root, file));
  const packed = zlib.deflateRawSync(data, { level: 9 });
  const checksum = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x800, 6); local.writeUInt16LE(8, 8);
  local.writeUInt16LE(dosTime, 10); local.writeUInt16LE(dosDate, 12);
  local.writeUInt32LE(checksum, 14); local.writeUInt32LE(packed.length, 18);
  local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
  locals.push(local, name, packed);
  const record = Buffer.alloc(46);
  record.writeUInt32LE(0x02014b50, 0); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6);
  record.writeUInt16LE(0x800, 8); record.writeUInt16LE(8, 10);
  record.writeUInt16LE(dosTime, 12); record.writeUInt16LE(dosDate, 14);
  record.writeUInt32LE(checksum, 16); record.writeUInt32LE(packed.length, 20);
  record.writeUInt32LE(data.length, 24); record.writeUInt16LE(name.length, 28);
  record.writeUInt32LE(offset, 42); central.push(record, name);
  offset += local.length + name.length + packed.length;
}
if (files.length > 65535 || offset > 0xffffffff) throw new Error('Archive is too large for this ZIP writer.');
const directory = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
const archive = Buffer.concat([...locals, directory, end]);
const out = path.join(root, 'deliverables'); fs.mkdirSync(out, { recursive: true });
const filename = 'lorebook-studio-v' + version + '-handoff.zip';
fs.writeFileSync(path.join(out, filename), archive);
fs.writeFileSync(path.join(out, filename + '.sha256'), crypto.createHash('sha256').update(archive).digest('hex') + '  ' + filename + '\n');
console.log('Packaged deliverables/' + filename + ' (' + files.length + ' files, ' + archive.length + ' bytes)');
