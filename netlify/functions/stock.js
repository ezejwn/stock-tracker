// 한국투자증권(KIS) 시세 — 기존 stock.js를 확장
//   /.netlify/functions/stock?code=368600                 → 예전과 같은 현재가 원본(output) 반환
//   /.netlify/functions/stock?code=368600&type=price      → 정리된 현재가 {ok, data}
//   /.netlify/functions/stock?code=368600&type=daily      → 일봉(수정주가)
//   /.netlify/functions/stock?code=368600&type=investor   → 투자자별 순매수
//   /.netlify/functions/stock?type=index&codes=0001,1001   → 코스피·코스닥 지수
//   /.netlify/functions/stock?type=indexdaily&icode=1001   → 지수 일봉
//   /.netlify/functions/stock?type=multi&codes=005930,...  → 여러 종목 현재가
//   /.netlify/functions/stock?type=flow                   → 수급 체크(체결강도·VI·업종·분봉 급변·투자자)
// 환경변수: KIS_APPKEY, KIS_APPSECRET

const BASE = process.env.KIS_BASE_URL || "https://openapi.koreainvestment.com:9443";
const KEY = process.env.KIS_APPKEY || process.env.KIS_APP_KEY;
const SECRET = process.env.KIS_APPSECRET || process.env.KIS_APP_SECRET;
const doFetch = (...a) => (typeof fetch === "function" ? fetch(...a) : require("node-fetch")(...a));

// 토큰은 24시간 유효, 발급은 1분에 1번 제한 → 저장해 두고 재사용
let mem = { token: null, exp: 0 };

function tokenStore(event) {
  try {
    const blobs = require("@netlify/blobs");
    if (blobs.connectLambda) blobs.connectLambda(event);
    return blobs.getStore("kis-token");
  } catch (e) {
    return null; // 저장소를 못 쓰면 메모리 캐시만 사용
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 앱키별로 토큰을 따로 저장 → 앱키를 재발급·교체하면 예전 토큰을 자동으로 버림
const KEYID = KEY ? require("crypto").createHash("sha256").update(String(KEY)).digest("hex").slice(0, 12) : "none";
const TOKEN_KEY = "token-" + KEYID, LOCK_KEY = "lock-" + KEYID;
const fresh = (c) => c && c.token && c.exp - Date.now() > 5 * 60e3;

// 동시에 여러 요청이 와도 토큰은 한 번만 발급 (KIS: 발급 1분 1회 제한)
async function getToken(event, force) {
  if (!force && fresh(mem)) return mem.token;
  const store = tokenStore(event);
  const read = async () => { try { return store ? await store.get(TOKEN_KEY, { type: "json" }) : null; } catch (e) { return null; } };

  let c = force ? null : await read();
  if (fresh(c)) { mem = c; return c.token; }

  // 다른 요청이 발급 중이면(잠금 20초) 그 결과를 기다림
  if (store) {
    let lock = null;
    try { lock = await store.get(LOCK_KEY, { type: "json" }); } catch (e) {}
    if (lock && Date.now() - lock.at < 20e3) {
      for (let i = 0; i < 12; i++) { await sleep(500); c = await read(); if (fresh(c)) { mem = c; return c.token; } }
    }
    try { await store.setJSON(LOCK_KEY, { at: Date.now() }); } catch (e) {}
  }

  const issue = async () => {
    const r = await doFetch(`${BASE}/oauth2/tokenP`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grant_type: "client_credentials", appkey: KEY, appsecret: SECRET }),
    });
    return r.json();
  };
  let j = await issue();
  if (!j.access_token) {
    const msg = j.error_description || j.msg1 || JSON.stringify(j);
    // 1분 제한에 걸렸으면 다른 요청이 저장한 토큰이 있는지 잠시 확인
    if (/EGW00133|1분/.test(msg + (j.error_code || ""))) {
      for (let i = 0; i < 10; i++) { await sleep(600); c = await read(); if (fresh(c)) { mem = c; return c.token; } }
    }
    throw new Error("토큰 발급 실패: " + msg + (/1분|EGW00133/.test(msg + (j.error_code || "")) ? " (1분 뒤 새로고침)" : ""));
  }
  mem = { token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 86400) * 1000 };
  if (store) { try { await store.setJSON(TOKEN_KEY, mem); await store.delete(LOCK_KEY); } catch (e) {} }
  return mem.token;
}

