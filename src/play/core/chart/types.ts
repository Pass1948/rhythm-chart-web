// 채보 데이터 형식 (two-key-unity.v2 를 읽어 게임 안에서 쓰는 모양)

/** 노트 종류: 단타 / 롱노트 / 연타 */
export type NoteType = 'tap' | 'hold' | 'burst';

/** 레인 번호: 2키는 0·1, 4키는 0~3 (왼쪽부터) */
export type LaneIndex = 0 | 1 | 2 | 3;

/** 키 모드: 2키(왼쪽·오른쪽) / 4키(S D K L) */
export type KeyMode = 2 | 4;

/** 레인 값: 0=왼쪽, 1=오른쪽(4키는 2·3도), 연타는 전체 폭("both") */
export type NoteLane = LaneIndex | 'both';

export interface ChartNote {
  type: NoteType;
  lane: NoteLane;
  /** 노트 시간 (ms, 곡 시작 기준) */
  timeMs: number;
  /** 길이 (ms). 단타는 0 */
  durationMs: number;
  /** 연타 필요 횟수. 연타만 의미 있음 */
  count: number;
}

export interface Chart {
  /** 키 모드 (형식 이름이 four-key 이면 4, 아니면 2) */
  keyMode: KeyMode;
  title: string;
  artist: string;
  audioFile: string;
  durationMs: number;
  /** 난이도 이름(대문자) → 정렬된 노트 목록 */
  difficulties: Map<string, ChartNote[]>;
  /** 파일에 적혀 있던 판정 폭. 읽기만 하고 게임에서는 쓰지 않는다(게임 설정이 기준) */
  declaredJudge: Record<string, number> | null;
}

export interface LoadWarning {
  message: string;
}

export type ParseResult =
  | { ok: true; chart: Chart; warnings: string[] }
  | { ok: false; errors: string[] };

export interface SelectedDifficulty {
  /** 실제로 사용하는 난이도 이름 */
  name: string;
  /** 요청한 난이도가 없어서 다른 난이도로 대체되었는지 */
  substituted: boolean;
  notes: ChartNote[];
  /** 총 노트 수 N (단타, 롱노트, 연타를 각각 1개로 셈) */
  totalNotes: number;
}
