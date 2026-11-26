// 게임 수치 설정 (한 곳). 판정 폭, 부정수치, 피버, 점수, 시간 보정 등 모든 수치는 여기서만 읽는다.
// [임시] 표시가 있는 값은 기획 미확정 값이다. (원본의 개발자 수정모드·스토리·싱크 도구 설정은 가져오지 않았다)

/** 판정 등급 (나쁜 순서 → 좋은 순서) */
export type Grade = 'miss' | 'bad' | 'good' | 'great' | 'perfect';

/** 난이도 이름. 부정수치 허용 비율 A 와 채보 난이도 선택에 쓰인다. */
export type DifficultyName = 'EASY' | 'NORMAL' | 'HARD';

/** 이펙트 양 (환경설정 → 그래픽) */
export type EffectLevel = 'low' | 'normal' | 'high';

/** 랭크 */
export type Rank = 'S' | 'A' | 'B' | 'C';

export interface GameConfig {
  /** 판정 폭 (노트 시간과 입력 시간 차이의 절댓값 ms 이하이면 해당 등급) */
  judge: {
    perfectMs: number;
    greatMs: number;
    goodMs: number;
    badMs: number;
    /** 노트 시간 + 이 값(ms)이 지나도 못 쳤으면 자동 miss */
    autoMissAfterMs: number;
    /** [04-H] 롱노트 틱 간격의 분할 단위: 한 박을 몇 개로 나누는지 (4 = 16분음표). 간격 = 60000 ÷ BPM ÷ 이 값 */
    holdTickSubdivision: number;
    /** [04-H] 롱노트 틱 간격의 최소값 (ms). 계산한 간격이 이보다 짧으면 이 값을 쓴다 [임시] */
    holdMinTickIntervalMs: number;
    /** [04-H] 롱노트 길이의 이 비율 지점 이후에 떼면 정상 완료 (0~1). 이전에 떼면 MISS 한 번 [임시 아님: 사용자 결정 95%] */
    holdCompleteRatio: number;
  };
  /** 점수 가중치 (판정 등급별) */
  scoreWeight: Record<Grade, number>;
  /** 부정수치 (차오르는 방식) */
  negative: {
    /** 감소량 h = hNumerator / N (%) */
    hNumerator: number;
    /** 허용 miss 비율 A (0~1), 난이도별 */
    allowedMissRatio: Record<DifficultyName, number>;
    /** 증가량 d 의 하한·상한 (%) */
    dMinPercent: number;
    dMaxPercent: number;
    /** 판정별 변화 계수. 음수 = 감소(h 배), 양수 = 증가(d 배) */
    perfectHFactor: number;
    greatHFactor: number;
    goodHFactor: number;
    badDFactor: number;
    missDFactor: number;
    /** 이 값에 도달하면 즉시 실패 (%) */
    failPercent: number;
  };
  /** 피버타임 */
  fever: {
    /** 충전량 g = gNumerator / N (%) */
    gNumerator: number;
    perfectChargeFactor: number;
    greatChargeFactor: number;
    durationMs: number;
    scoreMultiplier: number;
    /** [05단계] 피버 발광 세기 배율 (1 = 기본, 0 = 발광 없음). 배경 발광 불투명도에 곱한다 [임시] */
    glowStrength: number;
  };
  /** 점수 표시·랭크·적 데미지 */
  score: {
    /** 표시 만점 (전부 perfect, 피버 없음일 때의 점수) */
    displayMaxScore: number;
    /** [임시] true 이면 표시 점수를 만점으로 제한한다 (피버 보너스가 만점을 넘지 못함) */
    clampScoreAtMax: boolean;
    rankS: number;
    rankA: number;
    rankB: number;
    /** 적 체력 감소율 상한 (0~1) */
    enemyDamageCap: number;
    /** 콤보가 끊기는 등급 (콤보는 표시용이며 점수에 넣지 않음) */
    comboBreakGrades: readonly Grade[];
  };
  /** 시간 보정 */
  timing: {
    /** 노트가 판정선까지 내려오는 시간 (ms). 도구 기본값 1800 */
    fallTimeMs: number;
    /** 입력 지연 보정 (ms). 키를 늦게 누르는 느낌이면 + 값. 판정에 쓰는 입력 시각 = 실제 입력 시각 - 이 값 */
    inputDelayMs: number;
    /**
     * 화면 표시 보정 (ms). 노트를 그리는 시간 = 곡 시간 - 이 값.
     * 노트가 소리보다 먼저 도착해 보이면 + 값(노트가 화면에 더 늦게 나타남). 판정에는 쓰지 않는다.
     */
    visualOffsetMs: number;
    /** 음원 시작 보정 (ms). 양수 = 음원이 채보 기준보다 늦게 나온다(앞에 빈 구간). 곡 시간 = 음원 재생 위치 - 이 값 */
    audioStartOffsetMs: number;
  };
  /** 사용자 입력 설정의 기본값 (환경설정에서 바꾼 값은 브라우저에 따로 저장되고 이 값 위에 덮어씌워진다) */
  input: {
    keyboardEnabled: boolean;
    mouseEnabled: boolean;
    /** 왼쪽 / 오른쪽 레인 키 (KeyboardEvent.code 값) */
    keyLeft: string;
    keyRight: string;
  };
  /** 음량 기본값 (0~100) */
  audio: {
    masterVolume: number;
    musicVolume: number;
    sfxVolume: number;
  };
  /** 그래픽 기본값 */
  graphics: {
    /** 내부 렌더 해상도 배율 (%) */
    renderScalePercent: number;
    /** 프레임 제한. 0 = 제한 없음 */
    frameLimit: number;
    /** 이펙트 양 (적게/보통/많이) */
    effectLevel: EffectLevel;
  };
  /** 환경설정 화면에서 허용하는 값의 범위와 선택지 */
  settingLimits: {
    fallTimeMs: { min: number; max: number; step: number };
    inputDelayMs: { min: number; max: number; step: number };
    visualOffsetMs: { min: number; max: number; step: number };
    volume: { min: number; max: number; step: number };
    renderScalePercent: { min: number; max: number; step: number };
    frameLimits: readonly number[];
    effectLevels: readonly EffectLevel[];
  };
}