async function kis(event, path, trId, params, retried) {
  const token = await getToken(event, retried === "token");
  const r = await doFetch(`${BASE}${path}?${new URLSearchParams(params)}`, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      authorization: `Bearer ${token}`,
      appkey: KEY,
      appsecret: SECRET,
      tr_id: trId,
      custtype: "P",
    },
  });
  const j = await r.json().catch(() => ({ rt_cd: "1", msg1: "HTTP " + r.status }));
  if (j.rt_cd && j.rt_cd !== "0") {
    const m = `${j.msg_cd || ""} ${j.msg1 || ""}`;
    // 토큰 무효·만료(EGW00121/00123) → 저장된 토큰 버리고 새로 받아 한 번 재시도
    if (!retried && /EGW0012[123]|token|토큰/i.test(m)) {
      mem = { token: null, exp: 0 };
      try { const st = tokenStore(event); if (st) await st.delete(TOKEN_KEY); } catch (e) {}
      return kis(event, path, trId, params, "token");
    }
    // 초당 호출 제한(EGW00201) → 잠깐 쉬고 한 번 재시도
    if (!retried && /EGW00201|초당/.test(m)) { await sleep(400); return kis(event, path, trId, params, "rate"); }
    throw new Error(`${trId}: ${(j.msg1 || j.msg_cd || "").trim()}`);
  }
  return j;
}

const num = (v) => (v === undefined || v === null || v === "" ? null : Number(v));
const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");

async function price(event, code) {
  const j = await kis(event, "/uapi/domestic-stock/v1/quotations/inquire-price", "FHKST01010100", {
    FID_COND_MRKT_DIV_CODE: "J", FID_INPUT_ISCD: code,
  });
  return j.output || {};
}
const tidyPrice = (o) => ({
  price: num(o.stck_prpr), change: num(o.prdy_vrss), changeRate: num(o.prdy_ctrt), sign: o.prdy_vrss_sign,
  open: num(o.stck_oprc), high: num(o.stck_hgpr), low: num(o.stck_lwpr),
  volume: num(o.acml_vol), tradeValue: num(o.acml_tr_pbmn), marketCapEok: num(o.hts_avls),
  per: num(o.per), pbr: num(o.pbr), eps: num(o.eps), bps: num(o.bps),
  w52High: num(o.w52_hgpr), w52Low: num(o.w52_lwpr), shares: num(o.lstn_stcn), foreignRatio: num(o.hts_frgn_ehrt),
  sector: o.bstp_kor_isnm || null, market: o.rprs_mrkt_kor_name || null,
  vi: o.vi_cls_code || null, // VI 적용 구분 (Y/N)
});

async function dailyChunk(event, code, from, to) {
  const j = await kis(event, "/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice", "FHKST03010100", {
    FID_COND_MRKT_DIV_CODE: "J", FID_INPUT_ISCD: code, FID_INPUT_DATE_1: from, FID_INPUT_DATE_2: to,
    FID_PERIOD_DIV_CODE: "D", FID_ORG_ADJ_PRC: "0",
  });
  return (j.output2 || []).filter((r) => r.stck_bsop_date).map((r) => ({
    d: r.stck_bsop_date, o: num(r.stck_oprc), h: num(r.stck_hgpr), l: num(r.stck_lwpr), c: num(r.stck_clpr), v: num(r.acml_vol),
  }));
}
async function daily(event, code, days) {
  const end = new Date(Date.now() + 9 * 3600e3), start = new Date(end.getTime() - days * 86400e3);
  const rows = await dailyChunk(event, code, ymd(start), ymd(end));
  if (rows.length >= 100) {
    const o = rows[rows.length - 1].d;
    const prevEnd = new Date(Date.UTC(+o.slice(0, 4), +o.slice(4, 6) - 1, +o.slice(6)) - 86400e3);
    if (prevEnd > start) rows.push(...(await dailyChunk(event, code, ymd(start), ymd(prevEnd))));
  }
  const seen = new Set();
  return rows.filter((r) => (seen.has(r.d) ? false : seen.add(r.d))).sort((a, b) => a.d.localeCompare(b.d));
}
async function investor(event, code) {
  const j = await kis(event, "/uapi/domestic-stock/v1/quotations/inquire-investor", "FHKST01010900", {
    FID_COND_MRKT_DIV_CODE: "J", FID_INPUT_ISCD: code,
  });
  return (j.output || []).slice(0, 20).map((r) => ({
    d: r.stck_bsop_date, c: num(r.stck_clpr), indiv: num(r.prsn_ntby_qty), foreign: num(r.frgn_ntby_qty), inst: num(r.orgn_ntby_qty),
  }));
}

