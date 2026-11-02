// 누적 기록 — 사이트에서 추가한 기록을 Netlify Blobs에 저장
//   GET    /.netlify/functions/notes          공개 기록 (x-admin-token 맞으면 비공개 포함)
//   POST   /.netlify/functions/notes          추가 (x-admin-token 필요)
//   DELETE /.netlify/functions/notes?id=...   삭제 (x-admin-token 필요)
// 환경변수: NOTE_ADMIN_TOKEN (아무 긴 문자열. 없으면 쓰기 꺼짐)

const TOKEN = process.env.NOTE_ADMIN_TOKEN || "";
const TYPES = ["미팅", "IR", "공시", "기사", "메모"];
const SRCS = ["dis", "co", "ext", "hear", "est"];

const res = (b, s = 200) => ({
  statusCode: s,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  body: JSON.stringify(b),
});
const clean = (v, n) => String(v == null ? "" : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").slice(0, n);
const header = (event, k) => {
  const h = event.headers || {};
  return h[k] || h[k.toLowerCase()] || "";
};

exports.handler = async function (event) {
  let store;
  try {
    const blobs = require("@netlify/blobs");
    if (blobs.connectLambda) blobs.connectLambda(event);
    store = blobs.getStore("ich-notes");
  } catch (e) {
    return res({ ok: false, error: "Netlify Blobs를 쓸 수 없습니다 (Netlify에 배포된 환경인지, package.json 의존성이 설치됐는지 확인)." }, 500);
  }
  const all = (await store.get("entries", { type: "json" })) || [];
  const admin = !!TOKEN && header(event, "x-admin-token") === TOKEN;

  if (event.httpMethod === "GET") {
    return res({ ok: true, admin, writable: !!TOKEN, data: admin ? all : all.filter((e) => e.visibility !== "private") });
  }
  if (!TOKEN) return res({ ok: false, error: "NOTE_ADMIN_TOKEN 환경변수가 없어 쓰기가 꺼져 있습니다." }, 403);
  if (!admin) return res({ ok: false, error: "관리 토큰이 맞지 않습니다." }, 401);

  if (event.httpMethod === "POST") {
    let b;
    try { b = JSON.parse(event.body || "{}"); } catch (e) { return res({ ok: false, error: "JSON 형식 오류" }, 400); }
    const date = clean(b.date, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res({ ok: false, error: "날짜는 YYYY-MM-DD" }, 400);
    const title = clean(b.title, 200).trim();
    if (!title) return res({ ok: false, error: "제목이 필요합니다." }, 400);
    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      date,
      type: TYPES.includes(b.type) ? b.type : "메모",
      src: SRCS.includes(b.src) ? b.src : "hear",
      title,
      body: clean(b.body, 8000).split("\n").map((s) => s.trim()).filter(Boolean),
      link: /^https?:\/\//.test(b.link || "") ? clean(b.link, 500) : "",
      visibility: b.visibility === "private" ? "private" : "public",
      createdAt: new Date().toISOString(),
      fromWeb: true,
    };
    all.unshift(entry);
    await store.setJSON("entries", all);
    return res({ ok: true, entry });
  }

  if (event.httpMethod === "DELETE") {
    const id = (event.queryStringParameters || {}).id;
    const next = all.filter((e) => e.id !== id);
    if (next.length === all.length) return res({ ok: false, error: "해당 기록이 없습니다." }, 404);
    await store.setJSON("entries", next);
    return res({ ok: true });
  }
  return res({ ok: false, error: "허용되지 않는 메서드" }, 405);
};
