/**
 * 테스트·측정 도구가 같이 쓰는 도우미 (Node 에서만 쓴다. 화면 코드에는 들어가지 않는다).
 * - .npy(원본이 저장한 22050Hz 분석용 소리) 읽기: 읽기만 한다
 * - 합성 음원·시작 지점 비교는 test/synth.ts 에 있고 여기서 다시 내보낸다
 */
import { readFileSync } from 'node:fs';

/** float32 1차원 .npy 파일을 읽는다(원본 프로젝트의 audio22k.npy). */
export function readNpyFloat32(path: string): Float32Array {
  const buf = readFileSync(path);
  const magic = new TextDecoder('latin1').decode(buf.subarray(1, 6));
  if (buf[0] !== 0x93 || magic !== 'NUMPY') throw new Error('npy 형식이 아닙니다: ' + path);
  const major = buf[6]!;
  const headerLen = major === 1 ? buf[8]! | (buf[9]! << 8) : buf[8]! | (buf[9]! << 8) | (buf[10]! << 16) | (buf[11]! << 24);
  const start = (major === 1 ? 10 : 12) + headerLen;
  const header = new TextDecoder('latin1').decode(buf.subarray(major === 1 ? 10 : 12, start));
  if (!header.includes("'<f4'")) throw new Error('float32 npy 만 지원합니다: ' + header);
  const bytes = buf.slice(start); // 복사본(정렬 보장)
  return new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4));
}


export { makeSyntheticDrums, matchOnsets, phaseDiffMs } from '../test/synth.ts';
export type { SyntheticOptions } from '../test/synth.ts';
