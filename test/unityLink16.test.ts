// 16단계 단위 테스트: 유니티 폴더 연결 — 표시 파일 검증, 보내기 순서·덮어쓰기·정리·안전 장치(메모리 가짜 폴더 핸들)
import { describe, expect, it } from 'vitest';
import { UnityLinkError, readLinkMarker, sendBundleToDir } from '../src/storage/unityLink.ts';
import type { LinkDirHandle } from '../src/storage/unityLink.ts';

const KEY = 'abcdef0123456789';
const GOOD = { format: 'chart-link.v1', app: 'MHRChartInbox', projectName: 'TestProject', keyModes: [4], createdAt: '2026-11-20T00:00:00.000Z' };

/** 메모리 가짜 폴더. log 에 쓰기·삭제 호출 순서를 기록한다. */
class FakeDir implements LinkDirHandle {
  name = 'fake';
  files = new Map<string, string>();
  dirs = new Map<string, FakeDir>();
  log: string[];
  failWrite = false;
  sizeDelta = 0;
  constructor(log: string[] = []) { this.log = log; }
  private nf(): Error { const e = new Error('nf'); e.name = 'NotFoundError'; return e; }
  async getFileHandle(name: string, o?: { create?: boolean }) {
    if (!this.files.has(name)) { if (!o?.create) throw this.nf(); this.files.set(name, ''); }
    const self = this;
    return {
      getFile: async () => { const t = self.files.get(name)!; return { size: new TextEncoder().encode(t).length + self.sizeDelta, text: async () => t }; },
      createWritable: async () => {
        if (self.failWrite) throw new Error('disk');
        let buf = '';
        return {
          write: async (d: Blob | string) => { buf += typeof d === 'string' ? d : await d.text(); },
          close: async () => { self.files.set(name, buf); self.log.push(`write:${name}`); },
        };
      },
    };
  }
  async getDirectoryHandle(name: string, o?: { create?: boolean }) {
    if (!this.dirs.has(name)) { if (!o?.create) throw this.nf(); this.dirs.set(name, new FakeDir(this.log)); }
    return this.dirs.get(name)!;
  }
  async removeEntry(name: string) {
    if (!this.files.delete(name)) throw this.nf();
    this.log.push(`remove:${name}`);
  }
}

const inbox = (marker: unknown = GOOD): FakeDir => {
  // null 이면 표시 파일 없음
  const d = new FakeDir();
  if (marker !== null) d.files.set('.chartlink.json', typeof marker === 'string' ? marker : JSON.stringify(marker));
  return d;
};
const bundle = (names: string[], tag = 'v1', folder = KEY) => ({ folder, files: names.map((n) => ({ name: n, data: `${n}:${tag}` })) });
const NORMAL = ['audio.mp3', 'chart_Normal.json', 'songInfo.csv', 'chartInfo.csv', 'manifest.json'];
/** manifest 내용을 files 목록과 맞춘 묶음 */
const withManifest = (names: string[], tag = 'v1') => {
  const b = bundle(names, tag);
  b.files[b.files.length - 1]!.data = JSON.stringify({ files: names.filter((n) => n !== 'manifest.json').map((name) => ({ name })) });
  return b;
};

