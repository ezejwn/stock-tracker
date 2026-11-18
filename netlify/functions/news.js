// 뉴스 검색 — 실시간 뉴스 칸, '왜 움직였나' 패널, 주변 시장 이슈에서 사용
//   /.netlify/functions/news?query=아이씨에이치&display=20
// 1순위: 네이버 뉴스 검색 API (NAVER_CLIENT_ID / NAVER_CLIENT_SECRET — NAVER API HUB 키·예전 개발자센터 키 모두 지원)
// 키가 없거나 인증이 실패하면 키 없이 되는 경로로 대신 응답:
//   - 아이씨에이치 검색어 → 자동 수집 아카이브(네이버 증권 종목뉴스) + 네이버 증권 최신분
//   - 그 밖의 검색어   → Google 뉴스 RSS (한국어)

const { naverNewsSearch, getStore, readArchive, collect } = require("../lib/newsfeed");
const doFetch = (...a) => (typeof fetch === "function" ? fetch(...a) : require("node-fetch")(...a));

const strip = (s) =>
  String(s || "")
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ").trim();
const kst = (d) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10);

const res = (body, status = 200) => ({
  statusCode: status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "public, max-age=0, must-revalidate",
    "Netlify-CDN-Cache-Control": status === 200 ? "public, s-maxage=600, stale-while-revalidate=300" : "no-store",
  },
  body: JSON.stringify(body),
});

async function naverSearch(query, display) {
  const j = await naverNewsSearch(query, display);
  return (j.items || []).map((it) => {
    const d = new Date(it.pubDate);
    return { title: strip(it.title), desc: strip(it.description), link: it.link, origin: it.originallink || it.link, date: isNaN(d) ? "" : kst(d) };
  });
}

// 아이씨에이치: 누적 아카이브에서 (필요하면 먼저 수집)
async function fromArchive(event, query, display) {
  const store = getStore(event);
  let arc = await readArchive(store);
  if (!arc.lastRun || Date.now() - new Date(arc.lastRun).getTime() > 20 * 60e3) {
    try { await collect(store); arc = await readArchive(store); } catch (e) { /* 기존 아카이브로 응답 */ }
  }
  const extra = query.split(/\s+/).filter((w) => w && !/아이씨에이치|ICH/i.test(w)).map((w) => w.toLowerCase());
  return arc.items
    .filter((n) => !extra.length || extra.every((w) => (n.title + " " + (n.desc || "")).toLowerCase().includes(w)))
    .slice(0, display)
    .map((n) => ({ title: n.title, desc: n.desc || "", link: n.link, origin: n.link, date: n.date, press: n.press || "" }));
}

// 그 밖의 검색어: Google 뉴스 RSS
async function fromGoogle(query, display) {
  const r = await doFetch(`https://news.google.com/rss/search?${new URLSearchParams({ q: query + " when:30d", hl: "ko", gl: "KR", ceid: "KR:ko" })}`, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!r.ok) throw new Error("Google 뉴스 " + r.status);
  const xml = await r.text();
  const items = xml.split(/<item>/).slice(1).map((chunk) => {
    const tag = (t) => { const m = chunk.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)); return m ? strip(m[1]) : ""; };
    const d = new Date(tag("pubDate"));
    const source = tag("source");
    let title = tag("title");
    if (source && title.endsWith(" - " + source)) title = title.slice(0, -(source.length + 3));
    const link = tag("link");
    return { title, desc: source, link, origin: link, date: isNaN(d) ? "" : kst(d), press: source };
  });
  return items.filter((n) => n.title && n.link).sort((a, b) => b.date.localeCompare(a.date)).slice(0, display);
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const query = String(q.query || "아이씨에이치").slice(0, 100);
  const display = Math.min(Math.max(Number(q.display) || 20, 1), 100);
  try {
    return res({ ok: true, query, source: "naver-search", data: await naverSearch(query, display) });
  } catch (e1) {
    const isICH = /아이씨에이치|ICH/i.test(query);
    try {
      const data = isICH ? await fromArchive(event, query, display) : await fromGoogle(query, display);
      return res({ ok: true, query, source: isICH ? "naver-stock-archive" : "google-news", fallback: true, note: "네이버 검색 키 오류로 대체 경로 사용: " + (e1.message || e1), data });
    } catch (e2) {
      return res({ ok: false, error: `검색 API: ${e1.message || e1} / 대체 경로: ${e2.message || e2}` }, 502);
    }
  }
};