// 업종·시장 지수 (0001 코스피, 1001 코스닥, 2001 코스피200)
async function index(event, icode) {
  const j = await kis(event, "/uapi/domestic-stock/v1/quotations/inquire-index-price", "FHPUP02100000", {
    FID_COND_MRKT_DIV_CODE: "U", FID_INPUT_ISCD: icode,
  });
  const o = j.output || {};
  return { code: icode, value: num(o.bstp_nmix_prpr), change: num(o.bstp_nmix_prdy_vrss), changeRate: num(o.bstp_nmix_prdy_ctrt) };
}
async function indexDaily(event, icode, days) {
  const end = new Date(Date.now() + 9 * 3600e3), start = new Date(end.getTime() - days * 86400e3);
  const j = await kis(event, "/uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice", "FHKUP03500100", {
    FID_COND_MRKT_DIV_CODE: "U", FID_INPUT_ISCD: icode, FID_INPUT_DATE_1: ymd(start), FID_INPUT_DATE_2: ymd(end), FID_PERIOD_DIV_CODE: "D",
  });
  return (j.output2 || []).filter((r) => r.stck_bsop_date).map((r) => ({ d: r.stck_bsop_date, c: num(r.bstp_nmix_prpr) }))
    .sort((a, b) => a.d.localeCompare(b.d));
}
// 여러 종목 현재가를 한 번에 (초당 호출 제한 고려해 순차 호출)
async function multi(event, codes) {
  const out = [];
  for (const c of codes) {
    try { out.push({ code: c, ok: true, ...tidyPrice(await price(event, c)) }); }
    catch (e) { out.push({ code: c, ok: false, error: String(e.message || e) }); }
    await sleep(70);
  }
  return out;
}

/* ===== 수급 체크 (장중 실시간) : 체결강도 · VI · 업종지수 · 분봉 급변 구간 · 투자자 ===== */
const kstNow = () => new Date(Date.now() + 9 * 3600e3);
const hms = (d) => d.toISOString().slice(11, 19).replace(/:/g, "");
const normName = (s) => String(s || "").replace(/[^가-힣A-Za-z0-9]/g, "");

