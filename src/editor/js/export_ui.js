// 저장 확인 창(dlgSave): 파일 이름(다른 이름으로 저장)·종류·용량을 보여 주고 [저장] [취소]를 둔다.
// [저장]을 누르면 api.saveExportFile 이 downloads → showSaveFilePicker → <a download> 순서로 실제 저장을 시작한다.
// 폰(터치 기기 또는 폭 < 1024px)에서는 "이 파일을 휴대폰에 다운로드할까요?" 문구를 쓴다.
import { cleanFileName, formatBytes, isPhoneLike, savePrompt } from '../../storage/saveFiles.ts';

const $ = (id) => document.getElementById(id);

// 지금 화면이 폰 문구를 써야 하는지
export function phoneNow() {
  try {
    return isPhoneLike((q) => window.matchMedia(q).matches, window.innerWidth);
  } catch (e) {
    return window.innerWidth < 1024;
  }
}

// 창에 문구와 값을 채운다 (화면 코드와 분리해 점검에서도 부를 수 있게)
export function fillSaveDialog(file, phone) {
  const p = savePrompt(phone);
  $('saveTitle').textContent = phone ? '파일 다운로드' : '파일 저장';
  $('saveQuestion').textContent = p.question;
  $('saveName').value = file.name;
  $('saveKind').textContent = file.label;
  $('saveSize').textContent = formatBytes(file.size);
  $('saveNote').textContent = p.note;
  $('saveOk').textContent = p.okLabel;
}

// 확인 창을 열고, [저장]을 누르면 저장한다. 결과 {status, message,…} 를 돌려주고, 취소(Esc 포함)면 null.
export function confirmAndSave(file, api) {
  const dlg = $('dlgSave');
  fillSaveDialog(file, phoneNow());
  return new Promise((resolve) => {
    const nameEl = $('saveName');
    const onKey = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        $('saveOk').click(); // 입력칸에서 Enter 를 누르면 [저장] (기본으로는 첫 버튼인 [취소]가 눌리므로)
      }
    };
    nameEl.addEventListener('keydown', onKey);
    dlg.addEventListener(
      'close',
      async () => {
        nameEl.removeEventListener('keydown', onKey);
        if (dlg.returnValue !== 'ok') return resolve(null);
        const name = cleanFileName(nameEl.value, file.name);
        try {
          resolve(await api.saveExportFile(file, name));
        } catch (e) {
          resolve({ status: 'failed', message: '파일을 저장하지 못했습니다. ' + (e && e.message ? e.message : '') });
        }
      },
      { once: true },
    );
    dlg.returnValue = '';
    dlg.showModal();
    nameEl.focus();
    nameEl.select();
  });
}
