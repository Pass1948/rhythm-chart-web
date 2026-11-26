// 게임 화면 렌더러가 컨트롤러에게 보여 주는 공통 모양. 기존 Three.js 렌더러(PlayRenderer)와 새 화면 10-C(Renderer10C)가 같은 모양을 따른다.
// 컨트롤러는 규칙이 계산한 상태를 이 인터페이스로 넘기기만 하고, 어떤 그림으로 그릴지는 렌더러가 정한다.
import type { Grade } from './core/config/gameConfig';
import type { VisibleNotes } from './noteLayout';

/** 연타 막대 위 "×n" 글자를 놓을 위치 (화면 좌표) */
export interface GameBurstAnchors {
  count: number;
  noteIndex: Int32Array;
  x: Float32Array;
  y: Float32Array;
}

/** 판정 이펙트 (기존 EffectsRenderer 와 같은 이름) */
export interface GameEffects {
  hit(lane: number, grade: Grade, nowMs: number): void;
  holdTick(lane: number, nowMs: number): void;
  holdStart(lane: number): void;
  holdEnd(lane: number): void;
  burstPress(nowMs: number): void;
  burstSuccess(nowMs: number): void;
  clear(): void;
}

/** 규칙이 계산한 지금 상태 (새 화면이 점수·콤보·게이지를 직접 그릴 때 읽는다). 값은 규칙의 snapshot 그대로다. */
export interface GameStatus {
  score: number;
  combo: number;
  feverGaugePercent: number;
  negativePercent: number;
  /** 곡 진행 0~1 */
  progress: number;
  /** 연타 노트의 남은 횟수 */
  burstRemaining: (noteIndex: number) => number;
}

export interface GameRenderer {
  readonly shape: { readonly bottomProgress: number };
  readonly burstAnchors: GameBurstAnchors;
  readonly effects: GameEffects;
  render(songMs: number, visualOffsetMs: number, fallTimeMs: number, visible: VisibleNotes, states: Uint8Array, nowMs: number, dtMs: number): void;
  setLaneDown(lane: number, down: boolean): void;
  setFeverGlow(strength: number): void;
  clear(): void;
  dispose(): void;
  /** (선택) 점수·콤보·게이지 상태. 매 프레임 render 전에 부른다 */
  setStatus?(status: GameStatus): void;
  /** (선택) 판정 글자·타격 연출용: 단타·롱노트 머리의 판정 하나, 연타 결과 */
  judged?(lane: number, grade: Grade, nowMs: number): void;
}
