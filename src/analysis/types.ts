/**
 * 분석 단계가 주고받는 데이터 형식. 원본 analysis.json 과 같은 필드 이름·단위를 쓴다(JSON으로 저장 가능한 값만).
 * 원본: app\pipeline\types.py, analyze.py
 */

import type { WaveMap } from './wave.ts';

/** 분석 방식 이름. 앞의 5개는 01a, 뒤 3개(drums·melody·vocal)는 01b에서 추가된다. */
export type DetectorId = 'hybrid' | 'flux' | 'bass' | 'treble' | 'energy' | 'drums' | 'melody' | 'vocal';

/** 01a가 지원하는 검출 방식 (순서가 novelty 배열의 순서와 같다) */
export const BASE_DETECTORS = ['hybrid', 'flux', 'bass', 'treble', 'energy'] as const;
export type BaseDetectorId = (typeof BASE_DETECTORS)[number];

export const DETECTOR_NAMES: Record<string, string> = {
  hybrid: '종합 (주파수 변화 + 음량 변화)',
  flux: '타격 변화 (소리가 새로 시작되는 순간)',
  bass: '저음 중심 (킥·베이스)',
  treble: '고음 중심 (하이햇·타악기)',
  energy: '음량 변화 (갑자기 커지는 순간)',
};

/** 소리 대역 이름 (저음 / 중음 / 고음) */
export const BANDS = ['low', 'mid', 'high'] as const;
export type Band = (typeof BANDS)[number];

/** 분석 방식이 바뀌면 올려서 옛 저장 결과를 무시한다 */
export const ANALYSIS_VERSION = '0.1.0';

/** 분석 옵션 */
export interface AnalyzeOptions {
  detector: DetectorId;
  /** 지점 민감도 10~100 (기본 60) */
  sensitivity: number;
  /** 최소 간격(ms) 30~500 (기본 75) */
  minGapMs: number;
  /** 사용자가 직접 정한 BPM·시작 위치. audio_offset_ms 가 null/없음이면 자동 값을 쓴다. */
  manual?: { bpm: number; audio_offset_ms?: number | null } | null;
}

export const DEFAULT_ANALYZE_OPTIONS: AnalyzeOptions = { detector: 'hybrid', sensitivity: 60, minGapMs: 75, manual: null };

/** 노트 후보 한 개 (원본 Candidate.to_dict) */
export interface Candidate {
  /** 소리가 시작되는 시각(음원 기준 ms, 소수 둘째 자리) */
  time_ms: number;
  /** 세기 0~1 (소수 넷째 자리) */
  strength: number;
  band: Band;
  /** 소리가 이어지는 길이(ms, 소수 첫째 자리) */
  duration_ms: number;
}

export interface BpmCandidate {
  bpm: number;
  kind: string; // '주 후보' | '반 박' | '두 배 박'
  confidence: number; // 0~1
}

export interface TimingChoice {
  source: 'auto' | 'manual';
  bpm: number;
  audio_offset_ms: number;
  auto: { bpm: number; audio_offset_ms: number; before: { bpm: number; audio_offset_ms: number } };
  user: { bpm: number; audio_offset_ms: number } | null;
}

export interface GridFit {
  total: number;
  fit: number;
  percent: number;
  division: number;
  tolerance_ms: number;
}

export interface WaveformSummary {
  step_ms: number;
  duration_ms: number;
  min: number[];
  max: number[];
}

export interface AudioInfo {
  sample_rate: number;
  duration_ms: number;
  lead_silence_ms: number;
}

/** 분석 결과(AnalysisResult). 원본 analysis.json 과 같은 모양 + waveform. */
export interface AnalysisResult {
  version: string;
  /** 곡 이름(분석 함수는 모르므로 빈 문자열. 저장소가 곡 이름을 채운다) */
  song: string;
  audio_sha256: string;
  created_at: string;
  info: AudioInfo;
  options: { detector: string; sensitivity: number; min_gap_ms: number };
  beats: {
    bpm_candidates: BpmCandidate[];
    interval_cv: number | null;
    has_downbeats: boolean;
    librosa_bpm: number; // 원본 이름 유지: 박 추적이 처음 찾은 BPM(이 버전은 자기상관 추정값)
    beats_ms: number[];
    beat_count: number;
  };
  timing: TimingChoice;
  candidates: Candidate[];
  candidate_count: number;
  warnings: string[];
  grid_fit: GridFit;
  waveform: WaveformSummary;
  /** [04e] 음원 파형(20ms마다 전체·저음·중음·고음 크기). 분석 직후에만 들어 있고, 저장소가 따로 보관한 뒤 분석 기록에서는 뺀다 */
  wave?: WaveMap;
}

/** 분석 진행 알림: p는 0~1, label은 화면에 보일 한국어 단계 이름 */
export type ProgressFn = (p: number, label: string) => void;

/** 분석 중 사용자에게 그대로 보여 줄 수 있는 한국어 메시지를 가진 오류 */
export class AnalysisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnalysisError';
  }
}
