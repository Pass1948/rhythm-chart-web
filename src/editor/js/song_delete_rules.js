// 최근 작업한 곡 지우기: 화면 없이 계산할 수 있는 규칙(누구를 지울 수 있는지, 확인 창·결과 문구). 화면 연결은 song_delete.js.

export const TRASH_FOLDER = '이 기기의 휴지통';
export const OPEN_SONG_BLOCKED = '지금 열려 있는 곡은 지울 수 없습니다. 다른 곡을 연 뒤에 지워 주세요.';
export const BUSY_SONG_BLOCKED = '분석이 끝나거나 취소된 뒤에 지울 수 있습니다.';
export const DELETE_NOTE = `이 곡의 분석 결과와 편집한 채보를 ${TRASH_FOLDER}으로 옮깁니다. 지운 직후에는 [되돌리기]로, 나중에는 [휴지통]에서 복구할 수 있습니다.`;

// 화면에 보일 곡 이름
export function songTitle(song) {
  return (song && (song.title || song.id)) || '';
}

// 곡 하나를 지울 수 없는 이유 (지울 수 있으면 빈 문자열)
export function blockReason(song, openId) {
  if (openId && song.id === openId) return OPEN_SONG_BLOCKED;
  if (song.analyzing) return `‘${songTitle(song)}’ 곡은 분석 중입니다. ${BUSY_SONG_BLOCKED}`;
  return '';
}

// 모두 지우기 계획: 목록의 곡을 지울 수 있는 곡 / 열려 있어 제외 / 분석 중이라 제외 로 나눈다
export function planDeleteAll(songs, openId) {
  const plan = { targets: [], open: [], busy: [] };
  for (const s of songs) {
    if (openId && s.id === openId) plan.open.push(s);
    else if (s.analyzing) plan.busy.push(s);
    else plan.targets.push(s);
  }
  return plan;
}

// 한 곡 확인 창 문구
export function singleConfirm(song) {
  return { title: `‘${songTitle(song)}’ 작업을 지울까요?`, message: DELETE_NOTE, extra: '' };
}

// 모두 지우기 확인 창 문구 (열려 있는 곡·분석 중인 곡은 제외된다는 안내와 그 곡 수)
export function allConfirm(plan) {
  const skipped = plan.open.length + plan.busy.length;
  const parts = [];
  if (plan.open.length) parts.push(`열려 있는 곡 ${plan.open.length}개`);
  if (plan.busy.length) parts.push(`분석 중인 곡 ${plan.busy.length}개`);
  return {
    title: `목록의 곡 ${plan.targets.length}개를 모두 지울까요?`,
    message: DELETE_NOTE,
    extra: skipped ? `${parts.join('와 ')}는 지워지지 않고 목록에 남습니다. (제외되는 곡 ${skipped}개)` : '열려 있거나 분석 중인 곡은 없어서 목록의 곡이 모두 옮겨집니다.',
  };
}

// 서버 결과({results:[{song,status,reason,trash}], moved}) → 하단 상태 줄 문구
export function resultMessage(res, titleOf) {
  const rs = (res && res.results) || [];
  const moved = rs.filter((r) => r.status === 'moved');
  const failed = rs.filter((r) => r.status === 'skipped');
  let text = '';
  if (moved.length === 1 && rs.length === 1) text = `‘${titleOf(moved[0].song)}’ 작업을 휴지통으로 옮겼습니다.`;
  else if (moved.length) text = `곡 ${moved.length}개를 휴지통으로 옮겼습니다.`;
  else if (rs.length && rs.every((r) => r.status === 'missing')) text = '이미 없는 곡입니다. 목록을 새로 고쳤습니다.';
  if (failed.length) {
    const why = failed[0].reason || '';
    text += `${text ? ' ' : ''}${failed.length === 1 ? `‘${titleOf(failed[0].song)}’ 곡은 옮기지 못했습니다.` : `${failed.length}개 곡은 옮기지 못했습니다.`}${why ? ' ' + why : ''}`;
  }
  return { text: text || '옮긴 곡이 없습니다.', kind: failed.length ? 'warn' : 'info', moved: moved.length };
}

// 되돌린 뒤 안내
export function restoreMessage(results, titleOf) {
  const renamed = results.filter((r) => r.renamed);
  if (results.length === 1 && !renamed.length) return `‘${titleOf(results[0].song)}’ 작업을 되돌렸습니다.`;
  const base = results.length === 1 ? `‘${results[0].song}’ 이름으로 되돌렸습니다.` : `곡 ${results.length}개를 되돌렸습니다.`;
  return renamed.length ? `${base} 같은 이름의 곡이 이미 있어 이름 뒤에 번호를 붙였습니다.` : base;
}