async function ccnl(event, code) {
  const j = await kis(event, "/uapi/domestic-stock/v1/quotations/inquire-ccnl", "FHKST01010300", {
    FID_COND_MRKT_DIV_CODE: "J", FID_INPUT_ISCD: code,
  });
  const r = (j.output || [])[0];
  if (!r) return null;
  return { strength: num(r.tday_rltv), time: r.stck_cntg_hour || null, price: num(r.stck_prpr) };
}
async function viStatus(event, code, date) {
  const j = await kis(event, "/uapi/domestic-stock/v1/quotations/inquire-vi-status", "FHPST01390000", {
    FID_DIV_CLS_CODE: "0", FID_COND_SCR_DIV_CODE: "20139", FID_MRKT_CLS_CODE: "0", FID_INPUT_ISCD: code,
    FID_RANK_SORT_CLS_CODE: "0", FID_INPUT_DATE_1: date, FID_TRGT_CLS_CODE: "", FID_TRGT_EXLS_CLS_CODE: "",
  });
  const KIND = { 1: "정적", 2: "동적", 3: "정적·동적" };
  return (j.output || []).filter((r) => !r.mksc_shrn_iscd || r.mksc_shrn_iscd === code).map((r) => ({
    date: r.bsop_date || date, on: r.cntg_vi_hour || null, off: r.vi_cncl_hour || null,
    kind: KIND[String(r.vi_kind_code)] || r.vi_kind_code || null, cls: r.vi_cls_code || null,
    price: num(r.vi_prc), base: num(r.vi_stnd_prc), dev: num(r.vi_dprt), count: num(r.vi_count),
  })).sort((a, b) => String(a.on).localeCompare(String(b.on)));
}
// 시장(코스닥/코스피) 업종지수 전체 → 종목 업종명과 같은 것 찾기
async function sectorIndex(event, sectorName, market) {
  const kosdaq = !/코스피|KOSPI|유가/i.test(market || "");
  const j = await kis(event, "/uapi/domestic-stock/v1/quotations/inquire-index-category-price", "FHPUP02140000", {
    FID_COND_MRKT_DIV_CODE: "U", FID_INPUT_ISCD: kosdaq ? "1001" : "0001", FID_COND_SCR_DIV_CODE: "20214",
    FID_MRKT_CLS_CODE: kosdaq ? "Q" : "K", FID_BLNG_CLS_CODE: "0",
  });
  const list = (j.output2 || []).map((r) => ({ code: r.bstp_cls_code, name: r.hts_kor_isnm, value: num(r.bstp_nmix_prpr), changeRate: num(r.bstp_nmix_prdy_ctrt) }));
  const want = normName(sectorName);
  if (!want) return { match: null, count: list.length };
  const match = list.find((x) => normName(x.name) === want) || list.find((x) => normName(x.name).includes(want) || (normName(x.name) && want.includes(normName(x.name))));
  return { match: match || null, count: list.length, list };
}
// 당일 1분봉 (30개씩 거꾸로)
async function minutes(event, code, today) {
  const now = kstNow();
  let t = hms(now); if (t > "153000") t = "153000";
  if (t < "090000") return [];
  const bars = new Map();
  for (let k = 0; k < 14 && t >= "090000"; k++) {
    const j = await kis(event, "/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice", "FHKST03010200", {
      FID_ETC_CLS_CODE: "", FID_COND_MRKT_DIV_CODE: "J", FID_INPUT_ISCD: code, FID_INPUT_HOUR_1: t, FID_PW_DATA_INCU_YN: "N",
    });
    const rows = (j.output2 || []).filter((r) => r.stck_cntg_hour && (!r.stck_bsop_date || r.stck_bsop_date === today));
    if (!rows.length) break;
    rows.forEach((r) => bars.set(r.stck_cntg_hour, { t: r.stck_cntg_hour, c: num(r.stck_prpr), h: num(r.stck_hgpr), l: num(r.stck_lwpr), v: num(r.cntg_vol) }));
    const first = rows.map((r) => r.stck_cntg_hour).sort()[0];
    // 1분 전으로
    const sec = +first.slice(0, 2) * 3600 + +first.slice(2, 4) * 60 + +first.slice(4, 6) - 60;
    const nt = [Math.floor(sec / 3600), Math.floor((sec % 3600) / 60), sec % 60].map((x) => String(x).padStart(2, "0")).join("");
    if (nt >= t) break; t = nt;
    await sleep(60);
  }
  return [...bars.values()].sort((a, b) => a.t.localeCompare(b.t));
}
// 5분 동안 가장 크게 빠진/오른 구간
function swing(bars) {
  if (!bars.length) return null;
  const total = bars.reduce((s, b) => s + (b.v || 0), 0);
  let dn = null, up = null;
  for (let i = 0; i < bars.length; i++) {
    const a = bars[Math.max(0, i - 5)];
    if (!a.c || i === 0) continue;
    const chg = (bars[i].c / a.c - 1) * 100;
    const vol = bars.slice(Math.max(0, i - 4), i + 1).reduce((s, b) => s + (b.v || 0), 0);
    const w = { from: a.t, to: bars[i].t, chg, vol, share: total ? vol / total * 100 : null };
    if (!dn || chg < dn.chg) dn = w;
    if (!up || chg > up.chg) up = w;
  }
  const big = bars.reduce((m, b) => (!m || b.v > m.v ? b : m), null);
  return { down: dn, up, peakMinute: big ? { t: big.t, v: big.v, share: total ? big.v / total * 100 : null } : null, total, last: bars[bars.length - 1].t };
}
async function flow(event, code) {
  const out = { at: new Date().toISOString(), kst: hms(kstNow()), errors: [] };
  const step = async (name, fn) => { try { await fn(); } catch (e) { out.errors.push(`${name}: ${e.message || e}`); } await sleep(60); };
  const today = ymd(kstNow());
  await step("현재가", async () => { out.price = tidyPrice(await price(event, code)); });
  await step("투자자", async () => { const inv = await investor(event, code); out.investor = inv[0] || null; out.investorPrev = inv[1] || null; });
  out.tradeDate = (out.investor && out.investor.d) || today;
  out.isToday = out.tradeDate === today;
  await step("체결강도", async () => { out.ccnl = await ccnl(event, code); });
  await step("VI", async () => { out.vi = await viStatus(event, code, out.tradeDate); });
  await step("코스닥", async () => { out.kosdaq = await index(event, "1001"); });
  await step("업종", async () => { const s = await sectorIndex(event, out.price && out.price.sector, out.price && out.price.market); out.sector = s.match ? s.match : { name: out.price && out.price.sector, changeRate: null, notFound: true, count: s.count }; });
  if (out.isToday) await step("분봉", async () => { const b = await minutes(event, code, today); out.swing = swing(b); out.bars = b.length; });
  return out;
}

