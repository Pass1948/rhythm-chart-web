// 편집기가 열려 있을 때 그 상태에서 읽어 오는 보조 정보(읽기만 한다. 편집기 파일은 수정하지 않는다).
// 요청(PlayRequest)이 이미 같은 값을 주면 그 값을 쓰고, 없을 때만 여기서 채운다.
import { firstBpm, noteIdsForDifficulty } from './noteIds.ts';
import type { ChartV2 } from '../core/schema.ts';

/** 편집기 점검용 객체(editor/js/main.js 가 window.__editor 로 내놓는다) 중 쓰는 부분 */
export interface EditorHandle {
  A?: { audio?: { position?: number } };
  S?: { chart?: ChartV2 | null };
}

/** 편집기에서 읽은 값 */
export interface EditorHints {
  /** 첫 구간 BPM (모르면 null) */
  bpm: number | null;
  /** 첫 박이 나오는 곡 시간(ms): audio_offset + decoder_delay */
  beatOriginMs: number;
  /** Unity 내보내기와 같은 순서의 편집기 노트 번호 (모르면 null) */
  noteIds: number[] | null;
  /** 편집기에서 보던 재생 위치(ms). 모르면 null */
  positionMs: number | null;
}

/** 편집기 상태를 읽는다. 편집기가 없거나 곡이 안 열려 있으면 모르는 값(null)으로 채운다. */
export function readEditorHints(difficulty: string, win: { __editor?: () => EditorHandle } = window as unknown as { __editor?: () => EditorHandle }): EditorHints {
  let handle: EditorHandle | undefined;
  try {
    handle = win.__editor?.();
  } catch {
    handle = undefined;
  }
  const chart = handle?.S?.chart ?? null;
  const position = handle?.A?.audio?.position;
  return {
    bpm: chart === null ? null : firstBpm(chart),
    beatOriginMs: chart === null ? 0 : (chart.song.audio_offset_ms || 0) + (chart.song.decoder_delay_ms || 0),
    noteIds: chart === null ? null : noteIdsForDifficulty(chart, difficulty),
    positionMs: typeof position === 'number' && Number.isFinite(position) ? position : null,
  };
}
