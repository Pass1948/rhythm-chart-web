const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["./play-CI8lHabZ.js","./settingsStore-liBLgj6R.js","./play-BtBH2Tsp.css","./state-B0xBe9lh.js","./timing-C1y7REJA.js","./actions-BFYwqAM6.js","./localApi-CteXlorY.js","./main-BEFbpL4-.js","./shapes-DK0rVSkU.js","./test_popup-B97BVLVs.js"])))=>i.map(i=>d[i]);
import{M as e,W as t,i as n,o as r}from"./settingsStore-liBLgj6R.js";(function(){let e=document.createElement(`link`).relList;if(e&&e.supports&&e.supports(`modulepreload`))return;for(let e of document.querySelectorAll(`link[rel="modulepreload"]`))n(e);new MutationObserver(e=>{for(let t of e)if(t.type===`childList`)for(let e of t.addedNodes)e.tagName===`LINK`&&e.rel===`modulepreload`&&n(e)}).observe(document,{childList:!0,subtree:!0});function t(e){let t={};return e.integrity&&(t.integrity=e.integrity),e.referrerPolicy&&(t.referrerPolicy=e.referrerPolicy),t.credentials=e.crossOrigin===`use-credentials`?`include`:e.crossOrigin===`anonymous`?`omit`:`same-origin`,t}function n(e){if(e.ep)return;e.ep=!0;let n=t(e);fetch(e.href,n)}})();var i=`<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>리듬 채보 만들기</title>
<!-- 스타일(tokens.css, style.css)과 스크립트(js/main.js)는 app/main.ts 가 불러온다. 이 파일은 화면 조각(body 안쪽)만 쓴다. -->
</head>
<body>
<header class="topbar">
  <div class="brand"><span class="logo" aria-hidden="true">♬</span> <b>노트 디자인</b> <span class="tag">2 KEY</span></div>
  <div class="songinfo"><div id="songName" class="songname" title="">곡을 열어 주세요</div><div id="songMeta" class="songmeta"></div></div>
  <span class="sp"></span>
  <div class="actions">
    <button id="btnOpen" type="button" class="ghost" data-short="올리기" title="음원 파일을 골라 곡을 올립니다. 파일은 이 기기 안에서만 처리됩니다">곡 올리기</button>
    <button id="btnSave" type="button" class="ghost" title="Ctrl+S (이 기기의 브라우저 안에 저장됩니다)">저장 <kbd>Ctrl S</kbd></button>
    <button id="btnTest" type="button" class="ghost" data-short="테스트" title="지금 채보를 직접 쳐 보며 판정을 확인합니다"><span class="ico">▷</span><span class="txt"> 테스트</span></button>
    <button id="btnPlayTest" type="button" class="ghost" data-short="플레이" title="만든 채보를 게임 화면에서 쳐 봅니다"><span class="ico">🎮</span><span class="txt"> 게임 화면 테스트</span></button>
    <button id="btnExport" type="button" class="primary" data-short="내보내기">내보내기 ↗</button>
    <div class="menuwrap">
      <button id="btnMore" type="button" class="ghost" aria-haspopup="menu" aria-expanded="false" title="더보기">⋯</button>
      <div id="moreMenu" class="menu" role="menu" hidden>
        <button type="button" role="menuitem" class="proxy" data-proxy="btnOpen" disabled>곡 올리기</button>
        <button type="button" role="menuitem" class="proxy" data-proxy="btnTest" disabled>테스트 (판정 확인)</button>
        <button type="button" role="menuitem" class="proxy" data-proxy="btnPlayTest" disabled>게임 화면 테스트</button>
        <button type="button" role="menuitem" class="proxy" data-proxy="btnExport" disabled>내보내기</button>
        <button id="btnLoadJson" type="button" role="menuitem" title="채보 JSON 이나 [채보 JSON + 음원] ZIP 을 불러옵니다">불러오기 (JSON · ZIP)</button>
        <button id="btnTestHere" type="button" role="menuitem" title="선택한 노트부터(선택이 없으면 지금 재생 위치부터) 테스트합니다">여기서부터 테스트</button>
        <hr>
        <div class="menulabel" id="themeLabel">화면 모드</div>
        <button id="themeLight" type="button" role="menuitemradio" aria-checked="true" data-mode="light"><span class="mk">✓</span>화이트</button>
        <button id="themeDark" type="button" role="menuitemradio" aria-checked="false" data-mode="dark"><span class="mk">✓</span>다크</button>
        <button id="themeSystem" type="button" role="menuitemradio" aria-checked="false" data-mode="system"><span class="mk">✓</span>컴퓨터 설정 따름</button>
      </div>
    </div>
  </div>
</header>

<div id="storageNote" class="hint" role="status" hidden></div>

<!-- 맨 위 가로 줄: 곡 등록(끌어다 놓기·클릭). 폰·태블릿에서는 [곡] 탭에서만 보인다 -->
<div class="dropbar" id="dropBar" data-tab="song">
  <div id="dropZone" class="drop" title="음원 파일을 끌어다 놓거나 클릭해서 고릅니다. 파일은 이 기기 안에서만 처리됩니다">음원 파일을 끌어다 놓거나 클릭하세요<small>mp3 · wav · m4a · ogg · flac</small></div>
  <input id="fileInput" type="file" accept=".mp3,.wav,.m4a,.ogg,.flac,audio/*" hidden>
  <span id="songBusy" class="busychip" hidden><i class="spin"></i>분석 중</span>
</div>

<main class="cols" id="cols">
  <!-- ===== 왼쪽 열(따로 스크롤): 위 곡 정보·최근 곡·검사 / 아래 분석 (00 공통규칙 6절) ===== -->
  <aside class="col left" id="paneLeft">
    <section class="card cardsong" data-tab="song" id="cardSong">
      <div class="cardhead"><div class="lbl">곡 정보</div></div>
      <div id="welcome" class="summary welcome" hidden>
        <b>처음 오셨나요?</b>
        <p>음원 파일을 올려 시작하세요. 파일은 이 기기 안에서만 처리되고 어디로도 전송되지 않습니다.</p>
        <div class="row"><button id="btnWelcomeUpload" type="button" class="primary">곡 올리기</button><button id="btnDemo" type="button">체험용 데모 곡으로 시작</button></div>
        <small class="help">파일이 없어도 괜찮습니다. 데모 곡(코드로 만든 30초 드럼 비트)으로 분석부터 편집까지 체험해 볼 수 있습니다.</small>
      </div>
      <div id="songSummary" class="summary">열려 있는 곡이 없습니다.</div>
      <div class="lbl sub recenthead"><span>최근 작업한 곡</span><button id="btnRecentClear" type="button" class="ghost sm recentclear" hidden>모두 지우기…</button></div>
      <ul id="songList" class="songlist"></ul>
    </section>

    <section class="card cardinspect" data-tab="inspect" id="rightCol">
      <div class="cardhead"><div class="lbl">검사</div><span id="inspectBadge" class="ibadge ok" role="status">오류 0 · 경고 0</span><span class="sp"></span><button id="btnRightToggle" type="button" class="ghost sm" aria-expanded="true" title="검사 내용 접기/펴기">접기 ▴</button></div>
      <div class="rightbody" id="rightBody">
    <div class="sub selected" id="selectedPanel">
      <div class="lbl sub">선택한 노트</div>
      <div id="selectedBody" class="help">노트를 클릭해 선택하세요. (한 번에 하나만 선택됩니다)</div>
    </div>
    <div class="sub health" id="health">
      <div class="lbl sub">채보 건강검진 <span id="healthLight" class="light ok">이상 없음</span></div>
      <div id="healthBody">채보가 없습니다.</div>
      <ul id="issueList" class="issues"></ul>
    </div>
      </div>
    </section>

    <section class="card cardana lowcard" data-tab="analyze" id="cardAnalyze">
      <div class="lbl">분석</div>
      <div class="cardbody">
      <div id="presetCards" class="presets"></div>
      <label class="field">분석 방식 (소리가 시작되는 지점을 찾는 방법)
        <select id="detector"></select>
      </label>
      <p id="detectorHelp" class="help"></p>
      <label class="field">지점 민감도 (소리 시작 지점을 얼마나 많이 잡을까요)
        <div class="slider"><span>적게</span><input id="sensitivity" type="range" min="10" max="100" step="5" value="60"><span>많게</span><output id="sensitivityVal">60%</output></div>
        <small class="help">분석 단계 설정입니다. 곡에서 소리가 시작되는 곳을 몇 군데 찾을지만 정하며, 노트는 아직 만들지 않습니다.</small>
      </label>
      <div class="field">BPM (1분에 박이 몇 번인지)
        <div class="row">
          <input id="bpmInput" class="num" type="number" min="40" max="300" step="0.01" value="120">
          <button id="bpmHalf" type="button" class="sm">÷2</button>
          <button id="bpmDouble" type="button" class="sm">×2</button>
        </div>
        <div id="bpmCandidates" class="row wrap"></div>
        <small id="bpmNote" class="help"></small>
      </div>
      <label class="field">시작점 (첫 박의 위치, ms)
        <div class="row">
          <input id="offsetInput" class="num" type="number" step="1" value="0">
          <button type="button" class="sm nudge" data-delta="-10">-10</button><button type="button" class="sm nudge" data-delta="-1">-1</button><button type="button" class="sm nudge" data-delta="1">+1</button><button type="button" class="sm nudge" data-delta="10">+10</button>
        </div>
        <small class="help">메트로놈을 켜고 들으면서 눌러 보세요. 메트로놈 소리가 음악의 박보다 먼저 들리면 +, 늦게 들리면 - 를 누르세요.</small>
      </label>
      <label class="field">BPM·시작점을 바꿀 때 기존 노트는
        <select id="retimeMode">
          <option value="time">소리 위치 유지 (추천)</option>
          <option value="tick">박자 위치 유지</option>
        </select>
      </label>
      </div>
      <div class="cardfoot">
      <div id="analyzeError" class="errbox" role="alert" hidden><span class="eicon" aria-hidden="true">⚠</span><div><b id="analyzeErrorText"></b><div>다시 [분석]을 눌러 보세요.</div></div></div>
      <p id="analyzeHint" class="hint" hidden></p>
      <div class="row actionline">
        <button id="btnAnalyze" type="button" class="primary">분석</button>
        <button id="btnCancel" type="button" hidden>취소</button>
        <span id="analyzeBadge" class="pbadge" role="status" hidden><i class="spin"></i><span id="analyzeBadgeText"></span></span>
      </div>
      <div id="progressWrap" class="progress" hidden><div id="progressBar"></div></div>
      <ul id="analyzeWarn" class="help warnlist" hidden></ul>
      <p id="analyzeMsg" class="help">곡을 연 뒤 [분석]을 누르면 박자와 소리가 시작되는 지점을 찾습니다. 노트는 만들지 않습니다.</p>
      </div>
    </section>
  </aside>

  <!-- ===== 가운데 열(따로 스크롤): 음원 → 변속 구간 → 노트 생성, 카드마다 열 폭 전체 ===== -->
  <section class="col mid" id="paneMid">
    <section class="card cardaudio" data-tab="analyze" id="cardAudio">
      <div class="audiohead"><div class="lbl">음원</div><span id="audioTitle" class="audiosub">곡을 열어 주세요</span><span class="sp"></span>
        <label class="chk"><input id="hitSound" type="checkbox" checked> 히트사운드</label>
        <label class="chk" title="박자에 맞춰 딱딱 소리가 납니다. 음악과 어긋나면 BPM이나 시작점이 맞지 않는 것입니다. (단축키 M)"><input id="metro" type="checkbox" disabled> 메트로놈</label>
        <details class="soundmore">
          <summary title="박자 소리의 볼륨·간격과 소리 시작 지점 소리">소리 설정</summary>
        <div class="soundpop">
          <label class="vol" title="메트로놈 볼륨">박자 볼륨 <input id="metroVolume" type="range" min="0" max="100" value="60"></label>
          <select id="metroUnit" title="박자 소리를 내는 간격"><option value="beat">박</option><option value="half">반 박</option><option value="grid">지금 격자</option></select>
          <label class="chk" title="분석으로 찾은 소리 시작 지점마다 짧은 소리가 납니다. 음악 소리와 맞는지 들어 보세요."><input id="onsetSound" type="checkbox" disabled> 소리 시작 지점 소리</label>
        </div>
      </details>
      </div>
      <div class="tlhead"><small>눈금자·파형 클릭 = 재생 위치 이동 · 노트 줄은 편집 · 휠로 이동</small>
        <span class="legend"><i class="d tap"></i>단타 <i class="d hold"></i>롱노트 <i class="d burst"></i>연타 <i class="d cand"></i>소리 시작 지점</span>
        <label class="zoom">확대 <input id="tlZoom" type="range" min="4" max="90" step="1" value="20"> <output id="tlZoomVal">20초</output></label>
      </div>
      <!-- 09: 노트 줄 편집 도구 (오른쪽 채보 편집의 도구와 같은 S.tool 을 같이 쓴다. 폭 1024px 미만에서는 숨김) -->
      <div class="tltools" id="tlTools" role="group" aria-label="음원 카드 노트 줄 편집 도구"><span class="seglbl">노트 줄 편집</span><span class="seg"><button data-tool="select" class="tool active" type="button">선택</button><button data-tool="tap" class="tool" type="button">단타</button><button data-tool="hold" class="tool" type="button">롱노트</button><button data-tool="burst" class="tool" type="button">연타</button></span></div>
      <canvas id="timeline"></canvas>

      <div class="transport" id="transport">
      <button id="btnPlay" type="button" class="play" title="Space">▶</button>
      <span class="rates" title="재생 속도 (단축키: [ 느리게 / ] 빠르게). 저장하지 않고 열 때마다 1.0배입니다.">속도
        <span class="seg"><button class="sm mrate" type="button" data-rate="0.5">0.5</button><button class="sm mrate" type="button" data-rate="0.75">0.75</button><button class="sm mrate on" type="button" data-rate="1">1.0</button><button class="sm mrate" type="button" data-rate="1.25">1.25</button></span>
        <b id="rateLabel" class="ratelabel" hidden>0.5배</b><button id="btnRate1" class="sm" type="button" hidden>원래 속도(1.0배)</button>
      </span>
      <span id="timeLabel" class="time">0:00.0 / 0:00.0</span>
      <input id="seek" type="range" min="0" max="1000" value="0" step="1">
      <label class="vol">볼륨 <input id="volume" type="range" min="0" max="100" value="80"></label>
      </div>
    </section>
    <section class="card cardtempo lowcard" data-tab="analyze" id="cardTempo">
      <div class="cardhead"><div class="lbl">변속 구간</div><small id="tempoCount" class="help"></small></div>
      <div class="cardbody">
      <p class="help">곡 중간에 BPM이 바뀌면 여기서 구간을 나눕니다. 구간이 없으면 곡 전체가 한 BPM입니다.</p>
      <div id="tempoList" class="tempolist" aria-label="변속 구간 목록"></div>
      <div class="row wrap">
        <button id="btnTempoAdd" type="button" class="sm" title="재생 위치(없으면 선택한 노트 위치)에서 가장 가까운 박에 새 구간을 만듭니다">구간 추가</button>
        <label class="chk"><input id="tempoSnapBar" type="checkbox" checked> 마디에 맞춤</label>
        <button id="btnTempoReset" type="button" class="sm" disabled>전체를 한 BPM으로 되돌리기</button>
      </div>
      <label class="chk tempokeep"><input id="tempoKeepAfter" type="checkbox" checked> BPM을 고칠 때 뒤 구간은 소리 위치 유지</label>
      <small class="help">BPM을 고치면 그 구간 이후 시간이 모두 바뀝니다. 위 칸을 켜면 뒤 구간의 시작을 소리 위치에 가장 가까운 박으로 옮깁니다. 노트는 위 [BPM·시작점을 바꿀 때 기존 노트는] 설정을 따릅니다.</small>
      <div class="tempofind">
        <div class="row wrap">
          <select id="tempoSens" aria-label="변속 찾기 민감도"><option value="strict">엄격 5%</option><option value="normal" selected>보통 3%</option><option value="sensitive">민감 2%</option></select>
          <button id="btnTempoFind" type="button" class="sm" disabled>변속 자동 찾기</button>
        </div>
        <div id="tempoFound" class="tempofound" hidden></div>
        <p id="tempoMsg" class="help" role="status"></p>
      </div>
      </div>
    </section>
    <section class="card cardgen lowcard" data-tab="analyze" id="cardGen">
      <div class="lbl">노트 생성</div>
      <div class="cardbody">
      <label class="field">디자인 모드
        <select id="designMode">
          <option value="classic" selected>기존 방식 (설정한 비율·패턴 그대로)</option>
          <option value="reference">레퍼런스 규칙 (실제 채보 분석 기준 자동 적용)</option>
          <option value="unified">통합 규칙 (히트러스 규칙 + 레퍼런스 보정)</option>
        </select>
        <small class="help" id="designModeHelp">기존 방식: 아래 설정을 그대로 사용합니다.</small>
      </label>
      <div class="field unified-only" id="unifiedBox" hidden>
        <small class="help">통합 규칙 설정 — 비워 두면 곡 전체, 난이도 기본 밀도를 씁니다. 노트는 구간 시작 2초 뒤부터 끝 1초 전까지만 놓입니다.</small>
        <div class="row"><label>구간 시작(초) <input id="rangeStart" class="num small" type="number" min="0" step="0.1" placeholder="0"></label>
        <label>구간 끝(초) <input id="rangeEnd" class="num small" type="number" min="0" step="0.1" placeholder="곡 끝"></label></div>
        <label>목표 초당 노트 수 <input id="targetNps" class="num small" type="number" min="0.3" max="8" step="0.1" placeholder="난이도 기본"></label>
        <label><input id="allowBurst" type="checkbox"> 노트가 오래 비는 곳에 연타 넣기 (기본 꺼짐)</label>
      </div>
      <label class="field">난이도
        <select id="difficulty"><option value="EASY">쉬움</option><option value="NORMAL" selected>보통</option><option value="HARD">어려움</option></select>
      </label>
      <label class="field">노트 박자 단위 (격자)
        <select id="gridSelect">
          <option value="4">4분음표 (한 박에 1개)</option><option value="8">8분음표 (한 박에 2개)</option>
          <option value="12">8분 셋잇단 (한 박에 3개)</option><option value="16" selected>16분음표 (한 박에 4개)</option>
          <option value="24">16분 셋잇단 (한 박에 6개)</option><option value="32">32분음표 (한 박에 8개)</option>
          <option value="free">격자 없음</option>
        </select>
      </label>
      <label class="field not-unified">노트 양 (곡에 노트를 얼마나 많이 만들까요)
        <div class="slider"><span>적게</span><input id="density" type="range" min="10" max="100" step="5" value="55"><span>많게</span><output id="densityVal">55%</output></div>
        <small class="help">노트 자동 생성 단계 설정입니다. 찾아 둔 지점 중 실제 노트로 만들 개수를 정합니다.</small>
      </label>
      <label class="field classic-only">좌·우 버튼 패턴
        <select id="laneMode"></select>
      </label>
      <label class="field">박자 맞춤 정도
        <select id="gridTolerance">
          <option value="strict" selected>엄격 (기본)</option>
          <option value="normal">보통</option>
          <option value="loose">느슨</option>
        </select>
        <small class="help">느슨하게 하면 노트가 늘어나지만, 소리와 노트가 조금 어긋날 수 있습니다.</small>
      </label>
      <div class="field classic-only">노트 종류 비율 (합계 100%)
        <small class="help">곡에 만들 노트 중 롱노트·연타의 비중입니다. 롱노트·연타는 입력한 값 그대로 쓰고(슬라이더 1% 단위, 숫자는 소수 첫째 자리까지 입력 후 Enter), 단타는 나머지(100 − 롱노트 − 연타)로 자동 계산됩니다. 연타는 노트가 몰린 곳을 묶어서 만듭니다.</small>
        <div class="ratio"><span class="chip tap">단타</span><input id="ratioTap" type="range" min="0" max="100" step="1" value="70" disabled aria-label="단타 비율 (자동)"><input id="ratioTapNum" class="num small" type="number" readonly tabindex="-1" min="0" max="100" step="0.1" value="70" aria-label="tap 비율 직접 입력">%<output id="ratioTapVal">적용 70%</output><small class="auto">자동</small></div>
        <div class="ratio"><span class="chip hold">롱노트</span><input id="ratioHold" type="range" min="0" max="100" step="1" value="20"><input id="ratioHoldNum" class="num small" type="number" min="0" max="100" step="0.1" value="20" aria-label="hold 비율 직접 입력">%<output id="ratioHoldVal">적용 20%</output></div>
        <div class="ratio"><span class="chip burst">연타</span><input id="ratioBurst" type="range" min="0" max="100" step="1" value="10"><input id="ratioBurstNum" class="num small" type="number" min="0" max="100" step="0.1" value="10" aria-label="burst 비율 직접 입력">%<output id="ratioBurstVal">적용 10%</output></div>
        <small class="help" id="ratioMsg" role="status"></small>
      </div>
      <label class="field classic-only">롱노트 기본 길이 (박)
        <input id="holdBeats" class="num" type="number" min="0.25" max="16" step="0.25" value="1">
      </label>
      <div class="field classic-only">연타 기본 횟수 (3~100)
        <small class="help">한 번에 연타할 횟수입니다. 연타 길이는 노트가 몰린 정도에 맞춰 정해집니다 (예: 1박에 노트 4개 → 8회는 2박).</small>
        <div class="slider"><input id="burstRange" type="range" min="3" max="100" step="1" value="8"><input id="burstNum" class="num small" type="number" min="3" max="100" step="1" value="8"></div>
      </div>
      </div>
      <div class="cardfoot">
      <p id="genHint" class="hint" hidden></p>
      <div class="row actionline">
        <button id="btnGenerate" type="button" class="primary">노트 자동 생성</button>
        <button id="btnClear" type="button">초기화</button>
        <span id="genBadge" class="pbadge" role="status" hidden><i class="spin"></i><span id="genBadgeText"></span></span>
      </div>
      </div>
    </section>
  </section>

  <!-- ===== 오른쪽 열: 채보 편집(고정) ===== -->
  <aside class="col right" id="paneRight">
    <section class="card cardedit" data-tab="edit" id="cardEdit">
      <div class="cardhead">
        <div><div class="lbl">채보 편집</div><div class="ctitle" id="noteCount">0개 노트</div></div>
        <div class="helpwrap"><button id="btnEditHelp" type="button" class="ghost sm" aria-expanded="false" aria-controls="editHelp">편집 도움말</button>
          <div id="editHelp" class="popover" role="dialog" aria-label="편집 도움말" hidden><div class="helplist" id="toolHelp"></div></div></div>
      </div>
      <div class="toolrow">
        <div class="toprow">
          <div class="edhead">
            <select id="diffSelect" hidden title="편집할 난이도"></select>
            <button id="btnUndo" type="button" class="sm" title="Ctrl+Z">되돌리기</button>
            <button id="btnRedo" type="button" class="sm" title="Ctrl+Y">다시하기</button>
          </div>
          <span class="sp"></span>
          <div class="navbtns"><button id="btnPrev" type="button" class="sm">이전 구간</button><button id="btnNext" type="button" class="sm">다음 구간</button></div>
        </div>
        <div class="tools" id="tools">
          <span class="seg wide" role="group" aria-label="편집 도구">
            <button data-tool="select" class="tool active" type="button">선택</button>
            <button data-tool="tap" class="tool" type="button">단타</button>
            <button data-tool="hold" class="tool" type="button">롱노트</button>
            <button data-tool="burst" class="tool" type="button">연타</button>
          </span>
        </div>
      </div>
      <div class="viewopts" role="group" aria-label="보기 설정">
        <button id="btnWave" type="button" class="sm toggle" aria-pressed="false" title="음원의 파형을 오른쪽 띠로 봅니다 (폭 = 소리 크기, 색 = 저음 주황 · 중음 초록 · 고음 하늘)">파형</button>
        <span class="seg shapeseg" role="group" aria-label="노트 모양">
          <span class="seglbl">노트 모양</span>
          <button data-shape="circle" class="shape active" type="button" aria-pressed="true">동그라미</button>
          <button data-shape="bar" class="shape" type="button" aria-pressed="false">바</button>
        </span>
      </div>
      <div class="vwrap"><canvas id="vertical"></canvas></div>
      <div id="selBar" class="selbar" role="toolbar" aria-label="선택한 노트 편집" hidden></div>
    </section>
  </aside>
  <!-- 08: 가운데 열과 오른쪽 채보 편집 사이 손잡이(PC 폭 1024px 이상만 보임). 끌어서 폭 조절, 더블클릭: 기본 폭 -->
  <div id="editResizer" class="resizer" role="separator" aria-orientation="vertical" aria-label="채보 편집 폭 조절" tabindex="0" title="끌어서 채보 편집 폭 조절 · 더블클릭: 기본 폭"></div>
</main>

<nav id="tabBar" class="tabbar" aria-label="화면 이동"><button type="button" data-tab="song"><i aria-hidden="true">♪</i><span>곡</span></button><button type="button" data-tab="analyze"><i aria-hidden="true">≋</i><span>분석</span></button><button type="button" data-tab="edit"><i aria-hidden="true">✎</i><span>편집</span></button><button type="button" data-tab="inspect"><i aria-hidden="true">✓</i><span>검사</span></button><button type="button" data-tab="play"><i aria-hidden="true">▶</i><span>플레이</span></button></nav>

<footer class="statusbar"><div id="statusLine" class="status" role="status" aria-live="polite">[곡 올리기]를 누르거나 맨 위 줄에 음원 파일을 끌어다 놓으세요.</div><span id="appVersion" class="appver">웹 버전</span></footer>

<dialog id="dlgBurst">
  <form method="dialog" id="burstForm" novalidate>
    <h3>연타 횟수</h3>
    <p class="help" id="burstInfo"></p>
    <div class="slider"><input id="dlgBurstRange" type="range" min="3" max="100" step="1" value="8"><input id="dlgBurstNum" class="num small" type="number" min="3" max="100" value="8"></div>
    <p id="burstRate" class="help"></p>
    <div class="row"><button value="ok" class="primary" id="burstOk">확인</button><button value="cancel" id="burstCancel" formnovalidate>취소</button></div>
  </form>
</dialog>

<dialog id="dlgExport">
  <form method="dialog" id="exportForm" novalidate>
    <h3>내보내기</h3>
    <div class="lbl">내보낼 것</div>
    <label class="opt"><input type="radio" name="what" value="chart" checked> 채보 JSON</label>
    <label class="opt"><input type="radio" name="what" value="audio"> 음원 (원본 파일을 ZIP 에 담아 저장)</label>
    <label class="opt"><input type="radio" name="what" value="both"> 채보 JSON + 음원 (ZIP 하나)</label>
    <div id="exportChartOpts">
      <div class="lbl sub">파일 종류</div>
      <label class="opt"><input type="radio" name="kind" value="unity" checked> Unity용 (시간이 ms 로 계산된 단순한 파일)</label>
      <label class="opt"><input type="radio" name="kind" value="edit"> 편집용 (이 프로그램에서 다시 열 수 있는 전체 파일)</label>
      <div class="lbl sub">옵션</div>
      <label class="opt"><input type="checkbox" id="exportSplit"> Unity용은 난이도마다 따로 만들기 (여러 개면 ZIP 하나로 묶음)</label>
    </div>
    <p class="help" id="exportHelp">오류가 있는 채보는 Unity용으로 내보낼 수 없습니다. 다음 창에서 파일 이름을 확인하고 저장합니다.</p>
    <div class="dlgfoot"><button value="cancel" formnovalidate>취소</button><button value="ok" class="primary" id="exportOk">내보내기</button></div>
  </form>
</dialog>
<dialog id="dlgSave" aria-labelledby="saveTitle">
  <form method="dialog" id="saveForm" novalidate>
    <h3 id="saveTitle">파일 저장</h3>
    <p class="help" id="saveQuestion"></p>
    <label class="field">파일 이름 (다른 이름으로 저장)
      <input id="saveName" type="text" class="fname" maxlength="200" autocomplete="off" spellcheck="false">
    </label>
    <div class="savemeta"><span>종류</span><b id="saveKind"></b><span>용량</span><b id="saveSize"></b></div>
    <p class="help" id="saveNote"></p>
    <div class="dlgfoot"><button value="cancel" id="saveCancel" formnovalidate>취소</button><button value="ok" class="primary" id="saveOk">저장</button></div>
  </form>
</dialog>
<dialog id="deleteSongDialog" aria-labelledby="deleteSongTitle">
  <form method="dialog" id="deleteSongForm" novalidate>
    <h3 id="deleteSongTitle">작업을 지울까요?</h3>
    <p class="help" id="deleteSongMsg"></p>
    <p class="help" id="deleteSongExtra" hidden></p>
    <div class="dlgfoot"><button value="cancel" id="deleteSongCancel" formnovalidate autofocus>취소</button><button value="ok" class="dangerfill" id="deleteSongOk">지우기</button></div>
  </form>
</dialog>
<input id="jsonInput" type="file" accept=".json,.zip,application/json,application/zip,application/x-zip-compressed" hidden>
<div id="toast" class="toast" role="status"></div>
<div id="undoBar" class="toast undobar" role="status"><span id="undoMsg"></span><button id="btnUndoDelete" type="button" class="sm">되돌리기</button></div>
</body>
</html>
`,a=`<!-- [테스트] 팝업 화면 조각: 원본 test.html 의 화면 구조(DOM)를 그대로 따른다. app/main.ts 가 #rcw-test 주소에서 이 조각을 넣고 js/test_popup.js 를 불러온다. -->
<style>
body{min-width:0;min-height:0;padding:var(--s3);align-items:center;height:auto;overflow-y:auto}#startBtn,#pauseBtn{white-space:nowrap;min-width:90px;flex:none}.hud .help{flex:1;min-width:0;margin:0}
#game{width:100%;max-width:480px;height:560px;border-radius:var(--r-panel);background:var(--bg-canvas);touch-action:none;flex:none}
.hud{display:flex;justify-content:space-between;width:100%;max-width:480px;margin:6px 0;gap:var(--s2);align-items:center}
.big{font-size:var(--fs-title);font-weight:var(--fw-strong)}
#judgeText.j-perfect{color:var(--ok)}#judgeText.j-miss{color:var(--bad)}#judgeText.j-auto{color:var(--warn)}
#result,#settings,#pauseBox{width:100%;max-width:480px;margin-top:var(--s2)}
#result .line{line-height:1.7}
.hist{display:grid;grid-template-columns:62px 1fr 28px;gap:2px 6px;align-items:center;font-size:11px;color:var(--text-muted);margin:6px 0}
.hist .bar{height:8px;background:var(--action);border-radius:3px;min-width:1px}
.set-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:7px 0}
.set-row label{min-width:96px;color:var(--text-2)}
.set-row input[type=number]{width:70px;height:32px;background:var(--bg-panel);border:1px solid var(--line);border-radius:var(--r-sm);padding:0 6px}
.set-row input[type=range]{flex:1;min-width:120px}
.keycap{display:inline-block;min-width:34px;text-align:center;padding:3px 8px;border:1px solid var(--line);border-radius:var(--r-sm);background:var(--bg-soft);font-weight:var(--fw-strong)}
.keycap.wait{border-color:var(--warn);color:var(--warn)}
#settingsMsg{min-height:18px;color:var(--warn);font-size:var(--fs-small);margin:4px 0}
#measureBox{border:1px dashed var(--line);border-radius:var(--r-sm);padding:var(--s2);margin-top:6px}
#measureBox[hidden]{display:none}
summary{cursor:pointer}
.misslist{margin:6px 0;padding:0;list-style:none;max-height:180px;overflow-y:auto}
.misslist li{padding:3px 6px;border-radius:var(--r-sm)}
.misslist li.link{cursor:pointer;color:var(--bad)}.misslist li.link:hover{background:var(--bg-app)}
#startBar{width:70px}
#pauseBox[hidden]{display:none}#rateNum{width:70px;height:32px;background:var(--bg-panel);border:1px solid var(--line);border-radius:var(--r-sm);padding:0 6px}.rate.on{border-color:var(--action);color:var(--action-text);font-weight:var(--fw-strong)}.inl{display:inline-flex;gap:4px;align-items:center}
</style>

<div class="hud"><span id="combo" class="big">콤보 0</span><span id="judgeText" class="big">시작을 눌러 주세요</span></div>
<canvas id="game"></canvas>
<div class="hud"><button id="startBtn" class="primary" type="button" disabled>불러오는 중…</button><button id="pauseBtn" type="button" disabled>일시정지</button><span class="help" id="help">키보드 S(왼쪽) · F(오른쪽) 또는 화면 왼쪽/오른쪽을 누르세요. 롱노트는 끝까지 누르고 있으세요.</span></div>
<div id="pauseBox" class="card" hidden>
  <div class="line" id="pauseText">일시정지 중입니다. 설정을 바꿀 수 있습니다. (Esc 로도 이어하기)</div>
  <div class="set-row"><button id="resumeBtn" class="primary" type="button">이어하기</button><button id="restartBtn" type="button">처음부터 다시</button><button id="stopBtn" type="button">중지(끝내기)</button><label class="inl"><input id="stopShowResult" type="checkbox" checked> 끝낼 때 결과 보기</label></div>
</div>
<div id="result" class="card" hidden></div>
<details id="settings" class="card" open>
  <summary>테스트 설정</summary>
  <div class="set-row">
    <label for="latNum">입력 지연 보정(ms)</label>
    <input id="latNum" type="number" min="-500" max="500" step="1" value="0">
    <input id="latRange" type="range" min="-500" max="500" step="1" value="0" aria-label="입력 지연 보정 슬라이더">
  </div>
  <div class="help" id="latHelp">키를 늦게 누르는 느낌이면 + 값, 일찍 눌리는 느낌이면 − 값. 판정에만 적용되고 채보 파일은 바뀌지 않습니다.</div>
  <div class="set-row"><span id="outLatency" class="help">소리 출력 지연: 확인 중…</span><button id="btnApplyEst" class="sm" type="button" hidden>추정값 적용</button></div>
  <div class="set-row"><button id="btnMeasure" class="sm" type="button">지연 측정</button><span class="help">박자 소리에 맞춰 키를 눌러 내 환경의 지연을 재 봅니다. 유선 이어폰이나 스피커를 권장합니다. 블루투스는 지연이 큽니다.</span></div>
  <div id="measureBox" hidden>
    <div id="measureText" class="line"></div>
    <div class="set-row"><button id="btnMeasureApply" class="sm primary" type="button" hidden>적용</button></div>
  </div>
  <div class="set-row"><label>왼쪽 키</label><span id="keyLeft" class="keycap">S</span><button id="btnKeyLeft" class="sm" type="button">키 바꾸기</button></div>
  <div class="set-row"><label>오른쪽 키</label><span id="keyRight" class="keycap">F</span><button id="btnKeyRight" class="sm" type="button">키 바꾸기</button><button id="btnKeyReset" class="sm" type="button">기본값으로 되돌리기</button></div>
  <div class="set-row">
    <label for="startMode">시작 위치</label>
    <select id="startMode"><option value="start">처음부터</option><option value="current">현재 위치부터</option><option value="selected">선택한 노트부터</option><option value="bar">마디 번호부터</option></select>
    <input id="startBar" type="number" min="1" step="1" value="1" aria-label="시작 마디"><span class="help">마디</span>
  </div>
  <div class="help">"현재 위치"와 "선택한 노트"는 메인 화면 기준입니다. 시작 전에 박자 소리(카운트인)가 2~3초 납니다.</div>
  <div class="set-row"><label for="showDiff">판정 표시</label><input id="showDiff" type="checkbox" checked><span class="help">빠름/느림과 ms 를 함께 보여 줍니다</span></div>
  <div class="set-row">
    <label for="volRange">음악 볼륨</label>
    <input id="volRange" type="range" min="0" max="100" step="1" value="80" aria-label="테스트 음악 볼륨">
    <span id="volVal">80</span><span class="help">% · 박자 소리(카운트인)·지연 측정 소리는 이 볼륨과 상관없이 같은 크기입니다. 저장됩니다.</span>
  </div>
  <div class="set-row">
    <label for="leadRange">낙하 시간(ms)</label>
    <input id="leadRange" type="range" min="500" max="2000" step="50" value="1800">
    <span id="leadVal">1800</span>
  </div>
  <div class="set-row">
    <label>재생 속도</label>
    <span id="rateBtns"><button class="sm rate" type="button" data-rate="0.5">0.5배</button> <button class="sm rate" type="button" data-rate="0.75">0.75배</button> <button class="sm rate on" type="button" data-rate="1">1.0배</button> <button class="sm rate" type="button" data-rate="1.25">1.25배</button></span>
    <input id="rateNum" type="number" min="0.25" max="1.5" step="0.05" value="1" aria-label="재생 속도 직접 입력"><span class="help">배 (0.25~1.5). 연습용이라 저장하지 않고 매번 1.0배로 시작합니다. 시작 전·일시정지 중에만 바꿀 수 있습니다.</span>
  </div>
  <div class="help">속도를 바꾸면 음악 높이(음정)도 함께 달라질 수 있습니다. 판정 폭은 실제 손 기준 시간을 그대로 씁니다.</div>
  <div class="set-row"><label for="autoPause">자동 일시정지</label><input id="autoPause" type="checkbox" checked><span class="help">다른 창을 누르거나 탭을 바꾸면 자동으로 멈춥니다</span></div>
  <div id="settingsMsg" role="status"></div>
</details>
`,o=class{size;cos;sin;rev;constructor(e){if(e<2||e&e-1)throw Error(`FFT 길이는 2의 거듭제곱이어야 합니다.`);this.size=e,this.cos=new Float64Array(e/2),this.sin=new Float64Array(e/2);for(let t=0;t<e/2;t++)this.cos[t]=Math.cos(2*Math.PI*t/e),this.sin[t]=-Math.sin(2*Math.PI*t/e);this.rev=new Uint32Array(e);let t=Math.log2(e);for(let n=0;n<e;n++){let e=0;for(let r=0;r<t;r++)n&1<<r&&(e|=1<<t-1-r);this.rev[n]=e}}transform(e,t){let n=this.size,r=this.rev;for(let i=0;i<n;i++){let n=r[i];if(n>i){let r=e[i];e[i]=e[n],e[n]=r;let a=t[i];t[i]=t[n],t[n]=a}}for(let r=2;r<=n;r<<=1){let i=r>>1,a=n/r;for(let o=0;o<n;o+=r)for(let n=0;n<i;n++){let r=this.cos[n*a],s=this.sin[n*a],c=o+n,l=c+i,u=e[l]*r-t[l]*s,d=e[l]*s+t[l]*r;e[l]=e[c]-u,t[l]=t[c]-d,e[c]=e[c]+u,t[c]=t[c]+d}}}};function s(e){let t=new Float64Array(e);for(let n=0;n<e;n++)t[n]=.5-.5*Math.cos(2*Math.PI*n/e);return t}function c(e,t){let n=e.length;if(n===0)return NaN;let r=Float64Array.from(e).sort(),i=(n-1)*t/100,a=Math.floor(i),o=Math.min(n-1,a+1);return r[a]+(r[o]-r[a])*(i-a)}function l(e){return c(e,50)}function u(e,t){let n=Math.tan(Math.PI*e/t),r=Math.SQRT2,i=1+r*n+n*n,a=n*n/i;return{b0:a,b1:2*a,b2:a,a1:2*(n*n-1)/i,a2:(1-r*n+n*n)/i}}function d(e,t){let n=Math.tan(Math.PI*e/t),r=Math.SQRT2,i=1+r*n+n*n,a=1/i;return{b0:a,b1:-2*a,b2:a,a1:2*(n*n-1)/i,a2:(1-r*n+n*n)/i}}function f(e,t){let n=new Float32Array(e.length),r=0,i=0;for(let a=0;a<e.length;a++){let o=e[a],s=t.b0*o+r;r=t.b1*o-t.a1*s+i,i=t.b2*o-t.a2*s,n[a]=s}return n}function p(e,t){let n=e.length,r=new Float64Array(t+1);for(let i=0;i<=t&&i<n;i++){let t=0;for(let r=0;r+i<n;r++)t+=e[r]*e[r+i];r[i]=t}return r}var m=class extends Error{constructor(){super(`분석을 취소했습니다.`),this.name=`AnalysisAborted`}};function h(e){if(e?.aborted)throw new m}var g=2e3;function _(e,t=22050){return Math.ceil(e/Math.round(t*20/1e3))}function v(e,t){return f(f(e,t),t)}function y(e,t,n,r,i){for(let a=0;a<n;a++){let n=Math.min(e.length,(a+1)*t),o=0;for(let r=a*t;r<n;r++){let t=Math.abs(e[r]);t>o&&(o=t)}r[a*4+i]=o>=1?255:Math.round(o*255)}}async function b(e,t=22050,n,r,i){let a=Math.round(t*20/1e3),o=_(e.length,t),s=new Uint8Array(o*4),c=async e=>{h(r),n?.(e),i&&await i()};return y(e,a,o,s,0),await c(.2),y(v(e,u(250,t)),a,o,s,1),await c(.45),y(v(v(e,d(250,t)),u(g,t)),a,o,s,2),await c(.75),y(v(e,d(g,t)),a,o,s,3),await c(1),{version:1,hop_ms:20,frames:o,data:s}}function x(e){if(!e||typeof e!=`object`)return!1;let t=e;return t.version===1&&typeof t.frames==`number`&&typeof t.hop_ms==`number`&&t.data instanceof Uint8Array&&t.data.length===t.frames*4}var S=`rcw.songs.v1`,C=`songs`,w=`audio`,T=class extends Error{constructor(e){super(e),this.name=`StorageError`}};function E(){let e=new Map,t=t=>{let n=e.get(t);return n||(n=new Map,e.set(t,n)),n};return{persistent:!1,get:async(e,n)=>t(e).get(n),put:async(e,n,r)=>{t(e).set(n,r)},del:async(e,n)=>{t(e).delete(n)},all:async e=>[...t(e).values()]}}function D(e){return new Promise((t,n)=>{e.onsuccess=()=>t(e.result),e.onerror=()=>n(e.error??Error(`저장소 오류`))})}async function O(e=S){if(typeof indexedDB>`u`)throw Error(`indexedDB 없음`);let t=await new Promise((t,n)=>{let r=indexedDB.open(e,1);r.onupgradeneeded=()=>{r.result.createObjectStore(C),r.result.createObjectStore(w)},r.onsuccess=()=>t(r.result),r.onerror=()=>n(r.error??Error(`IndexedDB 열기 실패`)),r.onblocked=()=>n(Error(`IndexedDB 가 막혀 있습니다`))}),n=(e,n,r)=>{let i=t.transaction(e,n),a=new Promise((e,t)=>{i.oncomplete=()=>e(),i.onerror=()=>t(i.error??Error(`저장 실패`)),i.onabort=()=>t(i.error??Error(`저장 취소`))}),o=D(r(i.objectStore(e)));return Promise.all([o,a]).then(([e])=>e)};return{persistent:!0,get:(e,t)=>n(e,`readonly`,e=>e.get(t)),put:async(e,t,r)=>{await n(e,`readwrite`,e=>e.put(r,t))},del:async(e,t)=>{await n(e,`readwrite`,e=>e.delete(t))},all:e=>n(e,`readonly`,e=>e.getAll())}}function k(e){let t=e instanceof Error?e.name:``,n=e instanceof Error?e.message:String(e);return t===`QuotaExceededError`||/quota/i.test(n)?new T(`이 기기의 저장 공간이 부족해서 저장하지 못했습니다. 안 쓰는 곡을 지우거나 [내보내기]로 파일을 저장해 주세요.`):new T(`저장하지 못했습니다. 브라우저의 저장 기능이 막혀 있을 수 있습니다. 작업 후 [내보내기]로 파일을 저장해 주세요.`)}function ee(e,t){let n=e.chart;return{id:e.id,title:n?.song?.title||e.name,audio_file:e.audioMeta.fileName,has_audio:!0,duration_ms:n?.song?.duration_ms??e.audioMeta.durationMs,has_chart:!!n,analyzed:!!e.analysis,note_count:n?n.difficulties.reduce((e,t)=>e+t.notes.length,0):0,analyzing:t,trashed:!!e.trashedAt,sha256:e.audioMeta.sha256}}var te=class e{kv;busy=new Set;constructor(e){this.kv=e}get persistent(){return this.kv.persistent}static async open(){try{return new e(await O())}catch{return new e(E())}}newId(){return`s`+Date.now().toString(36)+Math.random().toString(36).slice(2,7)}async writeRecord(e){let{audioBlob:t,...n}=e;try{await this.kv.put(C,e.id,n)}catch(e){throw k(e)}}async addSong(e){let t=Date.now(),n={id:this.newId(),name:e.name,audioMeta:e.meta,analysis:null,chart:e.chart,trashedAt:null,createdAt:t,updatedAt:t,history:[]};try{await this.kv.put(w,n.id,e.blob)}catch(e){throw k(e)}try{await this.writeRecord(n)}catch(e){throw await this.kv.del(w,n.id).catch(()=>void 0),e}return{...n,audioBlob:e.blob}}async get(e,t=!0){let n=await this.kv.get(C,e);if(!n)return null;let r={...n,history:n.history??[]};return t&&(r.audioBlob=await this.kv.get(w,e)??void 0),r}async list(e=!1){return(await this.kv.all(C)).filter(t=>!!t.trashedAt===e).sort((e,t)=>e.createdAt-t.createdAt).map(e=>ee({...e,history:e.history??[]},this.busy.has(e.id)))}async findBySha(e){return(await this.list(!1)).find(t=>t.sha256===e)??null}async saveChart(e,t){let n=await this.get(e,!1);if(!n)throw new T(`저장할 곡을 찾을 수 없습니다. 곡이 지워졌을 수 있습니다.`);let r=[...n.history];if(n.chart&&JSON.stringify(n.chart)!==JSON.stringify(t))for(r.push({savedAt:new Date().toISOString(),chart:n.chart});r.length>20;)r.shift();await this.writeRecord({...n,chart:t,history:r,updatedAt:Date.now()})}async saveWave(e,t){try{await this.kv.put(w,`${e}:wave`,t)}catch(e){throw k(e)}}async getWave(e){let t=await this.kv.get(w,`${e}:wave`);return x(t)?t:null}async saveAnalysis(e,t){let n=await this.get(e,!1);if(!n)throw new T(`저장할 곡을 찾을 수 없습니다. 곡이 지워졌을 수 있습니다.`);await this.writeRecord({...n,analysis:t,updatedAt:Date.now()})}async saveMeta(e,t){let n=await this.get(e,!1);n&&await this.writeRecord({...n,audioMeta:{...n.audioMeta,...t},updatedAt:Date.now()})}async trash(e){if(this.busy.has(e))return!1;let t=await this.get(e,!1);return t?(await this.writeRecord({...t,trashedAt:Date.now()}),!0):!1}async restore(e){let t=await this.get(e,!1);if(!t||!t.trashedAt)return null;let n=await this.list(!1),r=new Set(n.map(e=>e.title)),i=t.name,a=!1;if(r.has(t.chart?.song?.title||t.name)){let e=2;for(;r.has(`${t.name} (${e})`);)e++;i=`${t.name} (${e})`,a=!0}let o=t.chart&&a?{...t.chart,song:{...t.chart.song,title:i}}:t.chart;return await this.writeRecord({...t,name:i,chart:o,trashedAt:null,updatedAt:Date.now()}),{id:e,renamed:a}}async purge(e){let t=await this.get(e,!1);return!t||!t.trashedAt?!1:(await this.kv.del(C,e),await this.kv.del(w,e),await this.kv.del(w,`${e}:wave`).catch(()=>void 0),await this.kv.del(w,`${e}:spectro`).catch(()=>void 0),!0)}};async function ne(e=209715200){try{let t=await navigator.storage?.estimate?.();if(!t||t.quota===void 0||t.usage===void 0)return null;let n=t.quota-t.usage;if(n<e)return`이 기기의 남은 저장 공간이 약 ${Math.max(0,Math.round(n/1024/1024))}MB 로 적습니다. 안 쓰는 곡을 지우거나 [내보내기]로 파일을 저장해 두세요.`}catch{}return null}var A=`modulepreload`,j=function(e,t){return new URL(e,t).href},M={},re=function(e){return e.pathname.endsWith(`.css`)},ie=function(e,t,n){if(t in e)return e[t];let r=n();if(!r){e[t]=void 0;return}let i=r.then(()=>{e[t]=void 0},n=>{throw e[t]=void 0,n});return e[t]=i,i},N=function(e,t,n){let r=Promise.resolve();if(t&&t.length>0){let e,i=document.querySelector(`meta[property=csp-nonce]`),a=i?.nonce||i?.getAttribute(`nonce`);function o(e){return Promise.all(e.map(e=>Promise.resolve(e).then(e=>({status:`fulfilled`,value:e}),e=>({status:`rejected`,reason:e}))))}function s(e){return import.meta.resolve?new URL(import.meta.resolve(e)):new URL(e,import.meta.url)}r=o(t.map(t=>{t=j(t,n);let r=s(t),i=re(r);return ie(M,r.href,()=>{if(e===void 0){e={all:new Set,styles:new Set};let t=document.getElementsByTagName(`link`);for(let n=t.length-1;n>=0;n--){let r=t[n];e.all.add(r.href),r.rel===`stylesheet`&&e.styles.add(r.href)}}if((i?e.styles:e.all).has(r.href))return;let t=document.createElement(`link`);if(t.rel=i?`stylesheet`:A,i||(t.as=`script`),t.crossOrigin=``,t.href=r.href,a&&t.setAttribute(`nonce`,a),document.head.appendChild(t),i)return new Promise((e,n)=>{t.addEventListener(`load`,e),t.addEventListener(`error`,()=>n(Error(`Unable to preload CSS for ${r}`)))})})}).filter(e=>e!==void 0))}function i(e){let t=new Event(`vite:preloadError`,{cancelable:!0});if(t.payload=e,window.dispatchEvent(t),!t.defaultPrevented)throw e}return r.then(t=>{for(let e of t||[])e.status===`rejected`&&i(e.reason);return e().catch(i)})},P=null,F=null;function ae(e){P=e}function oe(e){F=e}function se(e){F?.(e)}function ce(){return new Promise(e=>{let t=document.createElement(`dialog`);t.id=`playStub`,t.innerHTML=`<form method="dialog"><h3>게임 화면 테스트</h3><p class="help">플레이 화면은 03단계에서 연결됩니다. 지금은 편집기의 [테스트] 버튼으로 판정을 확인할 수 있습니다.</p><div class="dlgfoot"><button value="ok" class="primary">확인</button></div></form>`,t.addEventListener(`close`,()=>{t.remove(),e(null)}),document.body.appendChild(t),t.showModal()})}function I(e){return P?P(e,document.body):ce()}ae((e,t)=>N(()=>import(`./play-CI8lHabZ.js`).then(n=>n.runPlay(e,t)),__vite__mapDeps([0,1,2]),import.meta.url));function L(e,n){let r=n.toUpperCase(),i=e.difficulties.find(e=>e.name.toUpperCase()===r);return i===void 0?null:[...i.notes].sort((e,n)=>e.tick-n.tick||t(e.lane)-t(n.lane)).map(e=>e.id)}function R(e){let t=e.timing.bpm_map[0];return t===void 0||!(t.bpm>0)?null:t.bpm}function z(e,t=window){let n;try{n=t.__editor?.()}catch{n=void 0}let r=n?.S?.chart??null,i=n?.A?.audio?.position;return{bpm:r===null?null:R(r),beatOriginMs:r===null?0:(r.song.audio_offset_ms||0)+(r.song.decoder_delay_ms||0),noteIds:r===null?null:L(r,e),positionMs:typeof i==`number`&&Number.isFinite(i)?i:null}}var B={width:720,height:1280},V={touchPixelRatioCap:2,touchEffectLevel:`normal`,desktopPixelRatioCap:1.5,tapHintMs:4500,minTouchPx:44};function H(e,t,n=B.width,r=B.height){if(!(e>0)||!(t>0))return{scale:1,left:0,top:0};let i=Math.min(e/n,t/r);return{scale:i,left:(e-n*i)/2,top:(t-r*i)/2}}function U(e=window){return e.matchMedia?.(`(pointer: coarse)`).matches??!1?!0:!(e.matchMedia?.(`(hover: hover)`).matches??!0)&&(e.navigator?.maxTouchPoints??0)>0}function W(e,t,n){let r=e*Math.min(Math.max(t,1),n);return Math.min(1.5,Math.max(.5,r))}var G={sm:640,pc:1024,landscapeMaxWidth:1023,shortHeight:500},le=`(max-width: 1023px)`;function ue(e,t){return e<G.sm?`mobile`:e<G.pc?t<G.shortHeight?`mobile`:`tablet`:`pc`}function de(e,t){return t<G.shortHeight&&e<=G.landscapeMaxWidth}var K={min:1500,max:4e4};function fe(e){return Math.max(K.min,Math.min(K.max,e))}function pe(e,t,n,r){return e+n/Math.max(1,r-36)*t}function me(e,t,n,r){let i=q(t,n);return{anchorMs:e.start+i*e.span,spanStart:e.span,distStart:Math.max(1,r)}}function q(e,t){let n=Math.max(1,t-36);return(t-22-e)/n}function he(e,t,n,r){let i=fe(e.spanStart*(e.distStart/Math.max(1,t))),a=q(n,r);return{span:i,start:e.anchorMs-a*i}}function ge(e,t){return Math.hypot(e.x-t.x,e.y-t.y)}var J={tapSlopPx:10,longPressMs:420};function _e(e,t){return t?`paste-preview`:e===`hold`||e===`burst`?`drag-create`:`scroll`}var ve={bottomBarPx:44,minSidePanelPx:180,maxSidePanelPx:360,panelGapPx:16};function ye(e,t,n={top:0,right:0,bottom:0,left:0}){let r=ve,i=de(e,t)?`phone-landscape`:e>=G.pc?`pc`:e>=G.sm?`tablet`:`phone`,a=Math.max(1,e-n.left-n.right),o=i===`tablet`?r.bottomBarPx:0,s=H(a,Math.max(1,t-n.top-n.bottom-o)),c={scale:s.scale,left:s.left+n.left,top:s.top+n.top},l=B.width*s.scale,u=B.height*s.scale,d=0;if(i===`pc`){let t=(e-l)/2-r.panelGapPx*2;d=t>=r.minSidePanelPx?Math.min(r.maxSidePanelPx,Math.floor(t)):0}return{mode:i,fit:c,stageWidth:l,stageHeight:u,sidePanelWidth:d,bottomBarHeight:o}}var Y=`rcw.layout.v1`,X={tab:`song`};function be(){try{let e=localStorage.getItem(Y);if(!e)return{...X};let t=JSON.parse(e);return{tab:[`song`,`analyze`,`edit`,`inspect`].includes(t.tab)?t.tab:X.tab}}catch{return{...X}}}function xe(e){try{localStorage.setItem(Y,JSON.stringify(e))}catch{}}function Se(){let e=document.body,t=be(),n=window.matchMedia(le),r=()=>ue(window.innerWidth,window.innerHeight),i=()=>r()!==`pc`,a=[...document.querySelectorAll(`#tabBar button[data-tab]`)],o=()=>{e.dataset.layout=r(),e.dataset.tab=t.tab;for(let e of a){let n=e.dataset.tab===t.tab;e.classList.toggle(`on`,n),e.dataset.tab!==`play`&&e.setAttribute(`aria-current`,n?`page`:`false`)}l()},s=e=>{t.tab=e,xe(t),o()};for(let e of a)e.addEventListener(`click`,()=>{let t=e.dataset.tab;t===`play`?document.getElementById(`btnPlayTest`)?.click():s(t)});let c=[...document.querySelectorAll(`#moreMenu .proxy[data-proxy]`)];function l(){for(let e of c){let t=document.getElementById(e.dataset.proxy??``),n=!!t&&getComputedStyle(t).display===`none`;e.classList.toggle(`show`,n),e.disabled=!n}}for(let e of c)e.addEventListener(`click`,()=>document.getElementById(e.dataset.proxy??``)?.click());let u=document.getElementById(`statusLine`);if(u){u.addEventListener(`click`,()=>u.classList.toggle(`expanded`));let e=()=>{u.title=u.textContent??``};new MutationObserver(e).observe(u,{childList:!0,characterData:!0,subtree:!0}),e()}let d=document.getElementById(`songName`);return d&&(new MutationObserver(()=>{d.title=d.textContent??``}).observe(d,{childList:!0,characterData:!0,subtree:!0}),d.title||=d.textContent??``),n.addEventListener(`change`,o),window.addEventListener(`resize`,o),window.addEventListener(`orientationchange`,o),o(),{mode:r,isTouchLayout:i,setTab:s,prefs:()=>({...t})}}async function Ce(){let e=await N(()=>import(`./state-B0xBe9lh.js`),__vite__mapDeps([3,4]),import.meta.url),t=await N(()=>import(`./actions-BFYwqAM6.js`),__vite__mapDeps([5,6,1,4,3]),import.meta.url);return{S:e.S,on:e.on,emit:e.emit,select:e.select,actions:t}}async function we(e){let t=await Ce(),{S:n,actions:r}=t,i=document.getElementById(`vertical`),a={eraser:()=>!1,phase:()=>`idle`};if(!i)return a;let o=()=>r.A.vertical,s=new Map,c=`idle`,l=!1,u=0,d=0,f=null;a.eraser=()=>l,a.phase=()=>c;let p=document.querySelector(`#tools .seg`),m=document.createElement(`button`);m.type=`button`,m.className=`tool-erase`,m.textContent=`지우개`,m.title=`지우개: 노트를 탭하면 지웁니다 (되돌리기로 복원)`,m.setAttribute(`aria-pressed`,`false`),p?.append(m);let h=e=>{if(l=e,m.classList.toggle(`active`,e),m.setAttribute(`aria-pressed`,String(e)),e)for(let e of document.querySelectorAll(`#tools .tool`))e.classList.remove(`active`);else document.querySelector(`#tools .tool[data-tool="${n.tool}"]`)?.classList.add(`active`)};m.addEventListener(`click`,()=>{l?h(!1):(document.querySelector(`#tools .tool[data-tool="select"]`)?.click(),h(!0))});for(let e of document.querySelectorAll(`#tools .tool`))e.addEventListener(`click`,()=>h(!1));let g=document.getElementById(`selBar`),_=[{id:`tbCopy`,label:`복사`,title:`선택한 노트를 복사 (Ctrl+C)`,run:()=>r.copySelected()},{id:`tbPaste`,label:`붙여넣기`,title:`붙일 위치를 손가락으로 끌어 놓고 떼세요 (Ctrl+V)`,run:()=>r.startPaste(!1)},{id:`tbPasteFlip`,label:`반전 붙여넣기`,title:`좌우를 뒤집어 붙이기 (Shift+Ctrl+V)`,run:()=>r.startPaste(!0)},{id:`tbDelete`,label:`삭제`,title:`선택한 노트 삭제 (Delete)`,run:()=>r.deleteSelected(),danger:!0},{id:`tbUndo`,label:`되돌리기`,title:`되돌리기 (Ctrl+Z)`,run:()=>r.undoAction()},{id:`tbCut`,label:`잘라내기`,title:`선택한 노트를 잘라내기 (Ctrl+X)`,run:()=>r.cutSelected()},{id:`tbAll`,label:`전체 선택`,title:`모든 노트 선택 (Ctrl+A)`,run:()=>r.selectAll()},{id:`tbRedo`,label:`다시하기`,title:`다시하기 (Ctrl+Y)`,run:()=>r.redoAction()}],v=document.createElement(`span`);v.className=`selinfo`;let y=null;if(g){for(let e of _){let t=document.createElement(`button`);t.type=`button`,t.id=e.id,t.textContent=e.label,t.title=e.title,e.danger&&(t.className=`danger`),t.addEventListener(`click`,e.run),g.append(t)}y=document.createElement(`button`),y.type=`button`,y.id=`selCancelPaste`,y.textContent=`붙여넣기 취소`,y.addEventListener(`click`,()=>r.cancelPaste()),g.append(y,v)}let b=()=>{if(!g)return;let t=n.selectedIds.length,r=e()&&(t>0||!!n.clip||!!n.paste);g.hidden=!r,v.textContent=n.paste?`붙일 위치에 손가락을 끌어 놓고 떼세요`:t>0?`${t}개 선택`:`선택 없음`;let i=e=>document.getElementById(e);for(let e of[`tbCopy`,`tbCut`,`tbDelete`]){let r=i(e);r&&(r.disabled=t===0||!!n.paste)}let a=i(`tbPaste`),o=i(`tbPasteFlip`);a&&(a.disabled=!n.clip),o&&(o.disabled=!n.clip),y&&(y.hidden=!n.paste)};for(let e of[`select`,`paste`,`change`])t.on(e,b);window.matchMedia(`(max-width: 1023px)`).addEventListener(`change`,b),b();let x=(e,t)=>({button:0,pointerId:t,offsetX:e.x,offsetY:e.y,shiftKey:!1,pointerType:`mouse`}),S=e=>{let t=i.getBoundingClientRect();return{x:e.clientX-t.left,y:e.clientY-t.top}},C=()=>{window.clearTimeout(u),u=0},w=()=>{let e=o();e&&(e.drag=null,e.stopAutoScroll?.())},T=()=>{let e=[...s.values()];if(e.length<2)return null;let t=e[0],n=e[1];return{a:t,b:n,dist:ge(t,n),midY:(t.y+n.y)/2}},E=e=>{if(e.pointerType!==`touch`)return;e.stopImmediatePropagation(),e.preventDefault();let t=o();if(!t)return;let r=S(e);s.set(e.pointerId,{id:e.pointerId,x0:r.x,y0:r.y,x:r.x,y:r.y});try{i.setPointerCapture(e.pointerId)}catch{}if(s.size>=2){C(),c===`vdrag`&&w();let e=T();e&&(f=me(n.view,e.midY,t.h,e.dist)),c=`pinch`}else c=`pending`,C(),n.tool===`select`&&!l&&!n.paste&&(u=window.setTimeout(()=>{let t=s.get(e.pointerId);if(!t||c!==`pending`||Math.hypot(t.x-t.x0,t.y-t.y0)>J.tapSlopPx)return;navigator.userActivation?.hasBeenActive&&navigator.vibrate?.(15);let n=o();n&&(n.onDown(x({...t,x:t.x0,y:t.y0},e.pointerId)),c=`vdrag`)},J.longPressMs)),n.paste&&t.onMove(x(s.get(e.pointerId),e.pointerId))},D=e=>{if(e.pointerType!==`touch`)return;let r=s.get(e.pointerId);if(!r)return;e.stopImmediatePropagation(),e.preventDefault();let i=S(e);r.x=i.x,r.y=i.y;let a=o();if(a){if(c===`pinch`){let e=T();if(e&&f){let r=he(f,e.dist,e.midY,a.h);n.view.span=r.span,n.view.start=r.start,a.clampView(),t.emit(`view`)}}else if(c===`pending`){if(Math.hypot(r.x-r.x0,r.y-r.y0)<=J.tapSlopPx){n.paste&&a.onMove(x(r,e.pointerId));return}C();let t=_e(n.tool,!!n.paste);t===`paste-preview`?(c=`vdrag`,a.onMove(x(r,e.pointerId))):t===`drag-create`&&!l?(a.onDown(x({...r,x:r.x0,y:r.y0},e.pointerId)),c=`vdrag`,a.onMove(x(r,e.pointerId))):(c=`scroll`,d=n.view.start)}else c===`scroll`?(n.view.start=pe(d,n.view.span,r.y-r.y0,a.h),a.clampView(),t.emit(`view`)):c===`vdrag`&&a.onMove(x(r,e.pointerId))}},O=e=>{if(e.pointerType!==`touch`)return;let i=s.get(e.pointerId);if(!i)return;e.stopImmediatePropagation(),e.preventDefault(),C(),s.delete(e.pointerId);let a=o(),u=e.type===`pointercancel`;if(c===`pinch`){c=s.size===0?`idle`:`after-pinch`,f=null;return}if(c===`after-pinch`){s.size===0&&(c=`idle`);return}let d=c;if(c=s.size===0?`idle`:`after-pinch`,!a||u)d===`vdrag`&&a&&w();else if(d===`vdrag`)n.paste?(a.onMove(x(i,e.pointerId)),a.onDown(x(i,e.pointerId))):a.onUp(x(i,e.pointerId));else if(d===`pending`){if(n.paste){a.onMove(x(i,e.pointerId)),a.onDown(x(i,e.pointerId));return}if(l){let e=a.hitTest(i.x,i.y);e&&(t.select(e.note.id),r.deleteSelected());return}a.onDown(x(i,e.pointerId)),a.onUp(x(i,e.pointerId))}};return i.addEventListener(`pointerdown`,E,{capture:!0}),i.addEventListener(`pointermove`,D,{capture:!0}),i.addEventListener(`pointerup`,O,{capture:!0}),i.addEventListener(`pointercancel`,O,{capture:!0}),i.addEventListener(`touchstart`,e=>e.preventDefault(),{passive:!1}),i.addEventListener(`touchmove`,e=>e.preventDefault(),{passive:!1}),a}var Z={minPx:380,maxViewportRatio:.65,midMinPx:420,pcMinViewport:1024,defaultWide:{min:380,vw:.28,max:520},defaultNarrow:{min:300,vw:.28,max:380},keyStepPx:16};function Te(e,t,n){let r=Z.minPx,i=e*Z.maxViewportRatio,a=e-n-t-Z.midMinPx;return{min:r,max:Math.max(r,Math.min(i,a))}}function Ee(e,t,n,r){if(!Number.isFinite(e))return null;let i=Te(t,n,r);return Math.round(Math.max(i.min,Math.min(i.max,e)))}function De(e,t,n){return t-e-n/2}function Oe(){let e=document.getElementById(`cols`),t=document.getElementById(`paneLeft`),i=document.getElementById(`paneRight`),a=document.getElementById(`editResizer`);if(!e||!t||!i||!a)return null;let o=()=>window.innerWidth>=Z.pcMinViewport,s=()=>{let t=getComputedStyle(e),n=parseFloat(t.columnGap)||12;return{gap:n,chrome:(parseFloat(t.paddingLeft)||12)*2+n*2}},c=e=>Ee(e,window.innerWidth,t.getBoundingClientRect().width,s().chrome),l=null,u=()=>{if(!o())return;let t=e.getBoundingClientRect(),n=i.getBoundingClientRect();a.style.left=`${n.left-t.left-s().gap/2}px`},d=()=>{let t=l===null?null:c(l);o()&&t!==null?e.style.setProperty(`--editor-w`,`${t}px`):e.style.removeProperty(`--editor-w`),u()},f=()=>{try{r({editorWidthPx:l})}catch{}},p=(e,t=!0)=>{l=e===null?null:c(e),d(),t&&f()};try{let e=n().editorWidthPx;typeof e==`number`&&(l=e)}catch{l=null}d();let m=!1,h=0,g=0,_=()=>{if(g=0,!m)return;let e=i.getBoundingClientRect().right;p(De(h,e,s().gap),!1)};a.addEventListener(`pointerdown`,e=>{!o()||e.button>0||(m=!0,h=e.clientX,a.setPointerCapture(e.pointerId),a.classList.add(`dragging`),document.body.style.userSelect=`none`,e.preventDefault())}),a.addEventListener(`pointermove`,e=>{m&&(h=e.clientX,g===0&&(g=requestAnimationFrame(_)))});let v=e=>{if(m){m=!1,g!==0&&cancelAnimationFrame(g),g=0,h=e.clientX,_(),m=!1,a.classList.remove(`dragging`),document.body.style.userSelect=``;try{a.releasePointerCapture(e.pointerId)}catch{}f()}};return a.addEventListener(`pointerup`,v),a.addEventListener(`pointercancel`,v),a.addEventListener(`dblclick`,()=>p(null)),a.addEventListener(`keydown`,e=>{if(!o()||e.key!==`ArrowLeft`&&e.key!==`ArrowRight`)return;let t=l??i.getBoundingClientRect().width;p(t+(e.key===`ArrowLeft`?1:-1)*Z.keyStepPx),e.preventDefault()}),window.addEventListener(`resize`,d),new ResizeObserver(u).observe(e),{current:()=>l,setWidth:p}}async function Q(){let e=Se(),t={layout:e,touch:null,resizer:Oe()};window.__rcwLayout=t,t.touch=await we(()=>e.isTouchLayout())}function $(e){let t=/<body[^>]*>([\s\S]*)<\/body>/i.exec(e);return t?t[1]:e}function ke(){let e=`light`;try{let t=localStorage.getItem(`rcw.settings.v1`),n=t?JSON.parse(t).theme:void 0;(n===`dark`||n===`system`||n===`light`)&&(e=n)}catch{}let t=e===`dark`||e===`system`&&window.matchMedia?.(`(prefers-color-scheme: dark)`).matches;document.documentElement.setAttribute(`data-theme`,t?`dark`:`light`)}async function Ae(){let e=document.getElementById(`storageNote`);if(!e)return;let{api:t}=await N(async()=>{let{api:e}=await import(`./localApi-CteXlorY.js`).then(e=>e.n);return{api:e}},__vite__mapDeps([6,1]),import.meta.url);if(!(await t.storageInfo()).persistent){e.textContent=`이 모드에서는 저장되지 않습니다. 작업 후 [내보내기]로 파일을 저장하세요. (시크릿 모드이거나 브라우저가 저장 기능을 막고 있습니다)`,e.hidden=!1;return}let n=await ne();n&&(e.textContent=n,e.hidden=!1)}function je(){let t=document.getElementById(`btnPlayTest`);t&&t.addEventListener(`click`,async()=>{let t=window.__editor?.(),n=document.getElementById(`statusLine`),r=e=>{n&&(n.textContent=e)};if(!t||!t.S.chart||!t.S.song){r(`먼저 곡을 열어 주세요.`);return}let i=t.S.chart.difficulties[t.S.diffIndex]?.name??`NORMAL`;try{let{api:n}=await N(async()=>{let{api:e}=await import(`./localApi-CteXlorY.js`).then(e=>e.n);return{api:e}},__vite__mapDeps([6,1]),import.meta.url),r=e(t.S.chart,i),a=z(i);await I({unityChart:r,difficulty:i,audioUrl:n.audioUrl(t.S.song),durationMs:t.A.audio.durationMs,...a.bpm===null?{}:{bpm:a.bpm},...a.noteIds===null?{}:{noteIds:a.noteIds},beatOriginMs:a.beatOriginMs})}catch(e){r(e instanceof Error?e.message:`게임 화면 테스트를 시작하지 못했습니다.`)}})}function Me(){oe(e=>{N(()=>import(`./actions-BFYwqAM6.js`).then(t=>t.focusNote(e)),__vite__mapDeps([5,6,1,4,3]),import.meta.url)})}async function Ne(){document.title=`리듬 채보 만들기`,document.body.innerHTML=$(i),await N(()=>import(`./main-BEFbpL4-.js`),__vite__mapDeps([7,8,1,5,6,4,3]),import.meta.url),je(),Me(),Ae(),Q()}async function Pe(){document.title=`채보 테스트`,document.body.innerHTML=$(a),await N(()=>import(`./test_popup-B97BVLVs.js`),__vite__mapDeps([9,6,1,8,4]),import.meta.url)}function Fe(){let e=document.createElement(`link`);e.rel=`icon`,e.href=`data:,`,document.head.appendChild(e)}Fe(),ke(),window.location.hash===`#rcw-test`?Pe():Ne();export{l as _,W as a,te as c,o as d,p as f,s as g,u as h,U as i,b as l,d as m,V as n,z as o,f as p,B as r,se as s,ye as t,m as u,c as v,h as y};