// 한국투자증권(KIS) 시세 — 기존 stock.js를 확장
//   /.netlify/functions/stock?code=368600                 → 예전과 같은 현재가 원본(output) 반환
//   /.netlify/functions/stock?code=368600&type=price      → 정리된 현재가 {ok, data}
//   /.netlify/functions/stock?code=368600&type=daily      → 일봉(수정주가)
//   /.netlify/functions/stock?code=368600&type=investor   → 투자자별 순매수
//   /.netlify/functions/stock?type=index&codes=0001,1001   → 코스피·코스닥 지수
//   /.netlify/functions/stock?type=indexdaily&icode=1001   → 지수 일봉
//   /.netlify/functions/stock?type=multi&codes=005930,...  → 여러 종목 현재가
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
const fresh = (c) => c && c.token && c.exp - Date.now() > 5 * 60e3;

// 동시에 여러 요청이 와도 토큰은 한 번만 발급 (KIS: 발급 1분 1회 제한)
async function getToken(event) {
  if (fresh(mem)) return mem.token;
  const store = tokenStore(event);
  const read = async () => { try { return store ? await store.get("token", { type: "json" }) : null; } catch (e) { return null; } };

  let c = await read();
  if (fresh(c)) { mem = c; return c.token; }

  // 다른 요청이 발급 중이면(잠금 20초) 그 결과를 기다림
  if (store) {
    let lock = null;
    try { lock = await store.get("lock", { type: "json" }); } catch (e) {}
    if (lock && Date.now() - lock.at < 20e3) {
      for (let i = 0; i < 12; i++) { await sleep(500); c = await read(); if (fresh(c)) { mem = c; return c.token; } }
    }
    try { await store.setJSON("lock", { at: Date.now() }); } catch (e) {}
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
  if (store) { try { await store.setJSON("token", mem); await store.delete("lock"); } catch (e) {} }
  return mem.token;
}

async function kis(event, path, trId, params) {
  const token = await getToken(event);
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
  const j = await r.json();
  if (j.rt_cd && j.rt_cd !== "0") {
    if (/token|토큰/i.test(j.msg1 || "")) mem = { token: null, exp: 0 }; // 만료 토큰이면 다음 호출에 재발급
    throw new Error(`${trId}: ${j.msg1 || j.msg_cd}`);
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
    return res({ ok: false, error: "type은 price | daily | investor | index | indexdaily | multi" }, 400);
  } catch (e) {
    return res({ ok: false, error: String(e.message || e) }, 502);
  }
};