/** 기본 설정값 */
export const GAME_CONFIG: GameConfig = {
  judge: {
    perfectMs: 45,
    greatMs: 95,
    goodMs: 150,
    badMs: 200,
    autoMissAfterMs: 200,
    holdTickSubdivision: 4,
    holdMinTickIntervalMs: 50, // [임시]
    holdCompleteRatio: 0.95,
  },
  scoreWeight: { perfect: 1.0, great: 0.7, good: 0.4, bad: 0.1, miss: 0 },
  negative: {
    hNumerator: 200,
    allowedMissRatio: { EASY: 0.25, NORMAL: 0.18, HARD: 0.12 },
    dMinPercent: 1.5,
    dMaxPercent: 6,
    perfectHFactor: 1.0,
    greatHFactor: 1.0,
    goodHFactor: 0.5,
    badDFactor: 0.5,
    missDFactor: 1.0,
    failPercent: 100,
  },
  fever: {
    gNumerator: 200,
    perfectChargeFactor: 1.0,
    greatChargeFactor: 0.7,
    durationMs: 8000,
    scoreMultiplier: 1.5,
    glowStrength: 1,
  },
  score: {
    displayMaxScore: 1_000_000, // [임시] 표시 점수 만점
    clampScoreAtMax: true, // 점수는 만점을 넘지 못함 (16번 결정. 곡별 실제 점수를 본 뒤 재검토)
    rankS: 0.95, // [임시]
    rankA: 0.85, // [임시]
    rankB: 0.7, // [임시]
    enemyDamageCap: 1, // [임시]
    comboBreakGrades: ['bad', 'miss'], // [임시] 콤보는 표시용
  },
  timing: {
    fallTimeMs: 1800,
    inputDelayMs: 0,
    visualOffsetMs: 0,
    audioStartOffsetMs: 0,
  },
  input: { keyboardEnabled: true, mouseEnabled: true, keyLeft: 'KeyS', keyRight: 'KeyF' },
  audio: { masterVolume: 80, musicVolume: 80, sfxVolume: 80 },
  graphics: { renderScalePercent: 100, frameLimit: 60, effectLevel: 'normal' },
  settingLimits: {
    fallTimeMs: { min: 500, max: 2000, step: 50 },
    inputDelayMs: { min: -500, max: 500, step: 1 },
    visualOffsetMs: { min: -300, max: 300, step: 1 },
    volume: { min: 0, max: 100, step: 1 },
    renderScalePercent: { min: 50, max: 100, step: 5 },
    frameLimits: [30, 60, 0],
    effectLevels: ['low', 'normal', 'high'],
  },
};
