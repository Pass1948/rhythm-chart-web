/**
 * ZIP 묶기·풀기(직접 구현, 새 라이브러리 없음).
 * - 쓰기: 압축하지 않는 방식(store). CRC32 를 직접 계산한다. 큰 음원은 Blob 조각으로 이어 붙여 메모리 복사를 줄인다.
 * - 읽기: store 와 deflate 를 지원한다(deflate 는 브라우저의 DecompressionStream('deflate-raw') 사용, 없으면 store 만).
 * - 파일 이름은 UTF-8 플래그(0x0800)를 세워 한글 이름이 깨지지 않게 한다.
 * - 4GB 를 넘는 ZIP64 는 다루지 않는다.
 */

/** 묶을 파일 한 개 */
export interface ZipInput {
  name: string;
  data: Blob | Uint8Array | ArrayBuffer | string;
}

/** 읽은 파일 한 개 */
export interface ZipEntry {
  name: string;
  size: number;
  /** 압축을 푼 내용을 읽는다(CRC 를 확인한다) */
  read(): Promise<Uint8Array>;
}

/** ZIP 오류(메시지는 화면에 그대로 보여도 되는 쉬운 한국어) */
export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipError';
  }
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
const MAX32 = 0xffffffff;
const CHUNK = 4 * 1024 * 1024;

let crcTable: Uint32Array | null = null;
function table(): Uint32Array {
  if (crcTable) return crcTable;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  crcTable = t;
  return t;
}

/** CRC32 (이어 계산하려면 이전 결과를 prev 로 넘긴다) */
export function crc32(bytes: Uint8Array, prev = 0): number {
  const t = table();
  let c = ~prev >>> 0;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return ~c >>> 0;
}

/** DOS 날짜·시간 */
function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** 입력을 Blob 으로 */
function toBlob(data: ZipInput['data']): Blob {
  if (data instanceof Blob) return data;
  if (typeof data === 'string') return new Blob([new TextEncoder().encode(data) as BlobPart]);
  if (data instanceof Uint8Array) return new Blob([data as BlobPart]);
  return new Blob([data]);
}

/** Blob 의 CRC32 를 조각 단위로 계산한다 */
async function blobCrc(blob: Blob): Promise<number> {
  let crc = 0;
  for (let pos = 0; pos < blob.size; pos += CHUNK) {
    crc = crc32(new Uint8Array(await blob.slice(pos, pos + CHUNK).arrayBuffer()), crc);
  }
  return crc;
}

/** 파일들을 압축 없이 ZIP 하나로 묶는다. 빈 입력은 거절한다. */
export async function writeZip(files: ZipInput[], now: Date = new Date()): Promise<Blob> {
  if (!files.length) throw new ZipError('묶을 파일이 없습니다.');
  const enc = new TextEncoder();
  const { time, date } = dosDateTime(now);
  const parts: BlobPart[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const seen = new Set<string>();
  for (const f of files) {
    const name = String(f.name || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!name) throw new ZipError('파일 이름이 비어 있어 묶을 수 없습니다.');
    if (seen.has(name)) throw new ZipError(`같은 이름의 파일이 두 개 있습니다: ${name}`);
    seen.add(name);
    const nameBytes = enc.encode(name);
    if (nameBytes.length > 0xffff) throw new ZipError('파일 이름이 너무 깁니다.');
    const blob = toBlob(f.data);
    if (blob.size > MAX32 || offset + blob.size > MAX32) throw new ZipError('파일이 너무 커서 ZIP 으로 묶을 수 없습니다(4GB 이하만 가능).');
    const crc = await blobCrc(blob);
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, SIG_LOCAL, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8 이름
    lv.setUint16(8, 0, true); // store
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, blob.size, true);
    lv.setUint32(22, blob.size, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    parts.push(local as BlobPart, blob);
    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, SIG_CENTRAL, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, blob.size, true);
    cv.setUint32(24, blob.size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);
    central.push(cd);
    offset += local.length + blob.size;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, SIG_END, true);
  ev.setUint16(8, central.length, true);
  ev.setUint16(10, central.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  return new Blob([...parts, ...(central as BlobPart[]), end as BlobPart], { type: 'application/zip' });
}

const BROKEN = 'ZIP 파일이 손상되었거나 ZIP 형식이 아닙니다. 다시 내보낸 파일을 사용해 주세요.';

/** 이름 바이트를 글자로 (UTF-8 플래그가 없으면 UTF-8 → CP949 순으로 시도) */
function decodeName(bytes: Uint8Array, utf8Flag: boolean): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    if (!utf8Flag) {
      try {
        return new TextDecoder('euc-kr').decode(bytes);
      } catch {
        /* 아래로 */
      }
    }
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/** deflate-raw 를 푼다. 이 환경에 기능이 없으면 안내 오류 */
async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const DS = (globalThis as { DecompressionStream?: new (format: string) => { readable: ReadableStream; writable: WritableStream } }).DecompressionStream;
  if (!DS) throw new ZipError('이 브라우저는 압축된 ZIP 을 풀 수 없습니다. 이 프로그램에서 내보낸 ZIP(압축 없음)을 사용해 주세요.');
  try {
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DS('deflate-raw') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
    return new Uint8Array(await new Response(stream as unknown as ReadableStream).arrayBuffer());
  } catch {
    throw new ZipError(BROKEN);
  }
}

