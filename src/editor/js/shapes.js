// 노트 모양과 색 (종류마다 색과 모양이 모두 다르다): 단타=동그라미(파랑), 롱노트=긴 막대+양 끝 손잡이(초록), 연타=톱니 막대+횟수(주황)
// 색은 디자인 토큰(theme.js)에서 온다. 선택한 노트는 색이 아니라 흰색 이중 테두리(바깥 흰색 + 안쪽 어두운 선)와 손잡이로 표시한다.
import { theme } from './theme.js';

// 예전 이름 그대로 쓸 수 있게 같은 객체를 내보낸다 (tap, hold, burst, bg, laneA, laneB ...)
export const COLORS = theme;

// 선택 표시: 먼저 굵은 흰 선을 깔고 도형을 채운 뒤 안쪽 어두운 1px 선을 긋는다 (호출 쪽에서 path 를 두 번 만든다)
function selectUnder(ctx) {
  ctx.lineWidth = 5;
  ctx.strokeStyle = theme.selectOuter;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function innerLine(ctx, selected, normalColor) {
  ctx.lineWidth = selected ? 1 : 1.5;
  ctx.strokeStyle = selected ? theme.selectInner : normalColor;
  ctx.stroke();
}

// 단타: 동그라미
export function drawTap(ctx, cx, cy, r, selected) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  if (selected) selectUnder(ctx);
  ctx.fillStyle = theme.tap;
  ctx.fill();
  innerLine(ctx, selected, theme.tapLine);
}

// 롱노트: 둥근 막대 + 위·아래 손잡이 (y0=시작(아래), y1=끝(위))
export function drawHold(ctx, cx, y0, y1, w, selected) {
  const top = Math.min(y0, y1);
  const h = Math.abs(y0 - y1);
  ctx.beginPath();
  ctx.roundRect(cx - w / 2, top, w, Math.max(h, 4), 6);
  if (selected) selectUnder(ctx);
  ctx.fillStyle = theme.holdFill;
  ctx.fill();
  innerLine(ctx, selected, theme.holdLine);
  ctx.fillStyle = selected ? theme.selectOuter : theme.holdLine;
  ctx.fillRect(cx - w / 2 - 2, top - 3, w + 4, 6); // 끝단 손잡이
  ctx.fillRect(cx - w / 2 - 2, top + Math.max(h, 4) - 3, w + 4, 6);
  if (selected) {
    ctx.strokeStyle = theme.selectInner;
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - w / 2 - 1.5, top - 2.5, w + 3, 5);
    ctx.strokeRect(cx - w / 2 - 1.5, top + Math.max(h, 4) - 2.5, w + 3, 5);
  }
}

// 연타노트: 양쪽이 톱니 모양인 막대 + 횟수 숫자
export function drawBurst(ctx, cx, y0, y1, w, count, selected) {
  const top = Math.min(y0, y1);
  const bottom = Math.max(y0, y1, top + 12);
  const teeth = Math.max(2, Math.round((bottom - top) / 12));
  const step = (bottom - top) / teeth;
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, top);
  for (let i = 0; i < teeth; i++) {
    ctx.lineTo(cx - w / 2 - 5, top + step * (i + 0.5));
    ctx.lineTo(cx - w / 2, top + step * (i + 1));
  }
  ctx.lineTo(cx + w / 2, bottom);
  for (let i = teeth - 1; i >= 0; i--) {
    ctx.lineTo(cx + w / 2 + 5, top + step * (i + 0.5));
    ctx.lineTo(cx + w / 2, top + step * i);
  }
  ctx.closePath();
  if (selected) selectUnder(ctx);
  ctx.fillStyle = theme.burstFill;
  ctx.fill();
  innerLine(ctx, selected, theme.burstLine);
  ctx.fillStyle = theme.burstText;
  ctx.font = theme.font(13, true);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(count), cx, (top + bottom) / 2);
  ctx.fillStyle = selected ? theme.selectOuter : theme.burstLine;
  ctx.fillRect(cx - w / 2 - 2, top - 3, w + 4, 5);
  ctx.fillRect(cx - w / 2 - 2, bottom - 2, w + 4, 5);
  if (selected) {
    ctx.strokeStyle = theme.selectInner;
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - w / 2 - 1.5, top - 2.5, w + 3, 4);
    ctx.strokeRect(cx - w / 2 - 1.5, bottom - 1.5, w + 3, 4);
  }
}

// ---------- 바 모양 (편집 화면 노트 모양 선택 = 바) ----------

// 단타(바): 레인 폭의 약 90% 가로 막대, 둥근 모서리 2px
export function drawTapBar(ctx, cx, cy, w, h, selected) {
  ctx.beginPath();
  ctx.roundRect(cx - w / 2, cy - h / 2, w, h, 2);
  if (selected) selectUnder(ctx);
  ctx.fillStyle = theme.tap;
  ctx.fill();
  innerLine(ctx, selected, theme.tapLine);
}

// 롱노트(바): 같은 폭의 세로로 긴 막대 + 시작(아래) 머리 막대. y0 = 시작(아래), y1 = 끝(위)
export function drawHoldBar(ctx, cx, y0, y1, w, h, selected) {
  const top = Math.min(y0, y1);
  const len = Math.max(Math.abs(y0 - y1), 4);
  ctx.beginPath();
  ctx.roundRect(cx - w / 2, top, w, len, 2);
  if (selected) selectUnder(ctx);
  ctx.fillStyle = theme.holdFill;
  ctx.fill();
  innerLine(ctx, selected, theme.holdLine);
  // 머리 막대(시작 지점)
  const head = Math.max(y0, y1);
  ctx.beginPath();
  ctx.roundRect(cx - w / 2, head - h / 2, w, h, 2);
  ctx.fillStyle = theme.hold;
  ctx.fill();
  innerLine(ctx, selected, theme.holdLine);
}
