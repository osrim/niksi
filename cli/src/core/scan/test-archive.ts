import { deflateRawSync, gzipSync } from "node:zlib";

const STORED = 0;
const DEFLATED = 8;
const UNIX = 3;

export interface ZipEntry {
  name: string;
  data?: string | Uint8Array;
  // Defaults to deflate. Any other method stores the bytes as given.
  method?: number;
  flags?: number;
  // Unix mode, such as 0o100755.
  mode?: number;
  // Deflate level. Level 0 keeps the data at its size.
  level?: number;
  // Inflated size the headers declare, when it should differ from the data.
  declared?: number;
}

const bytes = (data: string | Uint8Array = ""): Buffer => Buffer.from(data);

const zipParts = (entry: ZipEntry, offset: number): { local: Buffer; central: Buffer } => {
  const raw = bytes(entry.data);
  const method = entry.method ?? DEFLATED;
  const packed = method === DEFLATED ? deflateRawSync(raw, { level: entry.level ?? 6 }) : raw;
  const name = Buffer.from(entry.name);
  const crc = Bun.hash.crc32(raw);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(entry.flags ?? 0, 6);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(packed.length, 18);
  local.writeUInt32LE(entry.declared ?? raw.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(entry.mode === undefined ? 20 : (UNIX << 8) | 20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(entry.flags ?? 0, 8);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(packed.length, 20);
  central.writeUInt32LE(entry.declared ?? raw.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(((entry.mode ?? 0) << 16) >>> 0, 38);
  central.writeUInt32LE(offset, 42);
  return {
    local: Buffer.concat([local, name, packed]),
    central: Buffer.concat([central, name]),
  };
};

export const zip = (...entries: ZipEntry[]): Buffer => {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const { local, central } = zipParts(entry, offset);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
};

export const stored = (name: string, data: string | Uint8Array = ""): ZipEntry => ({
  name,
  data,
  method: STORED,
});

export interface TarEntry {
  name: string;
  data?: string | Uint8Array;
  // "0" file, "2" symlink, "5" directory, and so on.
  type?: string;
  link?: string;
  mode?: number;
  prefix?: string;
}

const tarHeader = (entry: TarEntry, size: number): Buffer => {
  const header = Buffer.alloc(512);
  header.write(entry.name, 0, 100);
  header.write(`${(entry.mode ?? 0o644).toString(8).padStart(7, "0")}\0`, 100);
  header.write(`${size.toString(8).padStart(11, "0")}\0`, 124);
  header.write("        ", 148);
  header.write(entry.type ?? "0", 156);
  header.write(entry.link ?? "", 157, 100);
  header.write("ustar\u000000", 257);
  header.write(entry.prefix ?? "", 345, 155);
  const sum = header.reduce((total, byte) => total + byte, 0);
  header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
  return header;
};

export const tar = (...entries: TarEntry[]): Buffer =>
  Buffer.concat([
    ...entries.flatMap((entry) => {
      const data = bytes(entry.data);
      const padding = Buffer.alloc((512 - (data.length % 512)) % 512);
      return [tarHeader(entry, data.length), data, padding];
    }),
    Buffer.alloc(1024),
  ]);

export const tgz = (...entries: TarEntry[]): Buffer => gzipSync(tar(...entries));
