/**
 * 유니티 ChartInbox 폴더 연결·보내기(순수 로직). 폴더 핸들은 인자로 받으므로 가짜 핸들로 시험할 수 있다.
 * 안전 장치: 폴더 안에 유니티가 만든 표시 파일 `.chartlink.json`(chart-link.v1)이 있어야만 연결로 인정한다(웹은 읽기만 한다).
 * 보내기 순서: 연결 재확인 → 곡 폴더 → 기존 manifest 읽고 삭제 → 파일 쓰기(manifest 마지막) → 빠진 옛 파일 정리.
 */
import type { BundleFile } from './unityBundle.ts';

// ---------- 필요한 최소 타입(File System Access API) ----------

export interface LinkWritable {
  write(data: Blob | string): Promise<void>;
  close(): Promise<void>;
}
export interface LinkFileHandle {
  getFile(): Promise<{ size: number; text(): Promise<string> }>;
  createWritable(): Promise<LinkWritable>;
}
export interface LinkDirHandle {
  name: string;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<LinkFileHandle>;
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<LinkDirHandle>;
  removeEntry(name: string, opts?: { recursive?: boolean }): Promise<void>;
  queryPermission?(desc: { mode: 'read' | 'readwrite' }): Promise<'granted' | 'denied' | 'prompt'>;
  requestPermission?(desc: { mode: 'read' | 'readwrite' }): Promise<'granted' | 'denied' | 'prompt'>;
}

export const MARKER_FILE = '.chartlink.json';
export const LINK_FORMAT = 'chart-link.v1';
export const LINK_APP = 'MHRChartInbox';

export const MSG_NOT_INBOX = '이 폴더는 유니티 ChartInbox 폴더가 아닙니다. 유니티의 Chart Sync 창이 만든 ChartInbox 폴더를 골라 주세요.';
export const MSG_BAD_MARKER = 'ChartInbox 표시 파일을 읽을 수 없습니다. 유니티에서 Chart Sync 창을 열어 폴더를 다시 만들어 주세요.';
export const MSG_NO_4KEY = '이 유니티 폴더는 4키 채보를 받지 않습니다.';
export const MSG_WRITE_FAIL = '유니티 폴더에 쓰지 못했습니다. 폴더 권한이나 빈 공간을 확인해 주세요. 대신 ZIP으로 저장할 수 있습니다.';

/** 연결·보내기 오류(메시지는 화면에 그대로 보여도 되는 쉬운 한국어). code: marker=연결 무효, write=쓰기 실패, input=묶음 이상 */
export class UnityLinkError extends Error {
  code: 'marker' | 'write' | 'input';
  constructor(message: string, code: 'marker' | 'write' | 'input' = 'write') {
    super(message);
    this.name = 'UnityLinkError';
    this.code = code;
  }
}

/** 이 브라우저가 폴더 선택창(showDirectoryPicker)을 지원하는가 */
export function isLinkSupported(): boolean {
  return typeof window !== 'undefined' && typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}

/** 표시 파일을 읽고 검증한다. 어긋나면 UnityLinkError(code 'marker') */
export async function readLinkMarker(dir: LinkDirHandle): Promise<{ projectName: string }> {
  let text: string;
  try {
    const fh = await dir.getFileHandle(MARKER_FILE);
    text = await (await fh.getFile()).text();
  } catch (e) {
    const n = (e as { name?: string } | null)?.name;
    throw new UnityLinkError(n === 'NotFoundError' || n === 'TypeMismatchError' ? MSG_NOT_INBOX : MSG_BAD_MARKER, 'marker');
  }
  let data: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text.replace(/^﻿/, ''));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not object');
    data = parsed as Record<string, unknown>;
  } catch {
    throw new UnityLinkError(MSG_BAD_MARKER, 'marker');
  }
  if (data.format !== LINK_FORMAT || data.app !== LINK_APP || typeof data.projectName !== 'string' || !data.projectName.trim() || !Array.isArray(data.keyModes)) {
    throw new UnityLinkError(MSG_BAD_MARKER, 'marker');
  }
  if (!data.keyModes.includes(4)) throw new UnityLinkError(MSG_NO_4KEY, 'marker');
  return { projectName: data.projectName };
}

