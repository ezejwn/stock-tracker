// 아이씨에이치 공시 자동 수집 — 공용 로직
//   1) OpenDART 공시검색 (DART_API_KEY 있을 때, 공식·전체 이력)
//   2) 네이버 증권 '공시' 탭 (키 불필요, 최근분)
// Netlify Blobs "ich-dart" 저장소의 "archive" 키에 중복 없이 누적합니다.

const zlib = require("zlib");
const STOCK = process.env.NEWS_STOCK_CODE || "368600";
const LISTED = "20220701"; // 상장(2022.07) 무렵부터 이력 수집

const doFetch = (...a) => (typeof fetch === "function" ? fetch(...a) : require("node-fetch")(...a));
const strip = (s) => String(s || "").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
const ymd = (d) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, "");
const dash = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
const normTitle = (t) => strip(t).replace(/\[[^\]]*\]|\([^)]*\)|[\s·.,"'“”‘’\-–—]/g, "").toLowerCase();
const dartKey = () => String(process.env.DART_API_KEY || "").trim().replace(/^["']|["']$/g, "");

function getStore(event) {
  const blobs = require("@netlify/blobs");
  if (event && blobs.connectLambda) { try { blobs.connectLambda(event); } catch (e) { /* 예약 실행 */ } }
  const opts = { name: "ich-dart" };
  if (process.env.BLOBS_SITE_ID && process.env.BLOBS_TOKEN) { opts.siteID = process.env.BLOBS_SITE_ID; opts.token = process.env.BLOBS_TOKEN; }
  return blobs.getStore(opts);
}

async function readArchive(store) {
  const a = (await store.get("archive", { type: "json" })) || {};
  return { items: a.items || [], lastRun: a.lastRun || "", lastError: a.lastError || "", corpCode: a.corpCode || "", backfilled: !!a.backfilled, sources: a.sources || [] };
}

// ZIP(단일 파일)에서 첫 항목을 풀어 문자열로
function unzipFirst(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("ZIP 형식 아님");
  const cd = buf.readUInt32LE(eocd + 16);
  const method = buf.readUInt16LE(cd + 10), csize = buf.readUInt32LE(cd + 20), lho = buf.readUInt32LE(cd + 42);
  const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
  const data = buf.subarray(start, start + csize);
  return (method === 8 ? zlib.inflateRawSync(data) : data).toString("utf8");
}

// 종목코드 → DART 고유번호(corp_code)
async function corpCode(arc) {
  if (process.env.DART_CORP_CODE) return process.env.DART_CORP_CODE.trim();
  if (arc.corpCode) return arc.corpCode;
  const r = await doFetch(`https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${encodeURIComponent(dartKey())}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf[0] !== 0x50) { const t = buf.toString("utf8"); throw new Error("DART 고유번호 조회 실패: " + (strip((t.match(/<message>([^<]*)/) || [])[1]) || r.status)); }
  const xml = unzipFirst(buf);
  const re = new RegExp(`<corp_code>(\\d{8})</corp_code>\\s*<corp_name>[^<]*</corp_name>\\s*(?:<corp_eng_name>[^<]*</corp_eng_name>\\s*)?<stock_code>${STOCK}</stock_code>`);
  const m = xml.match(re);
  if (!m) throw new Error("DART 고유번호에서 종목코드 " + STOCK + "를 찾지 못함");
  return m[1];
}

// 1) OpenDART
async function fromDart(arc) {
  const key = dartKey();
  if (!key) return null;
  const code = await corpCode(arc);
  arc.corpCode = code;
  const end = ymd(new Date());
  const bgn = arc.backfilled ? ymd(new Date(Date.now() - 60 * 86400e3)) : LISTED;
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const r = await doFetch(`https://opendart.fss.or.kr/api/list.json?${new URLSearchParams({ crtfc_key: key, corp_code: code, bgn_de: bgn, end_de: end, page_no: page, page_count: 100 })}`);
    const j = await r.json();
    if (j.status === "013") break; // 조회된 데이터 없음
    if (j.status !== "000") throw new Error(`DART ${j.status} ${j.message || ""}`.trim());
    for (const it of j.list || []) {
      out.push({
        id: "d-" + it.rcept_no, rcept: it.rcept_no, date: dash(it.rcept_dt), title: strip(it.report_nm), filer: strip(it.flr_nm), rm: it.rm || "",
        link: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${it.rcept_no}`, source: "dart",
      });
    }
    if (page >= Number(j.total_page || 1)) break;
  }
  arc.backfilled = true;
  return out;
}

// 2) 네이버 증권 공시 탭 (EUC-KR HTML)
async function fromNaver(pages = 2) {
  const out = [];
  for (let page = 1; page <= pages; page++) {
    const r = await doFetch(`https://finance.naver.com/item/news_notice.naver?code=${STOCK}&page=${page}`, {
      headers: { "User-Agent": "Mozilla/5.0", Referer: `https://finance.naver.com/item/news.naver?code=${STOCK}` },
    });
    if (!r.ok) throw new Error("네이버 공시 " + r.status);
    const html = new TextDecoder("euc-kr").decode(await r.arrayBuffer());
    const rows = html.split(/<tr[\s>]/).slice(1);
    let n = 0;
    for (const row of rows) {
      const a = row.match(/<a[^>]+href="([^"]*news_notice_read[^"]*)"[^>]*>([\s\S]*?)<\/a>/);
      const d = row.match(/(\d{4})\.(\d{2})\.(\d{2})(?:\s+(\d{2}:\d{2}))?/);
      if (!a || !d) continue;
      const no = (a[1].match(/no=(\d+)/) || [])[1] || "";
      const info = strip((row.match(/class="info"[^>]*>([\s\S]*?)<\/td>/) || [])[1] || "");
      out.push({
        id: "n-" + (no || normTitle(a[2]) + d[0]), date: `${d[1]}-${d[2]}-${d[3]}`, time: d[4] || "", title: strip(a[2]), filer: info,
        link: "https://finance.naver.com" + a[1].replace(/&amp;/g, "&").replace(/^https?:\/\/finance\.naver\.com/, ""), source: "naver",
      });
      n++;
    }
    if (!n) break;
  }
  return out;
}

async function collect(store) {
  const arc = await readArchive(store);
  const firstRun = !arc.items.length;
  const dartBackfill = !arc.backfilled && !!dartKey();
  const errors = [], used = [];
  let fresh = [];
  try { const d = await fromDart(arc); if (d) { fresh = fresh.concat(d); used.push("DART"); } } catch (e) { errors.push("DART: " + (e.message || e)); }
  try { fresh = fresh.concat(await fromNaver()); used.push("네이버 증권"); } catch (e) { errors.push("네이버: " + (e.message || e)); }

  const ids = new Set(arc.items.map((x) => x.id));
  const keyOf = (x) => x.date + "|" + normTitle(x.title);
  const byKey = new Map(arc.items.map((x) => [keyOf(x), x]));
  const now = new Date().toISOString();
  let added = 0;
  for (const x of fresh) {
    if (ids.has(x.id)) continue;
    const same = byKey.get(keyOf(x));
    if (same) {
      // 같은 공시를 다른 경로로 받은 경우: DART 원문 링크를 우선
      if (x.source === "dart" && same.source !== "dart") Object.assign(same, { id: x.id, rcept: x.rcept, link: x.link, source: "dart", naverLink: same.link });
      ids.add(x.id);
      continue;
    }
    // 처음 몰아 받은 이력(첫 실행, DART 키를 넣은 직후의 과거분)은 NEW 표시 안 함
    x.collectedAt = firstRun || (dartBackfill && x.source === "dart" && x.date < ymd(new Date(Date.now() - 2 * 86400e3)).replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3")) ? "" : now;
    arc.items.push(x); ids.add(x.id); byKey.set(keyOf(x), x); added++;
  }
  arc.items.sort((a, b) => (b.date + (b.time || "") + (b.rcept || "")).localeCompare(a.date + (a.time || "") + (a.rcept || "")));
  arc.items = arc.items.slice(0, 3000);
  arc.lastRun = now; arc.lastError = errors.join(" / "); arc.sources = used;
  await store.setJSON("archive", arc);
  return { added, errors, total: arc.items.length, sources: used };
}

module.exports = { getStore, readArchive, collect, dartKey };
