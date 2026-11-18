// 공시 아카이브
//   GET /.netlify/functions/disclosures            누적 공시 (마지막 확인이 20분보다 오래됐으면 먼저 수집)
//   GET /.netlify/functions/disclosures?refresh=1  지금 바로 수집
// 정기 수집은 news-collect.js (30분마다)가 기사와 함께 담당합니다.

const { getStore, readArchive, collect, dartKey } = require("../lib/disclosures");

const res = (b, s = 200) => ({ statusCode: s, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, body: JSON.stringify(b) });

exports.handler = async function (event) {
  let store;
  try { store = getStore(event); } catch (e) { return res({ ok: false, error: "Netlify Blobs를 쓸 수 없습니다." }, 500); }
  const q = event.queryStringParameters || {};
  let run = null;
  try {
    const a0 = await readArchive(store);
    if (q.refresh === "1" || !a0.lastRun || Date.now() - new Date(a0.lastRun).getTime() > 20 * 60e3) {
      // 화면 요청은 8.5초 안에 응답 (넘으면 수집은 예약 실행에 맡김)
      run = await Promise.race([collect(store, { allowLookup: false }), new Promise((r) => setTimeout(() => r({ pending: true }), 8500))]);
    }
  } catch (e) { run = { error: String(e.message || e) }; }
  // 방금 수집했으면 저장소를 다시 읽지 않고 그 결과로 응답 (저장 직후 읽기가 늦게 반영될 수 있음)
  const a = run && run._arc ? run._arc : await readArchive(store);
  if (run) delete run._arc;
  return res({ ok: true, lastRun: a.lastRun, lastError: a.lastError, sources: a.sources, dartKey: !!dartKey(), total: a.items.length, run, data: a.items });
};
