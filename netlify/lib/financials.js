// DART 재무제표 자동 반영 — 분기·반기·사업보고서의 연결재무제표에서 핵심 숫자만 뽑아 Blobs에 저장
//   OpenDART 단일회사 전체 재무제표 (fnlttSinglAcntAll), 연결(CFS) 우선 → 없으면 별도(OFS)
//   단위: 억 원 (소수 1자리)

const CORP = process.env.DART_CORP_CODE || "01302853";
const FIRST_YEAR = 2025; // 이 해부터 DART 숫자로 채움 (이전은 데이터 파일 값 유지)
const REPORTS = [["11013", "1Q"], ["11012", "2Q"], ["11014", "3Q"], ["11011", "4Q"]];

const doFetch = (url, ms = 8000) => {
  const f = typeof fetch === "function" ? fetch : require("node-fetch");
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  return f(url, { signal: ctl.signal }).catch((e) => { throw new Error(e.name === "AbortError" ? "시간 초과" : e.message || String(e)); }).finally(() => clearTimeout(t));
};
const key = () => String(process.env.DART_API_KEY || "").trim().replace(/^["']|["']$/g, "");
const num = (v) => { if (v == null || v === "" || v === "-") return null; const n = Number(String(v).replace(/,/g, "")); return isNaN(n) ? null : n; };
const eok = (n) => (n == null ? null : Math.round(n / 1e7) / 10);

const IDS = {
  sales: [/^ifrs-full_Revenue$/, /매출액|수익\(매출액\)|영업수익/],
  op: [/^dart_OperatingIncomeLoss$/, /^영업이익|^영업손실|영업이익\(손실\)/],
  ni: [/^ifrs-full_ProfitLoss$/, /^당기순이익|^당기순손실|분기순이익|분기순손실|반기순이익|반기순손실|당기순이익\(손실\)|분기순이익\(손실\)|반기순이익\(손실\)/],
  assets: [/^ifrs-full_Assets$/, /^자산총계$/],
  curAssets: [/^ifrs-full_CurrentAssets$/, /^유동자산$/],
  cash: [/^ifrs-full_CashAndCashEquivalents$/, /^현금및현금성자산$/],
  inv: [/^ifrs-full_Inventories$/, /^재고자산$/],
  ppe: [/^ifrs-full_PropertyPlantAndEquipment$/, /^유형자산$/],
  liab: [/^ifrs-full_Liabilities$/, /^부채총계$/],
  curLiab: [/^ifrs-full_CurrentLiabilities$/, /^유동부채$/],
  equity: [/^ifrs-full_Equity$/, /^자본총계$/],
  ocf: [/^ifrs-full_CashFlowsFromUsedInOperatingActivities$/, /^영업활동(으로 인한)?\s*현금흐름|영업활동현금흐름/],
};

function pick(list, sjs, k) {
  const [idRe, nmRe] = IDS[k];
  const rows = list.filter((r) => sjs.includes(r.sj_div));
  return rows.find((r) => idRe.test(r.account_id || "")) || rows.find((r) => nmRe.test(String(r.account_nm || "").replace(/\s/g, "")));
}

async function fetchReport(year, reprt) {
  for (const fs of ["CFS", "OFS"]) {
    const r = await doFetch(`https://opendart.fss.or.kr/api/fnlttSinglAcntAll.json?${new URLSearchParams({ crtfc_key: key(), corp_code: CORP, bsns_year: year, reprt_code: reprt, fs_div: fs })}`);
    const j = await r.json();
    if (j.status === "013") continue; // 해당 없음
    if (j.status !== "000") throw new Error(`DART ${j.status} ${j.message || ""}`.trim());
    const L = j.list || [];
    const IS = ["IS", "CIS"], BS = ["BS"], CF = ["CF"];
    const g = (k, sj, col) => { const row = pick(L, sj, k); return row ? num(row[col]) : null; };
    // 손익: 분기·반기 보고서의 thstrm_amount = 해당 3개월, thstrm_add_amount = 누적
    const out = { year, reprt, fs, rcept: (L[0] || {}).rcept_no || "" };
    for (const k of ["sales", "op", "ni"]) {
      out[k] = g(k, IS, "thstrm_amount");
      out[k + "Cum"] = g(k, IS, "thstrm_add_amount");
    }
    for (const k of ["assets", "curAssets", "cash", "inv", "ppe", "liab", "curLiab", "equity"]) out[k] = g(k, BS, "thstrm_amount");
    out.ocf = g("ocf", CF, "thstrm_amount");
    // 차입금(사채·전환사채 포함): 재무상태표 계정명 합산 (할인·조정 계정 제외)
    const debt = L.filter((r) => r.sj_div === "BS" && /차입금|사채/.test(r.account_nm || "") && !/할인|조정|할증|상환|이자|파생|총계|합계/.test(r.account_nm || ""));
    out.debt = debt.length ? debt.reduce((s, r) => s + (num(r.thstrm_amount) || 0), 0) : null;
    if (out.sales == null && out.assets == null) continue;
    return out;
  }
  return null; // 아직 제출 전
}

// 기대 제출 시점 지난 보고서만 시도 (1Q 5/15, 반기 8/14, 3Q 11/14, 사업 3/31)
function dueReports(now = new Date()) {
  const out = [];
  const y0 = now.getUTCFullYear();
  for (let y = FIRST_YEAR; y <= y0; y++) {
    const due = { "11013": new Date(`${y}-05-01`), "11012": new Date(`${y}-07-25`), "11014": new Date(`${y}-10-25`), "11011": new Date(`${y + 1}-02-15`) };
    for (const [code] of REPORTS) if (now >= due[code]) out.push([String(y), code]);
  }
  return out;
}

const getStore = (event) => {
  const blobs = require("@netlify/blobs");
  if (event && blobs.connectLambda) { try { blobs.connectLambda(event); } catch (e) { /* 예약 실행 */ } }
  const opts = { name: "ich-fin" };
  if (process.env.BLOBS_SITE_ID && process.env.BLOBS_TOKEN) { opts.siteID = process.env.BLOBS_SITE_ID; opts.token = process.env.BLOBS_TOKEN; }
  return blobs.getStore(opts);
};

// 보고서마다 별도 키(rep-연도-코드)로 저장 — 동시에 여러 요청이 돌아도 서로 덮어쓰지 않음
async function read(store) {
  const reports = {}, checked = {};
  const { blobs } = await store.list();
  await Promise.all(blobs.map(async ({ key: k }) => {
    if (k.startsWith("rep-")) { const v = await store.get(k, { type: "json" }); if (v) reports[k.slice(4)] = v; }
    else if (k.startsWith("chk-")) { checked[k.slice(4)] = await store.get(k); }
  }));
  const meta = (await store.get("meta", { type: "json" })) || {};
  return { reports, checked, lastRun: meta.lastRun || "", lastError: meta.lastError || "" };
}

// 아직 없는 보고서만 가져옴. 제출 전(013)이면 6시간 뒤 다시 확인. 한 번에 최대 maxCalls건
async function collect(store, { maxCalls = 8, deadline = Date.now() + 25000, force = false } = {}) {
  if (!key()) return { skipped: "DART_API_KEY 없음" };
  const fin = await read(store);
  const errors = []; let added = 0, calls = 0;
  const now = Date.now();
  const todo = dueReports().map(([y, c]) => `${y}-${c}`).filter((id) => !fin.reports[id] && (force || !fin.checked[id] || now - new Date(fin.checked[id]).getTime() > 6 * 3600e3));
  // 최신 보고서부터 확인 (새로 나온 분기보고서가 가장 먼저 반영되도록)
  for (const id of todo.reverse()) {
    if (calls >= maxCalls || Date.now() > deadline) break;
    calls++;
    try {
      const r = await fetchReport(id.slice(0, 4), id.slice(5));
      if (r) { fin.reports[id] = { ...r, fetchedAt: new Date().toISOString() }; await store.setJSON("rep-" + id, fin.reports[id]); added++; }
      else { fin.checked[id] = new Date().toISOString(); await store.set("chk-" + id, fin.checked[id]); }
    } catch (e) { errors.push(`${id}: ${e.message || e}`); }
  }
  fin.lastRun = new Date().toISOString();
  fin.lastError = errors.join(" / ");
  await store.setJSON("meta", { lastRun: fin.lastRun, lastError: fin.lastError });
  return { added, calls, remaining: Math.max(0, todo.length - calls), errors, _fin: fin };
}

// 화면용으로 정리: 분기 손익, 연간, 재무상태 시점별
function shape(fin) {
  const R = fin.reports, Q = [], A = [], B = [];
  const years = [...new Set(Object.keys(R).map((k) => k.slice(0, 4)))].sort();
  for (const y of years) {
    const q1 = R[`${y}-11013`], h1 = R[`${y}-11012`], q3 = R[`${y}-11014`], fy = R[`${y}-11011`];
    const yy = y.slice(2);
    const qv = (rep, k) => (rep ? rep[k] : null);
    const qs = {
      "1Q": q1 && { s: qv(q1, "sales"), op: qv(q1, "op"), ni: qv(q1, "ni"), rep: q1 },
      "2Q": h1 && { s: qv(h1, "sales"), op: qv(h1, "op"), ni: qv(h1, "ni"), rep: h1 },
      "3Q": q3 && { s: qv(q3, "sales"), op: qv(q3, "op"), ni: qv(q3, "ni"), rep: q3 },
    };
    if (fy) {
      // 4Q = 연간 − 3Q 누적 (없으면 연간 − 1Q − 2Q − 3Q)
      const four = (k) => {
        const cum = q3 && q3[k + "Cum"] != null ? q3[k + "Cum"] : (q1 && h1 && q3 && q1[k] != null && h1[k] != null && q3[k] != null ? q1[k] + h1[k] + q3[k] : null);
        return fy[k] != null && cum != null ? fy[k] - cum : null;
      };
      qs["4Q"] = { s: four("sales"), op: four("op"), ni: four("ni"), rep: fy, derived: true };
      A.push({ year: y, sales: eok(fy.sales), op: eok(fy.op), ni: eok(fy.ni), ocf: eok(fy.ocf) });
    }
    for (const [lab, v] of Object.entries(qs)) if (v && v.s != null) Q.push({ q: `${lab}${yy}`, s: eok(v.s), op: eok(v.op), ni: eok(v.ni), rcept: v.rep.rcept, fs: v.rep.fs, derived: !!v.derived });
    for (const [code, mm] of [["11013", "03"], ["11012", "06"], ["11014", "09"], ["11011", "12"]]) {
      const r = R[`${y}-${code}`];
      if (r && r.assets != null) B.push({ col: code === "11011" ? y : `${y}.${mm}`, assets: eok(r.assets), curAssets: eok(r.curAssets), cash: eok(r.cash), inv: eok(r.inv), ppe: eok(r.ppe), liab: eok(r.liab), curLiab: eok(r.curLiab), debt: eok(r.debt), equity: eok(r.equity), rcept: r.rcept });
    }
  }
  return { quarters: Q, annual: A, bs: B };
}

module.exports = { getStore, read, collect, shape, key, fetchReport };
