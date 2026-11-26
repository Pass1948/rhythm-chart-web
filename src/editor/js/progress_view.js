// 진행 표시 상태 계산 (화면·시계와 분리된 순수 모듈 — Node 로 테스트한다).
// [분석]·[노트 자동 생성] 버튼 옆의 "회전 표시 + 짧은 글자 + 막대"가 무엇을 보여 줄지 정한다.
//  - 누른 순간부터 끝날 때까지 끊기지 않는다 (분석기를 켜는 중 → 요청 직후 → 진행 %)
//  - 아주 빨리 끝나도 최소 시간(minMs)은 보인다
//  - 완료·저장된 결과 불러옴은 holdMs(3초) 동안 보인 뒤 사라지고, 취소·오류는 즉시 바뀐다
//  - 진행률을 모르는 동안은 percent = null (좌우로 움직이는 막대)

export const ANALYZE_MIN_MS = 800;
export const GENERATE_MIN_MS = 500;
export const HOLD_MS = 3000;

// 긴 서버 문구를 버튼 옆 한 줄에 맞게 줄인다 (끝의 "…"·마침표 정리, 최대 max 글자)
export function shortText(text, max = 22) {
  const t = String(text || '').replace(/[….。]+$/u, '').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

// 상단 분석기 표시의 회전 표시: 준비 중(starting)·분석 중(busy)일 때만 true
export function analyzerSpinnerVisible(state) {
  return state === 'starting' || state === 'busy';
}

export class ProgressTracker {
  // minMs: 최소 표시 시간, holdMs: 완료·취소·오류 표시를 유지하는 시간
  constructor({ minMs = ANALYZE_MIN_MS, holdMs = HOLD_MS } = {}) {
    this.minMs = minMs;
    this.holdMs = holdMs;
    this.state = null;   // {kind:'running'|'done'|'cached'|'canceled'|'error', ...}
    this.pending = null; // 최소 시간을 채우느라 아직 보여 주지 않은 완료 결과
  }

  // 시작: phase = 'engine'(분석기 켜는 중) / 'request'(요청 직후) / 'progress'(진행 %) / 'plain'(text 그대로)
  begin(now, phase = 'request', text = '') {
    this.pending = null;
    this.state = { kind: 'running', startedAt: now, phase, percent: null, text };
  }

  // 진행 갱신: patch = {phase, percent, text}
  update(patch) {
    if (!this.state || this.state.kind !== 'running') return;
    Object.assign(this.state, patch);
  }

  // 끝: kind = done / cached / canceled / error. 완료는 최소 표시 시간을 채운 뒤 보이고, 취소·오류는 즉시 바뀐다.
  finish(now, kind, text = '') {
    if (!this.state || (this.state.kind !== 'running' && !this.pending)) return;
    const startedAt = this.pending ? this.pending.startedAt : this.state.startedAt;
    const elapsed = now - startedAt;
    if (kind === 'done' || kind === 'cached') {
      this.pending = { kind, text, startedAt, showAt: Math.max(now, startedAt + this.minMs), elapsed };
      return;
    }
    this.pending = null;
    this.state = { kind, text, shownAt: now };
  }

  // 지금 실행 중으로 봐야 하는가 (최소 표시 시간을 채우는 중 포함). 버튼 비활성 판단에 쓴다.
  isRunning() {
    return !!this.state && (this.state.kind === 'running' || !!this.pending);
  }

  // 화면에 보여 줄 내용
  view(now) {
    if (this.pending && now >= this.pending.showAt) {
      const p = this.pending;
      this.pending = null;
      this.state = { kind: p.kind, text: p.text, shownAt: p.showAt, elapsed: Math.max(p.elapsed, this.minMs) };
    }
    const s = this.state;
    if (!s) return HIDDEN;
    if (s.kind === 'running') {
      return { visible: true, spinner: true, tone: 'run', label: runningLabel(s), percent: s.phase === 'progress' ? s.percent : null, running: true, cancelable: s.phase !== 'plain' };
    }
    if (now - s.shownAt >= this.holdMs) {
      this.state = null;
      return HIDDEN;
    }
    const label = s.kind === 'done' ? (s.text || `완료 ✓ (${(s.elapsed / 1000).toFixed(1)}초)`)
      : s.kind === 'cached' ? (s.text || '저장된 분석 결과를 불러왔습니다')
        : s.kind === 'canceled' ? (s.text || '취소했습니다') : (s.text || '분석하지 못했습니다');
    return { visible: true, spinner: false, tone: s.kind === 'error' ? 'error' : s.kind === 'canceled' ? 'warn' : 'ok', label, percent: null, running: false, cancelable: false, barHidden: true };
  }
}

const HIDDEN = { visible: false, spinner: false, tone: 'run', label: '', percent: null, running: false, cancelable: false, barHidden: true };

function runningLabel(s) {
  if (s.phase === 'engine') return '분석기를 켜는 중… (처음 한 번 약 5초)';
  if (s.phase === 'request') return s.text || '분석을 시작하는 중…';
  if (s.phase === 'progress') {
    const pct = Math.round(s.percent || 0);
    const stage = shortText(s.text);
    return stage ? `분석 중 ${pct}% · ${stage}` : `분석 중 ${pct}%`;
  }
  return s.text || '처리 중…';
}