describe('16 유니티 폴더 연결', () => {
  it('① 올바른 표시 파일 통과', async () => {
    expect(await readLinkMarker(inbox())).toEqual({ projectName: 'TestProject' });
  });
  it('② 표시 파일 없음 → 오류', async () => {
    await expect(readLinkMarker(inbox(null))).rejects.toThrow('ChartInbox 폴더가 아닙니다');
  });
  it('③ format/app 불일치 → 오류', async () => {
    await expect(readLinkMarker(inbox({ ...GOOD, format: 'x' }))).rejects.toThrow('표시 파일을 읽을 수 없습니다');
    await expect(readLinkMarker(inbox({ ...GOOD, app: 'Other' }))).rejects.toBeInstanceOf(UnityLinkError);
    await expect(readLinkMarker(inbox({ ...GOOD, projectName: '' }))).rejects.toBeInstanceOf(UnityLinkError);
  });
  it('④ keyModes에 4 없음 → 오류', async () => {
    await expect(readLinkMarker(inbox({ ...GOOD, keyModes: [2] }))).rejects.toThrow('4키 채보를 받지 않습니다');
  });
  it('⑤ JSON 깨짐 → 오류', async () => {
    await expect(readLinkMarker(inbox('{oops'))).rejects.toThrow('표시 파일을 읽을 수 없습니다');
  });

  it('⑥ 쓰기 순서: 기존 manifest 삭제 → 나머지 → manifest 마지막', async () => {
    const d = inbox();
    await sendBundleToDir(d, withManifest(NORMAL));
    d.log.length = 0;
    await sendBundleToDir(d, withManifest(NORMAL, 'v2'));
    expect(d.log).toEqual(['remove:manifest.json', ...NORMAL.map((n) => `write:${n}`)]);
  });

  it('⑦ 다시 보내면 덮어쓰고 내용이 새 것', async () => {
    const d = inbox();
    await sendBundleToDir(d, withManifest(NORMAL, 'v1'));
    await sendBundleToDir(d, withManifest(NORMAL, 'v2'));
    expect(d.dirs.get(KEY)!.files.get('audio.mp3')).toBe('audio.mp3:v2');
  });

  it('⑧ 이전 묶음에만 있던 파일은 삭제, 이번에 있는 파일은 남음', async () => {
    const d = inbox();
    await sendBundleToDir(d, withManifest(['audio.mp3', 'chart_Easy.json', 'chart_Normal.json', 'manifest.json']));
    const r = await sendBundleToDir(d, withManifest(['audio.mp3', 'chart_Normal.json', 'manifest.json'], 'v2'));
    expect(r.removed).toEqual(['chart_Easy.json']);
    expect([...d.dirs.get(KEY)!.files.keys()].sort()).toEqual(['audio.mp3', 'chart_Normal.json', 'manifest.json']);
  });

  it('⑨ 곡 폴더 밖 파일·다른 곡 폴더·곡 폴더 안의 낯선 파일은 그대로', async () => {
    const d = inbox();
    d.files.set('memo.txt', 'x');
    const other = new FakeDir(d.log);
    other.files.set('manifest.json', JSON.stringify({ files: [{ name: 'a.json' }] }));
    other.files.set('a.json', 'keep');
    d.dirs.set('1111111111111111', other);
    await sendBundleToDir(d, withManifest(['audio.mp3', 'manifest.json']));
    d.dirs.get(KEY)!.files.set('mine.txt', 'z');
    await sendBundleToDir(d, withManifest(['audio.mp3', 'chart_Normal.json', 'manifest.json']));
    expect(d.files.get('memo.txt')).toBe('x');
    expect(other.files.get('a.json')).toBe('keep');
    expect(d.dirs.get(KEY)!.files.get('mine.txt')).toBe('z');
  });

  it('⑩ 곡 키 형식이 아니면 오류', async () => {
    for (const f of ['../x', '', 'abc', 'abcdef01234567890', 'abcdef012345678/']) {
      await expect(sendBundleToDir(inbox(), bundle(NORMAL, 'v1', f))).rejects.toBeInstanceOf(UnityLinkError);
    }
  });

  it('⑪ 쓴 크기가 다르면 오류', async () => {
    const d = inbox();
    await sendBundleToDir(d, bundle(['manifest.json'])); // 곡 폴더 만들기
    d.dirs.get(KEY)!.sizeDelta = 1;
    await expect(sendBundleToDir(d, bundle(NORMAL))).rejects.toThrow('ZIP으로 저장');
  });

  it('⑫ 쓰기 중 오류 → UnityLinkError, manifest 없이 남음', async () => {
    const d = inbox();
    await sendBundleToDir(d, withManifest(NORMAL));
    d.dirs.get(KEY)!.failWrite = true;
    const err = await sendBundleToDir(d, withManifest(NORMAL, 'v2')).catch((e) => e);
    expect(err).toBeInstanceOf(UnityLinkError);
    expect(err.code).toBe('write');
    expect(d.dirs.get(KEY)!.files.has('manifest.json')).toBe(false);
  });

  it('⑬ manifest 가 마지막이 아니면 오류(아무것도 쓰기 전에)', async () => {
    const d = inbox();
    await expect(sendBundleToDir(d, bundle(['manifest.json', 'audio.mp3']))).rejects.toBeInstanceOf(UnityLinkError);
    expect(d.dirs.size).toBe(0);
  });

  it('⑭ 진행 콜백이 1부터 전체 수까지', async () => {
    const calls: [number, number][] = [];
    await sendBundleToDir(inbox(), bundle(NORMAL), (a, b) => calls.push([a, b]));
    expect(calls).toEqual([[1, 5], [2, 5], [3, 5], [4, 5], [5, 5]]);
  });

  it('연결이 무효해지면(표시 파일 삭제) 보내기 오류 code=marker', async () => {
    const d = inbox();
    d.files.delete('.chartlink.json');
    const err = await sendBundleToDir(d, bundle(NORMAL)).catch((e) => e);
    expect(err.code).toBe('marker');
  });
});