/** 곡 폴더 이름(곡 키)이 영문·숫자 16자리인가(경로 이탈 방지) */
export function isSongFolderName(name: unknown): name is string {
  return typeof name === 'string' && /^[A-Za-z0-9]{16}$/.test(name);
}

/** 곡 폴더 안 파일 이름으로 쓸 수 있는가(하위 경로·점 이름 금지) */
function isSafeFileName(name: unknown): name is string {
  return typeof name === 'string' && /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(name);
}

/** 데이터의 바이트 수 */
function byteLength(data: Blob | string): number {
  return typeof data === 'string' ? new TextEncoder().encode(data).length : data.size;
}

/** 곡 폴더의 기존 manifest.json 을 읽어 이전 파일 이름 목록을 돌려준다(없거나 깨져 있으면 빈 목록, 존재 여부는 found) */
async function readOldManifest(songDir: LinkDirHandle): Promise<{ found: boolean; names: string[] }> {
  let fh: LinkFileHandle;
  try {
    fh = await songDir.getFileHandle('manifest.json');
  } catch {
    return { found: false, names: [] };
  }
  try {
    const m = JSON.parse(await (await fh.getFile()).text());
    const names = Array.isArray(m?.files) ? m.files.map((f: { name?: unknown }) => f?.name).filter(isSafeFileName) : [];
    return { found: true, names };
  } catch {
    return { found: true, names: [] };
  }
}

/**
 * 묶음을 연결된 ChartInbox 의 곡 폴더에 쓴다. bundle 은 buildUnityBundle 결과({folder, files}).
 * 쓰다 중단되면 manifest.json 이 없는 채로 남아 유니티가 미완성으로 본다.
 */
export async function sendBundleToDir(
  dir: LinkDirHandle,
  bundle: { folder: string; files: BundleFile[] },
  onProgress?: (done: number, total: number) => void,
): Promise<{ folder: string; written: string[]; removed: string[] }> {
  await readLinkMarker(dir); // 1. 연결이 아직 유효한가
  if (!isSongFolderName(bundle.folder)) throw new UnityLinkError('곡 폴더 이름이 올바르지 않아 보낼 수 없습니다.', 'input');
  const files = bundle.files;
  if (!files.length || files[files.length - 1]!.name !== 'manifest.json') throw new UnityLinkError('묶음의 마지막 파일이 manifest.json 이 아니라 보낼 수 없습니다.', 'input');
  if (!files.every((f) => isSafeFileName(f.name))) throw new UnityLinkError('묶음에 올바르지 않은 파일 이름이 있어 보낼 수 없습니다.', 'input');

  const written: string[] = [];
  const removed: string[] = [];
  try {
    const songDir = await dir.getDirectoryHandle(bundle.folder, { create: true }); // 2
    const old = await readOldManifest(songDir); // 3. 옛 manifest 를 먼저 읽고 지운다
    if (old.found) await songDir.removeEntry('manifest.json');
    for (let i = 0; i < files.length; i++) { // 4
      const f = files[i]!;
      const fh = await songDir.getFileHandle(f.name, { create: true });
      const w = await fh.createWritable();
      await w.write(f.data);
      await w.close();
      const size = (await (await songDir.getFileHandle(f.name)).getFile()).size;
      if (size !== byteLength(f.data)) throw new Error(`size mismatch: ${f.name}`);
      written.push(f.name);
      onProgress?.(i + 1, files.length); // 6
    }
    const keep = new Set(files.map((f) => f.name));
    for (const name of old.names) { // 5. 이번 묶음에 없는 옛 파일만(곡 폴더 안에서만)
      if (keep.has(name)) continue;
      try {
        await songDir.removeEntry(name);
        removed.push(name);
      } catch (e) {
        if ((e as { name?: string } | null)?.name !== 'NotFoundError') throw e;
      }
    }
  } catch (e) {
    if (e instanceof UnityLinkError) throw e;
    throw new UnityLinkError(MSG_WRITE_FAIL, 'write');
  }
  return { folder: bundle.folder, written, removed };
}
