/**
 * 모드 확장용 분석 호출 도우미(01a 파일을 고치지 않고 모드 정보를 더하는 감싸기).
 *  - analyzeAudioWithMode: analyzeAudio 결과에 `mode` 필드(호환 추가)를 붙인다. 화면 스레드·테스트용.
 *  - analyzeFileWithMode: 파일에서 시작하는 화면용 호출. 보컬 모드면 스테레오로 읽어 워커에 같이 보낸다.
 *    (워커 호출은 workerClient 의 analyzeInWorker 를 그대로 쓰며, 스테레오 소리는 options.stereo 로 전달한다.)
 */
import { analyzeAudio } from '../analyze.ts';
import { analyzeInWorker } from '../workerClient.ts';
import type { AnalysisResult, AnalyzeOptions, ProgressFn } from '../types.ts';
import { decodeStereo22k } from './decodeStereo22k.ts';
import { withStereo } from './vocal.ts';

/** 모드 표시가 붙은 분석 결과(계약 AnalysisResult 에 mode 만 더한 호환 추가) */
export type ModeAnalysisResult = AnalysisResult & { mode: string };

/** analyzeAudio 와 같고, 결과에 `mode`(= 쓴 분석 방식 이름)를 붙인다. */
export async function analyzeAudioWithMode(
  samples: Float32Array,
  options: Partial<AnalyzeOptions>,
  onProgress?: ProgressFn,
  signal?: AbortSignal,
): Promise<ModeAnalysisResult> {
  const res = await analyzeAudio(samples, options, onProgress, signal);
  return Object.assign(res, { mode: res.options.detector });
}

/** 파일 → (보컬이면 스테레오로 읽어) 워커 분석 → `mode` 붙인 결과. 화면에서 쓰는 호출. */
export async function analyzeFileWithMode(
  file: File | ArrayBuffer,
  options: Partial<AnalyzeOptions>,
  onProgress?: ProgressFn,
): Promise<ModeAnalysisResult> {
  const detector = options.detector ?? 'hybrid';
  let res: AnalysisResult;
  if (detector === 'vocal') {
    onProgress?.(0, '소리 불러오는 중');
    const dec = await decodeStereo22k(file);
    res = await analyzeInWorker(dec.mono, dec.isMono ? options : withStereo(options, dec.left, dec.right), onProgress);
  } else {
    res = await analyzeInWorker(file, options, onProgress);
  }
  return Object.assign(res, { mode: res.options.detector });
}
