// 연출 수치 설정 (한 곳): 이펙트 풀 크기, 등급별 이펙트 크기, 이펙트 양 3단계, 피버 연출, 효과음 크기.
// 이펙트는 모두 코드로 그린다(이미지 없음). 값은 보기 좋게 맞춘 [임시] 값이며 사용자가 보고 조정한다.
import type { EffectLevel, Grade } from './core/config/gameConfig';
import type { SfxName } from './sfxSynth';

export type { EffectLevel };


export const EFFECT_LEVELS: readonly EffectLevel[] = ['low', 'normal', 'high'];
export const EFFECT_LEVEL_LABELS: Record<EffectLevel, string> = { low: '적게', normal: '보통', high: '많이' };
export const DEFAULT_EFFECT_LEVEL: EffectLevel = 'normal';

/** 이펙트 하나 분량(빛기둥·링·별)의 등급별 기본값 */
export interface GradeFx {
  /** 빛기둥 높이(px)·폭 비율·지속(ms) */
  beamHeight: number;
  beamWidth: number;
  beamMs: number;
  /** 충격파 링 개수(보통 기준)·마지막 링 반지름(px)·지속(ms) */
  rings: number;
  ringRadius: number;
  ringMs: number;
  /** 별 반짝임 개수(보통 기준) */
  stars: number;
  /** 타격 세기(지금은 쓰지 않음) (1 = PERFECT 기준) */
  hitStrength: number;
  /** 색 */
  color: number;
  /** 링 밝기 (0~1). 등급이 높을수록 밝다 */
  ringBrightness: number;
}

export const EFFECT_CONFIG = {
  /** 이펙트 그림 풀 크기 (동시에 보이는 수의 상한). 넘치면 가장 오래된 것을 다시 쓴다 */
  pools: { beams: 14, rings: 24, stars: 72 },
  /** 이펙트 양 단계별 배율: 링 개수·별 개수. 적게에서는 별·링을 줄이고 빛기둥·글자는 그대로 둔다 */
  levels: {
    low: { rings: 0.5, stars: 0.25 },
    normal: { rings: 1, stars: 1 },
    high: { rings: 1.5, stars: 1.6 },
  } as Record<EffectLevel, { rings: number; stars: number }>,
  /** 판정 등급별 이펙트. 등급이 높을수록 크고 화려하다. MISS 는 이펙트 없음 */
  grades: {
    // 링: 판정원 중심에서 퍼져 ringRadius(px, 판정원 반지름 62 기준)까지 커지며 사라진다. 빛기둥은 원 중심에서 짧게 터진다 [임시]
    perfect: { beamHeight: 120, beamWidth: 1.0, beamMs: 320, rings: 3, ringRadius: 104, ringMs: 440, stars: 10, hitStrength: 1.0, color: 0xfbf3e8, ringBrightness: 1 },
    great: { beamHeight: 100, beamWidth: 0.85, beamMs: 300, rings: 2, ringRadius: 92, ringMs: 400, stars: 6, hitStrength: 0.9, color: 0x76f0b8, ringBrightness: 0.9 },
    good: { beamHeight: 66, beamWidth: 0.6, beamMs: 260, rings: 1, ringRadius: 72, ringMs: 320, stars: 0, hitStrength: 0.45, color: 0x9bd7ff, ringBrightness: 0.65 },
    bad: { beamHeight: 40, beamWidth: 0.45, beamMs: 220, rings: 1, ringRadius: 56, ringMs: 260, stars: 0, hitStrength: 0.3, color: 0xc9a6ff, ringBrightness: 0.45 },
  } as Record<Exclude<Grade, 'miss'>, GradeFx>,
  /** 별 움직임 */
  star: { size: 14, speedMin: 120, speedMax: 340, gravity: 520, lifeMs: 520 },
  /** 판정 별: 판정원 둘레에서 바깥으로 방사형으로 터진다 (중력 없음) */
  radialStar: { size: 11, speedMin: 90, speedMax: 190, lifeMs: 420 },
  /** 롱노트 누르는 동안 판정선에 계속 나는 이펙트 */
  holdLoop: { beamHeight: 80, pulseMs: 260, ringRadius: 74 },
  /**
   * 롱노트 틱 (04-H): 누르고 있는 동안 16분음표 간격으로 나는 작은 이펙트. 판정 글자는 없다 [임시]
   * 링은 이펙트 양 "적게"에서 lowEvery 번에 한 번만, 동시에 보이는 링 수는 maxActive 로 제한한다.
   */
  holdTick: { ringRadius: 58, ringMs: 200, ringBrightness: 0.55, color: 0xfbf3e8, minGapMs: 40, lowEvery: 2, maxActive: 6 },
  /** 연타 */
  burst: { pressRingRadius: 70, pressRingMs: 220, successStars: 24, successRings: 3, successRingRadius: 300, successBeamHeight: 360 },
  /** 빛기둥·링 바깥으로 퍼지는 정도 */
  beamFade: 0.9,

  /** 콤보 숫자가 늘 때 커졌다 돌아오는 연출 */
  combo: { popMs: 150, popPeak: 1.3, minShow: 2, opacity: 0.55, popOpacity: 0.85 },
  /** 피버 연출 */
  // 바꾸기 전(04-B): 배경 줄무늬 핑크↔민트 전환·흐름, 레일 색 600ms마다 교대, 흰 플래시 최대 0.75 / 320ms
  fever: {
    /** 발광 올라가는 시간 / 돌아오는 시간 (ms) */
    glowRiseMs: 400,
    glowFadeMs: 600,
    /** 피버 중 숨 쉬듯 변하는 주기 (ms)와 변화 폭 (0~1: 발광이 최대의 (1-폭)~1 사이를 오감) */
    breathPeriodMs: 2000,
    breathDepth: 0.25,
    /** 배경 발광 최대 불투명도 (0~1) */
    bgOpacity: 0.3,
    /** 레일 테두리 발광 세기 (0~1, 크림색에서 발광색 쪽으로 섞는 비율) */
    railStrength: 0.45,
    /** 발광 색 (밝은 핑크 계열 한 가지) */
    glowColor: 0xff9ccb,
    /** 발동 순간 흰 플래시: 최대 불투명도, 지속(ms). 이펙트 양이 "적게"이면 끔 */
    flashPeak: 0.22,
    flashMs: 150,
    flashOffAtLow: true,
    titleMs: 900,
  },

  /** 판정 글자 크기(px) 등급별 */
  judgeFontPx: { perfect: 60, great: 54, good: 44, bad: 38, miss: 46 } as Record<Grade, number>,
} as const;

