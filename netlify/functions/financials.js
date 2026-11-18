// DART 재무제표 자동 반영
//   GET /.netlify/functions/financials            정리된 분기·연간·재무상태 (빠진 보고서가 있으면 최신 1건을 먼저 가져옴)
//   GET /.netlify/functions/financials?refresh=1  확인 대기 시간 무시하고 다시 확인
// 정기 확인은 news-collect.js (30분마다)가 담당합니다.

const F = require("../lib/financials");
const res = (b, s = 200) => ({ statusCode: s, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, body: JSON.stringify(b) });

exports.handler = async function (event) {
  if (!F.key()) return res({ ok: false, error: "DART_API_KEY가 설정되지 않았습니다." });
  let store;
  try { store = F.getStore(event); } catch (e) { return res({ ok: false, error: "Netlify Blobs를 쓸 수 없습니다." }, 500); }
  const q = event.queryStringParameters || {};
  let fin = null, run = null;
  try {
    run = await Promise.race([F.collect(store, { maxCalls: 1, deadline: Date.now() + 1000, force: q.refresh === "1", timeout: 7500, event }), new Promise((r) => setTimeout(() => r({ pending: true }), 9000))]);
    if (run && run._fin) { fin = run._fin; delete run._fin; }
  } catch (e) { run = { error: String(e.message || e) }; }
  if (!fin) fin = await F.read(store);
  return res({ ok: true, lastRun: fin.lastRun, lastError: fin.lastError, run, ...F.shape(fin) });
};