/** ZIP 의 파일 목록을 읽는다. 내용은 entry.read() 를 부를 때 읽는다. */
export async function readZip(source: Blob | ArrayBuffer | Uint8Array): Promise<ZipEntry[]> {
  const blob = toBlob(source);
  if (blob.size === 0) throw new ZipError('빈 파일입니다. ZIP 파일을 다시 골라 주세요.');
  if (blob.size < 22) throw new ZipError(BROKEN);
  const tailLen = Math.min(blob.size, 22 + 0xffff);
  const tailStart = blob.size - tailLen;
  const tail = new Uint8Array(await blob.slice(tailStart).arrayBuffer());
  const tv = new DataView(tail.buffer);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tv.getUint32(i, true) === SIG_END) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError(BROKEN);
  const count = tv.getUint16(eocd + 10, true);
  const cdSize = tv.getUint32(eocd + 12, true);
  const cdOffset = tv.getUint32(eocd + 16, true);
  if (count === 0xffff || cdSize === MAX32 || cdOffset === MAX32) throw new ZipError('너무 큰 ZIP(ZIP64)은 지원하지 않습니다.');
  if (cdOffset + cdSize > blob.size) throw new ZipError(BROKEN);
  const cd = new Uint8Array(await blob.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
  const cv = new DataView(cd.buffer);
  const entries: ZipEntry[] = [];
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > cd.length || cv.getUint32(p, true) !== SIG_CENTRAL) throw new ZipError(BROKEN);
    const flags = cv.getUint16(p + 8, true);
    const method = cv.getUint16(p + 10, true);
    const crc = cv.getUint32(p + 16, true);
    const csize = cv.getUint32(p + 20, true);
    const usize = cv.getUint32(p + 24, true);
    const nlen = cv.getUint16(p + 28, true);
    const elen = cv.getUint16(p + 30, true);
    const clen = cv.getUint16(p + 32, true);
    const lho = cv.getUint32(p + 42, true);
    if (p + 46 + nlen > cd.length) throw new ZipError(BROKEN);
    const name = decodeName(cd.subarray(p + 46, p + 46 + nlen), (flags & 0x0800) !== 0);
    p += 46 + nlen + elen + clen;
    if (name.endsWith('/')) continue; // 폴더 표시는 건너뛴다
    if (flags & 1) throw new ZipError('암호가 걸린 ZIP 은 열 수 없습니다.');
    entries.push({
      name,
      size: usize,
      read: async () => {
        const head = new DataView(await blob.slice(lho, lho + 30).arrayBuffer());
        if (head.byteLength < 30 || head.getUint32(0, true) !== SIG_LOCAL) throw new ZipError(BROKEN);
        const start = lho + 30 + head.getUint16(26, true) + head.getUint16(28, true);
        if (start + csize > blob.size) throw new ZipError(BROKEN);
        const raw = new Uint8Array(await blob.slice(start, start + csize).arrayBuffer());
        let out: Uint8Array;
        if (method === 0) out = raw;
        else if (method === 8) out = await inflateRaw(raw);
        else throw new ZipError('지원하지 않는 압축 방식의 ZIP 입니다. 이 프로그램에서 내보낸 ZIP 을 사용해 주세요.');
        if (out.length !== usize || crc32(out) !== crc) throw new ZipError(BROKEN);
        return out;
      },
    });
  }
  if (!entries.length) throw new ZipError('ZIP 안에 파일이 없습니다.');
  return entries;
}

/** 파일 앞 4바이트가 ZIP 표시(PK)인가 */
export async function looksLikeZip(file: Blob): Promise<boolean> {
  if (file.size < 4) return false;
  const h = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  return h[0] === 0x50 && h[1] === 0x4b && (h[2] === 3 || h[2] === 5);
}