const res = (body, status = 200, cacheSec = 0) => ({
  statusCode: status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "public, max-age=0, must-revalidate",
    "Netlify-CDN-Cache-Control": cacheSec ? `public, s-maxage=${cacheSec}, stale-while-revalidate=60` : "no-store",
  },
  body: JSON.stringify(body),
});

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const code = String(q.code || "368600").replace(/\D/g, "").slice(0, 6);
  const type = q.type;
  if (!KEY || !SECRET) return res({ ok: false, error: "KIS_APPKEY / KIS_APPSECRET 환경변수가 없습니다. Netlify에 넣은 뒤 재배포하세요." }, 500);
  try {
    if (!type) return res(await price(event, code), 200, 30); // 예전 대시보드 호환
    if (type === "price") return res({ ok: true, code, at: new Date().toISOString(), data: tidyPrice(await price(event, code)) }, 200, 30);
    if (type === "daily") {
      const days = Math.min(Math.max(Number(q.days) || 180, 20), 400);
      return res({ ok: true, code, data: await daily(event, code, days) }, 200, 600);
    }
    if (type === "investor") return res({ ok: true, code, data: await investor(event, code) }, 200, 300);
    if (type === "index") {
      const codes = String(q.codes || "0001,1001").split(",").map((x) => x.replace(/\D/g, "").slice(0, 4)).filter(Boolean).slice(0, 6);
      const data = [];
      for (const c of codes) { try { data.push({ ok: true, ...(await index(event, c)) }); } catch (e) { data.push({ code: c, ok: false, error: String(e.message || e) }); } await sleep(70); }
      return res({ ok: true, data }, 200, 30);
    }
    if (type === "indexdaily") {
      const icode = String(q.icode || "1001").replace(/\D/g, "").slice(0, 4);
      const days = Math.min(Math.max(Number(q.days) || 180, 20), 150);
      return res({ ok: true, icode, data: await indexDaily(event, icode, days) }, 200, 600);
    }
    if (type === "multi") {
      const codes = [...new Set(String(q.codes || "").split(",").map((x) => x.replace(/\D/g, "").slice(0, 6)).filter((x) => x.length === 6))].slice(0, 25);
      if (!codes.length) return res({ ok: false, error: "codes=005930,000660 형식으로 넣어 주세요" }, 400);
      return res({ ok: true, at: new Date().toISOString(), data: await multi(event, codes) }, 200, 30);
    }
    if (type === "sectors") { const p = tidyPrice(await price(event, code)); const r = await sectorIndex(event, p.sector, p.market); return res({ ok: true, sector: p.sector, market: p.market, match: r.match, list: r.list }); }
    if (type === "flow") return res({ ok: true, code, data: await flow(event, code) }, 200, 45);
    return res({ ok: false, error: "type은 price | daily | investor | index | indexdaily | multi | flow" }, 400);
  } catch (e) {
    return res({ ok: false, error: String(e.message || e) }, 502);
  }
};
