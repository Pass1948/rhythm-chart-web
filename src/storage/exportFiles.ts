/**
 * 내보내기 파일 만들기: 무엇을 내보낼지(채보 JSON / 음원 / 채보 JSON + 음원)에 따라 저장할 파일 목록을 만든다.
 * 게시 환경에서는 mp3·wav·m4a 를 직접 저장할 수 없고 json·zip 만 저장할 수 있어서, 음원은 ZIP 에 담는다.
 * 저장 파일은 항상 1개다(여러 파일이면 ZIP 하나로 묶는다).
 */
import { exportEditJson, exportUnity, exportUnitySplit, safeName } from '../core/index.ts';
import type { ChartV2 } from '../core/schema.ts';
import { buildUnityBundle } from './unityBundle.ts';
import { writeZip, ZipError } from './zip.ts';

export type ExportWhat = 'chart' | 'audio' | 'both' | 'unity';
export type ChartKind = 'unity' | 'edit';

/** 저장할 파일 한 개 */
export interface ExportFile {
  /** 저장할 파일 이름(곡 이름 기준, 한글 가능) */
  name: string;
  blob: Blob;
  mime: string;
  /** 화면에 보일 종류 이름 */
  label: string;
  size: number;
}

export interface ExportInput {
  what: ExportWhat;
  kind: ChartKind;
  split: boolean;
  chart: ChartV2;
  /** 업로드한 원본 음원 */
  audioBlob?: Blob | null;
  /** 원본 음원 파일 이름(확장자 포함) */
  audioFileName?: string;
}

/** ZIP 안에 넣는 안내 글 */
export const README_TEXT = [
  '이 ZIP 은 리듬 채보 웹에서 내보낸 [채보 JSON + 음원] 묶음입니다.',
  '',
  '- 채보.json : 편집용 채보 파일',
  '- 음원 파일 : 업로드했던 원본 음원',
  '',
  '다시 열려면: 리듬 채보 웹 위쪽의 [불러오기]에서 이 ZIP 파일을 고르세요.',
  '음원과 채보가 한 번에 새 곡으로 복원됩니다.',
  '',
].join('\r\n');

/** 파일 이름에서 확장자를 뺀다 */
function stem(name: string): string {
  return name.replace(/\.[^.\\/]+$/, '');
}

/** ZIP 안에 넣을 음원 이름: 원본 이름 그대로(금지 문자만 정리) */
export function audioEntryName(fileName: string | undefined): string {
  const raw = (fileName || '').trim();
  return raw ? safeName(raw) : '음원.mp3';
}

/** 저장 파일 이름에 쓸 곡 이름 */
export function exportBaseName(chart: ChartV2, audioFileName?: string): string {
  return safeName(chart.song.title || (audioFileName ? stem(audioFileName) : '') || 'chart');
}

/** 저장할 파일 목록을 만든다. */
export async function buildExportFiles(input: ExportInput): Promise<ExportFile[]> {
  const base = exportBaseName(input.chart, input.audioFileName);
  const json = (name: string, text: string, label: string): ExportFile => {
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    return { name, blob, mime: 'application/json', label, size: blob.size };
  };
  const zip = async (name: string, files: { name: string; data: Blob | string }[], label: string): Promise<ExportFile> => {
    const blob = await writeZip(files);
    return { name, blob, mime: 'application/zip', label, size: blob.size };
  };

  if (input.what === 'unity') {
    const bundle = await buildUnityBundle({ chart: input.chart, audioBlob: input.audioBlob, audioFileName: input.audioFileName });
    return [await zip(`${base}_유니티묶음.zip`, bundle.files.map((f) => ({ name: `${bundle.folder}/${f.name}`, data: f.data })), '유니티 묶음(ZIP)')];
  }
  if (input.what === 'audio') {
    if (!input.audioBlob) throw new ZipError('이 곡의 음원 파일이 없어 내보낼 수 없습니다.');
    return [await zip(`${base}_음원.zip`, [{ name: audioEntryName(input.audioFileName), data: input.audioBlob }], '음원(ZIP)')];
  }
  if (input.what === 'both') {
    if (!input.audioBlob) throw new ZipError('이 곡의 음원 파일이 없어 내보낼 수 없습니다.');
    const audioName = audioEntryName(input.audioFileName);
    return [
      await zip(
        `${base}_채보+음원.zip`,
        [
          { name: '채보.json', data: exportEditJson(input.chart) },
          { name: audioName, data: input.audioBlob },
          { name: '읽어보세요.txt', data: README_TEXT },
        ],
        '채보 JSON + 음원(ZIP)',
      ),
    ];
  }
  // 채보 JSON (지금 방식)
  if (input.kind === 'edit') return [json(`${base}_편집용.json`, exportEditJson(input.chart), '채보 JSON(편집용)')];
  if (input.split) {
    const parts = exportUnitySplit(input.chart);
    if (parts.length > 1) {
      return [
        await zip(
          `${base}_unity_난이도별.zip`,
          parts.map((p) => ({ name: `${base}_${p.difficulties[0]!.name}.json`, data: JSON.stringify(p, null, 2) })),
          '채보 JSON(Unity용, 난이도별 ZIP)',
        ),
      ];
    }
    const part = parts[0];
    if (part) return [json(`${base}_${part.difficulties[0]!.name}.json`, JSON.stringify(part, null, 2), '채보 JSON(Unity용)')];
  }
  return [json(`${base}_unity.json`, JSON.stringify(exportUnity(input.chart), null, 2), '채보 JSON(Unity용)')];
}
