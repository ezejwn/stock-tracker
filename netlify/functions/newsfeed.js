// 자동 수집 기사 아카이브
//   GET  /.netlify/functions/newsfeed            누적 기사 목록 (마지막 수집이 20분보다 오래됐으면 먼저 수집)
//   GET  /.netlify/functions/newsfeed?refresh=1  지금 바로 수집
//   POST /.netlify/functions/newsfeed?hide=ID    관련 없는 기사 숨기기 (x-admin-token 필요, 다시 수집되지 않음)
// 정기 수집은 news-collect.js (30분마다)가 담당합니다.

const { getStore, readArchive, collect, diagnoseKeys } = require("../lib/newsfeed");
const TOKEN = process.env.NOTE_ADMIN_TOKEN || "";
const STALE_MS = 20 * 60e3;

const res = (b, s = 200) => ({
  statusCode: s,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  body: JSON.stringify(b),
});
const header = (event, k) => { const h = event.headers || {}; return h[k] || h[k.toLowerCase()] || ""; };

exports.handler = async function (event) {
  if ((event.queryStringParameters || {}).diag === "1") return res({ ok: true, 점검: await diagnoseKeys() });
  let store;
  try { store = getStore(event); } catch (e) { return res({ ok: false, error: "Netlify Blobs를 쓸 수 없습니다." }, 500); }
  const q = event.queryStringParameters || {};

  if (event.httpMethod === "POST") {
    if (!TOKEN || header(event, "x-admin-token") !== TOKEN) return res({ ok: false, error: "관리 토큰이 맞지 않습니다." }, 401);
    const id = String(q.hide || "");
    const arc = await readArchive(store);
    const it = arc.items.find((n) => n.id === id);
    if (!it) return res({ ok: false, error: "해당 기사가 없습니다." }, 404);
    arc.items = arc.items.filter((n) => n.id !== id);
    arc.hidden.push(it.key || "t:" + String(it.title).replace(/[\s"'“”‘’\[\]【】()<>…·.,!?~\-–—]/g, "").toLowerCase());
    await store.setJSON("archive", arc);
    return res({ ok: true });
  }

  let run = null;
  try {
    const arc0 = await readArchive(store);
    const stale = !arc0.lastRun || Date.now() - new Date(arc0.lastRun).getTime() > STALE_MS;
    if (q.refresh === "1" || stale) run = await collect(store);
  } catch (e) {
    run = { error: String(e.message || e) };
  }
  const arc = run && run._arc ? run._arc : await readArchive(store);
  if (run) delete run._arc;
  return res({ ok: true, lastRun: arc.lastRun, lastError: arc.lastError, total: arc.items.length, run, data: arc.items });
};
