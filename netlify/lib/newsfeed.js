// 아이씨에이치 뉴스 자동 수집 — 공용 로직
//   1) 네이버 증권 종목뉴스 (m.stock.naver.com, 키 불필요)
//   2) 네이버 뉴스 검색 API (NAVER_CLIENT_ID / SECRET 있을 때, 제목·요약에 회사명이 들어간 기사만)
// 수집한 기사는 Netlify Blobs "ich-news" 저장소의 "archive" 키에 중복 없이 누적됩니다.

const CODE = process.env.NEWS_STOCK_CODE || "368600";
const NAME_RE = /아이씨에이치|\bICH\b/i;
const MAX_ITEMS = 3000;

const doFetch = (...a) => (typeof fetch === "function" ? fetch(...a) : require("node-fetch")(...a));
const strip = (s) =>
  String(s || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ").trim();
const kstDate = (d) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
const normTitle = (t) => strip(t).replace(/[\s"'“”‘’\[\]【】()<>…·.,!?~\-–—]/g, "").toLowerCase();

// 네이버 기사 링크에서 언론사/기사번호를 뽑아 중복 판정 키로 씀
function articleKey(link) {
  const m = String(link || "").match(/article\/(\d{3})\/(\d{6,})/) || String(link || "").match(/oid=(\d{3}).*?aid=(\d{6,})/);
  return m ? `${m[1]}-${m[2]}` : "";
}

function getStore(event) {
  const blobs = require("@netlify/blobs");
  if (event && blobs.connectLambda) {
    try { blobs.connectLambda(event); } catch (e) { /* 예약 실행 등 컨텍스트 없는 경우 */ }
  }
  const opts = { name: "ich-news" };
  if (process.env.BLOBS_SITE_ID && process.env.BLOBS_TOKEN) {
    opts.siteID = process.env.BLOBS_SITE_ID;
    opts.token = process.env.BLOBS_TOKEN;
  }
  return blobs.getStore(opts);
}

// 1) 네이버 증권 종목뉴스
async function fromNaverStock(pages = 2) {
  const out = [];
  for (let page = 1; page <= pages; page++) {
    const r = await doFetch(`https://m.stock.naver.com/api/news/stock/${CODE}?pageSize=20&page=${page}`, {
      headers: { "User-Agent": "Mozilla/5.0", Referer: `https://m.stock.naver.com/domestic/stock/${CODE}/news` },
    });
    if (!r.ok) throw new Error("네이버 증권 " + r.status);
    const j = await r.json();
    // 응답: [{ items:[...] }, ...] (묶음 기사) 또는 [{...}, ...]
    const groups = Array.isArray(j) ? j : j.items || j.result || [];
    const items = groups.flatMap((g) => (g && Array.isArray(g.items) ? g.items : [g])).filter(Boolean);
    if (!items.length) break;
    for (const it of items) {
      const oid = it.officeId || it.oid, aid = it.articleId || it.aid;
      if (!oid || !aid || !it.title) continue;
      const dt = String(it.datetime || it.dt || ""); // 202611171530
      const date = /^\d{8}/.test(dt) ? `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}` : kstDate(new Date());
      out.push({
        key: `${oid}-${aid}`,
        date,
        time: /^\d{12}/.test(dt) ? `${dt.slice(8, 10)}:${dt.slice(10, 12)}` : "",
        title: strip(it.title),
        desc: strip(it.body || it.summary || "").slice(0, 300),
        press: strip(it.officeName || it.officeHname || ""),
        link: `https://n.news.naver.com/mnews/article/${oid}/${aid}`,
        source: "naver-stock",
      });
    }
  }
  return out;
}

// 2) 네이버 뉴스 검색 API (보조)
async function fromNaverSearch() {
  const ID = process.env.NAVER_CLIENT_ID, SECRET = process.env.NAVER_CLIENT_SECRET;
  if (!ID || !SECRET) return [];
  const r = await doFetch(`https://openapi.naver.com/v1/search/news.json?${new URLSearchParams({ query: "아이씨에이치", display: 50, sort: "date" })}`, {
    headers: { "X-Naver-Client-Id": ID, "X-Naver-Client-Secret": SECRET },
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.errorMessage || "검색 API " + r.status);
  return (j.items || [])
    .map((it) => {
      const d = new Date(it.pubDate);
      const link = it.link || it.originallink;
      return {
        key: articleKey(link) || articleKey(it.originallink) || "",
        date: isNaN(d) ? kstDate(new Date()) : kstDate(d),
        time: isNaN(d) ? "" : new Date(d.getTime() + 9 * 3600e3).toISOString().slice(11, 16),
        title: strip(it.title),
        desc: strip(it.description).slice(0, 300),
        press: "",
        link,
        origin: it.originallink || "",
        source: "naver-search",
      };
    })
    .filter((n) => NAME_RE.test(n.title) || NAME_RE.test(n.desc));
}

async function readArchive(store) {
  const a = (await store.get("archive", { type: "json" })) || {};
  return { items: a.items || [], hidden: a.hidden || [], lastRun: a.lastRun || "", lastError: a.lastError || "", lastAdded: a.lastAdded || 0 };
}

// 수집 → 기존 아카이브와 합침 → 저장
async function collect(store) {
  const arc = await readArchive(store);
  const errors = [];
  let fresh = [];
  for (const [name, fn] of [["증권", fromNaverStock], ["검색", fromNaverSearch]]) {
    try { fresh = fresh.concat(await fn()); } catch (e) { errors.push(`${name}: ${e.message || e}`); }
  }
  const keys = new Set(), titles = new Set();
  for (const n of arc.items) { if (n.key) keys.add(n.key); titles.add(normTitle(n.title)); }
  for (const h of arc.hidden) (h.startsWith("t:") ? titles.add(h.slice(2)) : keys.add(h));
  const now = new Date().toISOString();
  let added = 0;
  // 오래된 것부터 넣어서 최신이 맨 위에 오도록
  for (const n of fresh.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))) {
    const t = normTitle(n.title);
    if (!t || (n.key && keys.has(n.key)) || titles.has(t)) continue;
    n.id = n.key || "s-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    n.collectedAt = now;
    arc.items.unshift(n);
    if (n.key) keys.add(n.key);
    titles.add(t);
    added++;
  }
  arc.items.sort((a, b) => (b.date + (b.time || "")).localeCompare(a.date + (a.time || "")));
  arc.items = arc.items.slice(0, MAX_ITEMS);
  arc.lastRun = now;
  arc.lastError = errors.join(" / ");
  if (added) arc.lastAdded = added;
  await store.setJSON("archive", arc);
  return { added, errors, total: arc.items.length, lastRun: now };
}

module.exports = { getStore, readArchive, collect };
