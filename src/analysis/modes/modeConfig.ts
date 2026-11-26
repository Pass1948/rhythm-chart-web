/**
 * 분석 모드(드럼·멜로디·보컬 근사)가 쓰는 수치를 한 곳에 모은 파일. 숫자를 바꾸면 코드 수정 없이 동작이 바뀐다.
 * 프레임 간격은 01a와 같은 5ms(HOP 110), 창은 1024(46ms)이다.
 * 이 모드들은 악기를 '진짜로 분리'하지 않는 근사 방식이다. 화면 문구에도 "근사"라고 쓴다.
 */

/** 모든 모드가 결과에 붙이는 안내(쉬운 한국어) */
export const APPROX_NOTICE = '이 분석은 악기를 실제로 분리한 것이 아니라 소리 특징으로 추정한 근사 결과입니다.';
export const MONO_VOCAL_NOTICE = '모노 음원이라 정확도가 낮습니다. (왼쪽·오른쪽 소리 차이를 쓰지 못해 300~3400Hz 대역만 사용했습니다.)';

/**
 * HPSS(타악·화음 나누기) 설정.
 * 시간 방향 중앙값 = 화음(오래 이어지는 소리)만 남김, 주파수 방향 중앙값 = 타악(순간적으로 넓게 퍼지는 소리)만 남김.
 * 창이 클수록 정확하지만 느리다. 3분 곡 40초 안에 끝나지 않으면 여기 값을 줄인다.
 */
export const HPSS = {
  /** 시간 방향 중앙값 창(프레임 수, 홀수). 41프레임 = 약 205ms */
  timeWindow: 41,
  /** 주파수 방향 중앙값 창(빈 수, 홀수). 빈 하나는 약 21.5Hz, 31빈 = 약 670Hz */
  freqWindow: 31,
  /** 소프트 마스크 거듭제곱(2 = 에너지 기준) */
  maskPower: 2,
  /** 아주 작은 값 보호 */
  eps: 1e-9,
};

/** 드럼 중심 */
export const DRUMS = {
  /** 로그 압축 세기: log(1 + gamma × 크기) */
  logGamma: 10,
  /** 변화량을 비교하는 프레임 간격(약 15ms) */
  lag: 3,
  /** 킥(저음) 대역 Hz */
  lowHz: [32, 250] as [number, number],
  /** 스네어·중음 대역 Hz */
  midHz: [250, 1800] as [number, number],
  /** 하이햇(고음) 대역 Hz */
  highHz: [1800, 11025] as [number, number],
  /** 대역 가중치: 킥·하이햇을 중음보다 높게 */
  weight: { low: 1.0, mid: 0.6, high: 0.9 },
  /** 시작 지점 보정에 쓰는 앞뒤 구간(ms) */
  refineBackMs: 45,
  refineFwdMs: 30,
};

/** 멜로디 중심 */
export const MELODY = {
  /** 크로마(12음) 계산 대역 Hz. 낮은 쪽은 주파수 해상도가 모자라 200Hz 아래는 쓰지 않는다 */
  chromaHz: [200, 4000] as [number, number],
  /** 크로마 변화를 비교하는 앞·뒤 평균 구간(프레임 수, 약 15ms) */
  chromaSpan: 3,
  /** 크로마 변화 vs 화음 성분 스펙트럼 변화 섞는 비율 */
  weightChroma: 0.6,
  weightFlux: 0.4,
  logGamma: 10,
  fluxLag: 3,
  /** 타악 비율(타악 에너지 / 전체)이 prLow 이하면 그대로, prHigh 이상이면 floor 배로 줄인다 */
  percLow: 0.5,
  percHigh: 0.9,
  percFloor: 0.15,
  /** 화음 에너지가 기준(상위 75%값)의 이 비율보다 작으면 소리가 없는 것으로 보고 변화를 줄인다 */
  gateRatio: 0.1,
  refineBackMs: 25,
  refineFwdMs: 30,
};

/** 보컬 근사 */
export const VOCAL = {
  /** 사람 목소리가 많은 대역 Hz */
  bandHz: [300, 3400] as [number, number],
  /** 중앙 성분 뽑기: 중앙(L+R)/2 크기 − beta × 좌우 차이(L−R)/2 크기 */
  sideSuppress: 1.0,
  logGamma: 10,
  lag: 3,
  /** 대역 에너지(dB) 증가를 비교하는 간격(프레임 수, 약 30ms)과 정규화 폭(dB) */
  riseLag: 6,
  riseDb: 20,
  /** 에너지 증가(0~1)를 스펙트럼 변화와 같은 크기로 맞추는 배율 */
  riseGain: 3,
  /** 스펙트럼 변화 vs 대역 에너지 증가 섞는 비율 */
  weightFlux: 0.7,
  weightRise: 0.3,
  /** 좌우 소리가 거의 같으면(차이/중앙 에너지 비율이 이 값 미만) 모노로 본다 */
  monoSideRatio: 0.002,
  refineBackMs: 45,
  refineFwdMs: 30,
};
