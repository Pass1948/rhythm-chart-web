/**
 * 불러오기용 ZIP 읽기: [채보 JSON + 음원] ZIP 에서 채보와 음원을 꺼낸다.
 * - 채보 JSON 과 음원이 모두 있으면 둘 다 돌려준다(새 곡으로 한 번에 복원).
 * - JSON 만 있으면 채보만, 음원만 있으면 음원만 돌려준다(음원만 있는 경우는 화면이 "채보가 없는 음원" 안내를 한다).
 */
import { readZip, ZipError, type ZipEntry } from './zip.ts';
import { isFourKeyUnityData } from '../core/chartIo.ts';

const AUDIO_EXT = /\.(mp3|wav|m4a|ogg|flac)$/i;

export interface BundleContent {
  /** 채보 JSON 글자 (없으면 null) */
  chartText: string | null;
  chartName: string | null;
  /** 음원 (없으면 null) */
  audio: { name: string; blob: Blob } | null;
}

/** 폴더 경로를 뺀 파일 이름 */
function baseName(path: string): string {
  return path.split('/').pop() ?? path;
}

/** ZIP 에서 채보 JSON 과 음원을 찾는다. 같은 종류가 여러 개면 `채보.json` 과 첫 음원을 우선한다. */
export async function readBundle(file: Blob): Promise<BundleContent> {
  const entries = await readZip(file);
  const visible = entries.filter((e) => !baseName(e.name).startsWith('.') && !e.name.startsWith('__MACOSX/'));
  const jsons = visible.filter((e) => /\.json$/i.test(e.name) && baseName(e.name).toLowerCase() !== 'manifest.json');
  const audios = visible.filter((e) => AUDIO_EXT.test(e.name));
  const pick = (list: ZipEntry[], prefer: string): ZipEntry | null => list.find((e) => baseName(e.name) === prefer) ?? list[0] ?? null;
  const jsonEntry = jsons.find((e) => baseName(e.name) === '채보.json')
    ?? jsons.find((e) => /^chart_.+\.json$/i.test(baseName(e.name))) ?? jsons[0] ?? null;
  const audioEntry = pick(audios, '');
  if (!jsonEntry && !audioEntry) throw new ZipError('이 ZIP 안에서 채보 JSON 이나 음원 파일을 찾지 못했습니다.');
  let chartText: string | null = null;
  if (jsonEntry) {
    const decoder = new TextDecoder('utf-8');
    chartText = decoder.decode(await jsonEntry.read());
    if (jsons.length > 1 && baseName(jsonEntry.name) !== '채보.json') {
      const primary = JSON.parse(chartText);
      if (isFourKeyUnityData(primary)) {
        const names = new Set(primary.difficulties.map((diff) => typeof diff?.name === 'string' ? diff.name.toUpperCase() : null));
        for (const entry of jsons) {
          if (entry === jsonEntry) continue;
          const text = decoder.decode(await entry.read());
          let other: unknown;
          try {
            other = JSON.parse(text);
          } catch {
            continue;
          }
          if (!isFourKeyUnityData(other)) continue;
          for (const diff of other.difficulties) {
            const name = typeof diff?.name === 'string' ? diff.name.toUpperCase() : null;
            if (!name || names.has(name)) continue;
            primary.difficulties.push(diff);
            names.add(name);
          }
        }
        chartText = JSON.stringify(primary);
      }
    }
  }
  let audio: BundleContent['audio'] = null;
  if (audioEntry) {
    const bytes = await audioEntry.read();
    const name = baseName(audioEntry.name);
    audio = { name, blob: new Blob([bytes as BlobPart], { type: mimeOf(name) }) };
  }
  return { chartText, chartName: jsonEntry ? baseName(jsonEntry.name) : null, audio };
}

/** 확장자로 짐작한 음원 형식 */
function mimeOf(name: string): string {
  const ext = /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase();
  return ({ mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg', flac: 'audio/flac' } as Record<string, string>)[ext ?? ''] ?? 'application/octet-stream';
}
