/**
 * 분석 모드 측정 도구(개발용, 01b): 열려 있는 크롬의 modes_check 페이지 파일 입력에 곡을 '경로로 지정'해(복사 없음)
 * 모드별 분석 결과를 JSON 파일로 저장한다.
 * 사용: node tools/browser_modes_check.ts 9333 "곡 파일 전체 경로" "저장할 json 경로"
 */
import { writeFileSync } from 'node:fs';

const port = process.argv[2] ?? '9333';
const filePath = process.argv[3]!;
const saveTo = process.argv[4]!;
const tabs = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as { type: string; url: string; webSocketDebuggerUrl: string }[];
const tab = tabs.find((t) => t.type === 'page' && t.url.includes('modes_check'));
if (!tab) throw new Error('modes_check 탭을 찾지 못했습니다.');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map<number, (v: unknown) => void>();
ws.onmessage = (ev) => {
  const msg = JSON.parse(String(ev.data)) as { id?: number; result?: unknown };
  if (msg.id !== undefined) pending.get(msg.id)?.(msg.result);
};
await new Promise<void>((ok) => {
  ws.onopen = () => ok();
});
const call = <T>(method: string, params: Record<string, unknown> = {}): Promise<T> =>
  new Promise((ok) => {
    const id = ++seq;
    pending.set(id, ok as (v: unknown) => void);
    ws.send(JSON.stringify({ id, method, params }));
  });
await call('Page.reload');
await new Promise((ok) => setTimeout(ok, 2500)); // 앞 측정의 남은 작업을 없애려고 새로 불러온다
await call('Runtime.evaluate', { expression: "document.title='측정 중'" });
const doc = await call<{ root: { nodeId: number } }>('DOM.getDocument');
const q = await call<{ nodeId: number }>('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#f' });
await call('DOM.setFileInputFiles', { nodeId: q.nodeId, files: [filePath] });
for (let i = 0; i < 600; i++) {
  const t = await call<{ result: { value?: string } }>('Runtime.evaluate', { expression: 'document.title', returnByValue: true });
  if (t.result.value === 'DONE' || t.result.value === 'FAILED') {
    const o = await call<{ result: { value?: string } }>('Runtime.evaluate', { expression: "document.getElementById('out').textContent", returnByValue: true });
    writeFileSync(saveTo, o.result.value ?? '', 'utf8');
    console.log(t.result.value, saveTo);
    ws.close();
    process.exit(t.result.value === 'DONE' ? 0 : 1);
  }
  await new Promise((ok) => setTimeout(ok, 1000));
}
console.log('시간 초과');
process.exit(2);
