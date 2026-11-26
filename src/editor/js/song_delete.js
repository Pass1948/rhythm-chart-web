// 최근 작업한 곡 지우기: [×]·[모두 지우기…] 버튼, 확인 창, 되돌리기 안내. 곡은 영구 삭제되지 않고 이 기기의 휴지통(songStore)으로 옮겨진다.
import { api } from '../../app/localApi.js';
import { refreshSongs } from './actions.js';
import { S, status } from './state.js';
import { allConfirm, blockReason, planDeleteAll, resultMessage, restoreMessage, singleConfirm, songTitle } from './song_delete_rules.js';

const $ = (id) => document.getElementById(id);
const UNDO_SHOW_MS = 12000;

let pending = null;   // 확인 창이 떠 있는 동안 지울 곡 id 목록
let lastMoved = [];   // 방금 옮긴 곡 [{song, trash, title}] (되돌리기용)
let undoTimer = 0;

const titleOf = (id) => songTitle((S.songs || []).find((s) => s.id === id) || { id });

// 목록 줄의 [×] 를 눌렀을 때
export async function askDeleteSong(id) {
  await refreshSongs().catch(() => {});
  const song = (S.songs || []).find((s) => s.id === id);
  if (!song) return status('이미 없는 곡입니다. 목록을 새로 고쳤습니다.', 'warn');
  const why = blockReason(song, S.song);
  if (why) return status(why, 'warn');
  openConfirm([id], singleConfirm(song));
}

// [모두 지우기…] 를 눌렀을 때
export async function askDeleteAll() {
  await refreshSongs().catch(() => {});
  const plan = planDeleteAll((S.songs || []).filter((s) => s.has_audio), S.song);
  if (!plan.targets.length) return status(plan.open.length ? '지울 수 있는 곡이 없습니다. 지금 열려 있는 곡은 지울 수 없습니다.' : '지울 수 있는 곡이 없습니다.', 'warn');
  openConfirm(plan.targets.map((s) => s.id), allConfirm(plan));
}

function openConfirm(ids, copy) {
  pending = ids;
  $('deleteSongTitle').textContent = copy.title;
  $('deleteSongMsg').textContent = copy.message;
  $('deleteSongExtra').textContent = copy.extra;
  $('deleteSongExtra').hidden = !copy.extra;
  $('deleteSongDialog').showModal();   // 기본 포커스는 [취소] (autofocus)
}

async function runDelete(ids) {
  const titles = new Map(ids.map((id) => [id, titleOf(id)]));
  try {
    const res = await api.deleteSongs(ids);
    const msg = resultMessage(res, (id) => titles.get(id) || id);
    lastMoved = res.results.filter((r) => r.status === 'moved').map((r) => ({ song: r.song, trash: r.trash, title: titles.get(r.song) }));
    await refreshSongs();
    status(msg.text, msg.kind);
    if (lastMoved.length) showUndo(msg.text);
  } catch (e) {
    status(e.message, 'error');
  }
}

function showUndo(text) {
  $('undoMsg').textContent = text;
  $('undoBar').classList.add('show');
  clearTimeout(undoTimer);
  undoTimer = setTimeout(hideUndo, UNDO_SHOW_MS);
}

function hideUndo() {
  clearTimeout(undoTimer);
  $('undoBar').classList.remove('show');
}

// 방금 지운 곡을 휴지통에서 되돌린다 (같은 화면을 쓰는 동안만)
async function undoDelete() {
  const items = lastMoved;
  lastMoved = [];
  hideUndo();
  const done = [];
  try {
    for (const it of items) {
      const r = await api.restoreSong(it.trash);
      done.push({ song: r.song, renamed: r.renamed });
    }
  } catch (e) {
    status(e.message, 'error');
  }
  await refreshSongs().catch(() => {});
  if (done.length) status(restoreMessage(done, (id) => (items.find((i) => i.song === id) || {}).title || id));
}

export function initSongDelete() {
  $('btnRecentClear').addEventListener('click', askDeleteAll);
  $('btnUndoDelete').addEventListener('click', undoDelete);
  const dlg = $('deleteSongDialog');
  dlg.addEventListener('close', () => {
    const ids = pending;
    pending = null;
    if (dlg.returnValue === 'ok' && ids) runDelete(ids);
  });
  dlg.addEventListener('cancel', () => { dlg.returnValue = 'cancel'; });
}
