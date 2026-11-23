/**
 * Minimal ZIP reader/writer used by the packaging pipeline and its tests.
 *
 * Both halves live here so the release archive is produced and verified by the
 * same TypeScript code that runs in CI: no external zip tool, no Python.
 */
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_RECORD = 0x06054b50;
const UTF8_FLAG = 0x0800;
const VERSION = 20;
const STORED = 0;
const DEFLATED = 8;

const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipSourceEntry {
  /** Archive path, always separated with forward slashes. */
  name: string;
  data: Buffer;
  modified?: Date;
}

export interface ZipEntry {
  name: string;
  directory: boolean;
  data: Buffer;
}

function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, date: day };
}

/** Build a ZIP archive with DEFLATE-compressed, UTF-8 named entries. */
export function buildZip(entries: ZipSourceEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.from(entry.data);
    const payload = deflateRawSync(data, { level: 9 });
    const checksum = crc32(data);
    const stamp = dosDateTime(entry.modified ?? new Date());

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_HEADER, 0);
    local.writeUInt16LE(VERSION, 4);
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(DEFLATED, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_HEADER, 0);
    central.writeUInt16LE((3 << 8) | VERSION, 4);
    central.writeUInt16LE(VERSION, 6);
    central.writeUInt16LE(UTF8_FLAG, 8);
    central.writeUInt16LE(DEFLATED, 10);
    central.writeUInt16LE(stamp.time, 12);
    central.writeUInt16LE(stamp.date, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    // External attributes carry the Unix mode in the high 16 bits; shift as
    // unsigned so values above 2^31 stay valid for writeUInt32LE.
    central.writeUInt32LE(((0o100644 << 16) >>> 0), 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + payload.length;
  }

  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_RECORD, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, directory, end]);
}

/** Read every entry of a ZIP archive, verifying its CRC and stored size. */
export function readZip(buffer: Buffer): ZipEntry[] {
  if (buffer.length < 22) throw new Error('Not a ZIP archive: file too small');
  let end = -1;
  const lowest = Math.max(0, buffer.length - 22 - 0xffff);
  for (let index = buffer.length - 22; index >= lowest; index -= 1) {
    if (buffer.readUInt32LE(index) === END_RECORD) {
      end = index;
      break;
    }
  }
  if (end < 0) throw new Error('Not a ZIP archive: end record missing');

  const count = buffer.readUInt16LE(end + 10);
  const directorySize = buffer.readUInt32LE(end + 12);
  let cursor = buffer.readUInt32LE(end + 16);
  if (cursor + directorySize > buffer.length) throw new Error('ZIP central directory is truncated');

  const entries: ZipEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(cursor) !== CENTRAL_HEADER) throw new Error('Corrupt ZIP central directory entry');
    const method = buffer.readUInt16LE(cursor + 10);
    const checksum = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const size = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    cursor += 46 + nameLength + extraLength + commentLength;

    if (buffer.readUInt32LE(localOffset) !== LOCAL_HEADER) throw new Error(`Corrupt ZIP local header: ${name}`);
    const dataStart = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const stored = buffer.subarray(dataStart, dataStart + compressedSize);
    let data: Buffer;
    if (method === DEFLATED) data = inflateRawSync(stored);
    else if (method === STORED) data = Buffer.from(stored);
    else throw new Error(`Unsupported ZIP compression method ${method}: ${name}`);
    if (data.length !== size) throw new Error(`ZIP entry size mismatch: ${name}`);
    if (crc32(data) !== checksum) throw new Error(`ZIP entry checksum mismatch: ${name}`);
    entries.push({ name, directory: name.endsWith('/'), data });
  }
  return entries;
}

/** Full structural and checksum verification; returns the entry names. */
export function verifyZip(buffer: Buffer): string[] {
  return readZip(buffer).map(entry => entry.name);
}

export function listDirectory(directory: string): string[] {
  const files: string[] = [];
  const walk = (current: string): void => {
    for (const name of readdirSync(current).sort()) {
      const path = join(current, name);
      if (statSync(path).isDirectory()) walk(path);
      else files.push(path);
    }
  };
  walk(directory);
  return files;
}

/**
 * Zip `directory` so every entry is rooted at the folder's own name, which is
 * what the portable Windows layout expects after extraction.
 */
export function writeZipFromDirectory(directory: string, output: string): string[] {
  const root = basename(directory);
  const entries = listDirectory(directory).map(path => ({
    name: `${root}/${relative(directory, path).split(sep).join('/')}`,
    data: readFileSync(path),
    modified: statSync(path).mtime,
  }));
  const archive = buildZip(entries);
  writeFileSync(output, archive);
  return verifyZip(archive);
}
