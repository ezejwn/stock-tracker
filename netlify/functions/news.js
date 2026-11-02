// 네이버 뉴스 검색 — 기존 news.js를 확장
//   /.netlify/functions/news?query=아이씨에이치&display=20
// 환경변수: NAVER_CLIENT_ID, NAVER_CLIENT_SECRET

const doFetch = (...a) => (typeof fetch === "function" ? fetch(...a) : require("node-fetch")(...a));

const strip = (s) =>
  String(s || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

const res = (body, status = 200) => ({
  statusCode: status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "public, max-age=0, must-revalidate",
    "Netlify-CDN-Cache-Control": status === 200 ? "public, s-maxage=600, stale-while-revalidate=300" : "no-store",
  },
  body: JSON.stringify(body),
});

exports.handler = async function (event) {
  const ID = process.env.NAVER_CLIENT_ID, SECRET = process.env.NAVER_CLIENT_SECRET;
  if (!ID || !SECRET) return res({ ok: false, error: "네이버 API 키(NAVER_CLIENT_ID / NAVER_CLIENT_SECRET)가 설정되지 않았습니다." }, 500);
  const q = event.queryStringParameters || {};
  const query = String(q.query || "아이씨에이치").slice(0, 100);
  const display = Math.min(Math.max(Number(q.display) || 20, 1), 100);
  try {
    const r = await doFetch(`https://openapi.naver.com/v1/search/news.json?${new URLSearchParams({ query, display, sort: "date" })}`, {
      headers: { "X-Naver-Client-Id": ID, "X-Naver-Client-Secret": SECRET },
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.errorMessage || r.status);
    const data = (j.items || []).map((it) => {
      const d = new Date(it.pubDate);
      return {
        title: strip(it.title),
        desc: strip(it.description),
        link: it.link,
        origin: it.originallink || it.link,
        date: isNaN(d) ? "" : new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10),
      };
    });
    return res({ ok: true, query, data });
  } catch (e) {
    return res({ ok: false, error: String(e.message || e) }, 502);
  }
};