/**
 * 탭 소리 (PERFECT/GREAT/GOOD/BAD 타격음). 사용자가 준 파일(docs\\TapSound.wav 를 public\\assets 에 복사)을 쓴다.
 * 0.9초 파일의 앞부분만 쓰고 끝에 짧은 페이드아웃을 건다. 원본 파일은 편집하지 않고 재생할 때 처리한다. 등급은 재생 속도(음높이)와 볼륨으로 나눈다. [임시]
 */
export const TAP_SOUND = {
  /** 이 웹 버전은 소리 파일을 쓰지 않는다(결과물에 음원·소리 파일을 넣지 않는 규칙). 효과음은 모두 코드로 합성한다 */
  file: '',
  /** 재생할 앞부분 길이 (ms, 원래 속도 기준 파일 시간) */
  playMs: 250,
  /** 끝에서 줄어드는 시간 (ms) */
  fadeMs: 50,
  /** 이 파일 소리 전용 크기 배율. 파일은 순간 소리가 짧고 평균 소리가 작아서 합성음과 비슷하게 들리도록 키운다 [임시] */
  fileGain: 1.4,
  /** 등급별 재생 속도(1 = 원래 음높이)와 볼륨 배율 */
  grades: {
    perfect: { rate: 1, gain: 1 },
    great: { rate: 1, gain: 0.85 },
    good: { rate: 0.9, gain: 0.65 },
    bad: { rate: 0.8, gain: 0.5 },
  } as Record<'perfect' | 'great' | 'good' | 'bad', { rate: number; gain: number }>,
} as const;

/** 효과음 이름 → 소리 대응표 (한 곳). 'tapFile' = 위 탭 소리 파일(등급별 속도·볼륨), 'synth' = 코드로 합성한 소리. 다른 소리 파일을 구하면 여기에서 바꾼다 */
export type SfxSourceKind = 'tapFile' | 'synth';
export const SFX_SOURCES: Record<SfxName, SfxSourceKind> = {
  hitPerfect: 'tapFile',
  hitGreat: 'tapFile',
  hitGood: 'tapFile',
  hitBad: 'tapFile',
  miss: 'synth',
  holdStart: 'synth',
  holdEnd: 'synth',
  holdTick: 'synth',
  burstPress: 'synth',
  burstSuccess: 'synth',
  feverStart: 'synth',
  feverEnd: 'synth',
  countTick: 'synth',
  countGo: 'synth',
  pause: 'synth',
};

/** 효과음 설정 (한 곳). 합성음은 파일이 없다 [임시] */
export const SFX_CONFIG = {
  /** 효과음 기본 크기 배율. 음악(전체×음악 볼륨)보다 한 단계 크게 들리도록 1보다 크게 잡았다. 환경설정 효과음·전체 볼륨이 여기에 곱해진다 */
  baseGain: 1.5,
  /** 소리 하나의 최대 크기 (0~1). 겹쳐도 깨지지 않게 낮게 잡고 압축기를 거친다 */
  voicePeak: 0.5,
  /** 동시에 울리는 소리 수 상한 (넘으면 새 소리는 건너뜀) */
  maxVoices: 12,
  /** 롱노트 틱 소리끼리의 최소 간격 (ms). 촘촘한 곡에서도 소리가 뭉개지지 않게 한다 [임시] */
  tickMinIntervalMs: 60,
  sampleRate: 44100,
} as const;
