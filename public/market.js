/* 주가 변동 이유(왜 움직였나) + 주변 시장(동종·테마·산업·이슈)
   - 버튼을 눌렀을 때만 데이터를 불러옵니다 (KIS 호출 최소화)
   - 자동 매칭은 '같은 시기에 있었던 일'이며 원인을 확정하지 않습니다 */
(function () {
  const D = window.ICH;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmt = (n, d = 0) => (n == null || isNaN(n) ? "–" : Number(n).toLocaleString("ko-KR", { maximumFractionDigits: d, minimumFractionDigits: d }));
  const cls = (n) => (n > 0 ? "pos" : n < 0 ? "neg" : "");
  const pct = (n, d = 2) => (n == null || isNaN(n) ? "–" : `<span class="${cls(n)}">${n > 0 ? "+" : ""}${fmt(n, d)}%</span>`);
  const TAGN = { dis: "공시", co: "회사", ext: "외부", hear: "전언", est: "추정" };
  const tag = (k) => (k ? `<span class="tag ${k}">${TAGN[k] || k}</span>` : "");
  const toDash = (d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const getJSON = async (u) => { const r = await fetch(u); const j = await r.json().catch(() => ({ ok: false, error: "HTTP " + r.status })); if (!j.ok) throw new Error(j.error || "실패"); return j; };
  const API = "/.netlify/functions/";

  function toggle(btn, body, onOpen) {
    btn.addEventListener("click", () => {
      const open = btn.getAttribute("aria-expanded") !== "true";
      btn.setAttribute("aria-expanded", open); body.hidden = !open;
      if (open) onOpen();
    });
  }

  /* =================== 1) 왜 움직였나 =================== */
  let W = null; // 불러온 데이터
  let moveFilter = "all";

  async function loadWhy() {
    if (W) return renderWhy();
    $("#whyToday").innerHTML = `<p class="muted">불러오는 중… (시세·코스닥·수급·뉴스)</p>`;
    W = { daily: [], kq: {}, inv: {}, news: [], notes: [], price: null, kqNow: null, errors: [] };
    const step = async (name, fn) => { try { await fn(); } catch (e) { W.errors.push(`${name}: ${e.message}`); } };
    await step("현재가", async () => { W.price = (await getJSON(API + "stock?type=price")).data; });
    await step("일봉", async () => { W.daily = (await getJSON(API + "stock?type=daily&days=200")).data; });
    await step("코스닥", async () => {
      const j = await getJSON(API + "stock?type=indexdaily&icode=1001&days=150");
      const arr = j.data; arr.forEach((r, i) => { if (i) W.kq[r.d] = (r.c / arr[i - 1].c - 1) * 100; });
      const now = await getJSON(API + "stock?type=index&codes=1001"); W.kqNow = now.data[0] && now.data[0].ok ? now.data[0] : null;
    });
    await step("수급", async () => { (await getJSON(API + "stock?type=investor")).data.forEach((r) => (W.inv[r.d] = r)); });
    await step("뉴스", async () => { W.news = (await getJSON(API + "news?display=100&query=" + encodeURIComponent(D.META.name))).data; });
    await step("기록", async () => { W.notes = (await getJSON(API + "notes")).data || []; });
    renderWhy();
  }

  function rowsWithStats() {
    const d = W.daily;
    return d.map((r, i) => {
      if (!i) return null;
      const prev = d[i - 1];
      const chg = (r.c / prev.c - 1) * 100;
      const past = d.slice(Math.max(0, i - 20), i).map((x) => x.v).filter((v) => v > 0);
      const vr = r.v && past.length ? r.v / avg(past) : null;
      const gapDays = (Date.parse(toDash(r.d)) - Date.parse(toDash(prev.d))) / 86400e3;
      return { ...r, prevD: prev.d, chg, vr, resumed: gapDays > 10 };
    }).filter(Boolean);
  }

  // prevD(전 거래일) 다음날 ~ d 사이에 나온 뉴스·기록
  function matchEvents(d, prevD) {
    const lo = toDash(prevD), hi = toDash(d);
    const inWin = (x) => x > lo && x <= hi;
    const news = W.news.filter((n) => inWin(n.date));
    const logs = [...(D.LOG || []), ...W.notes].filter((l) => inWin(l.date));
    const cur = (D.MOVES || []).filter((m) => m.date === hi);
    return { news, logs, cur };
  }

  function invLine(d) {
    const v = W.inv[d];
    if (!v) return "";
    const p = (k, n) => `${k} <b class="${cls(n)}">${n > 0 ? "+" : ""}${fmt(n)}</b>`;
    return `수급(주): ${p("개인", v.indiv)} · ${p("외국인", v.foreign)} · ${p("기관", v.inst)}`;
  }

  function readOne(r, kq, ev) {
    // 사실만 엮은 한 줄 해석
    const parts = [];
    if (kq != null) {
      const ex = r.chg - kq;
      const k = `${kq > 0 ? "+" : ""}${fmt(kq, 1)}%`;
      if (Math.abs(ex) < 2) parts.push(Math.abs(kq) >= 1.5 ? `코스닥(${k})과 함께 움직임 — 시장 전체 흐름 영향이 컸을 수 있음` : `코스닥(${k})과 비슷한 흐름 (차이 ${fmt(Math.abs(ex), 1)}%p)`);
      else parts.push(`코스닥(${k})보다 ${fmt(Math.abs(ex), 1)}%p ${ex > 0 ? "강함" : "약함"} — 종목 자체 이슈 쪽에 무게`);
    }
    if (r.vr != null && r.vr >= 3) parts.push(`거래량 평소의 ${fmt(r.vr, 1)}배`);
    if (r.resumed) parts.push("거래정지 후 재개일 — 기준가 재산정 영향");
    if (ev.cur.length) parts.push("확인된 이유 있음");
    else if (ev.news.length || ev.logs.length) parts.push(`같은 시기 뉴스·기록 ${ev.news.length + ev.logs.length}건`);
    else parts.push("같은 시기 뉴스·기록 없음 — 수급·테마 흐름 확인 필요");
    return parts.join(" · ");
  }

  function evList(ev) {
    const li = [];
    ev.cur.forEach((m) => li.push(`<li><span class="badge os-확인">확인</span> ${esc(m.reason)} ${tag(m.src)}</li>`));
    ev.logs.forEach((l) => li.push(`<li><span class="chip">${esc(l.type)}</span>${esc(l.date)} ${esc(l.title)} ${tag(l.src)}</li>`));
    ev.news.slice(0, 6).forEach((n) => li.push(`<li><span class="chip">뉴스</span>${esc(n.date)} <a href="${esc(n.origin)}" target="_blank" rel="noopener">${esc(n.title)}</a></li>`));
    if (ev.news.length > 6) li.push(`<li class="muted">외 뉴스 ${ev.news.length - 6}건</li>`);
    return li.length ? `<ul>${li.join("")}</ul>` : "";
  }

  function renderWhy() {
    const rows = rowsWithStats();
    const last = rows[rows.length - 1];
    const P = W.price;
    // ---- 오늘(최근 거래일) ----
    let todayHtml = "";
    if (P || last) {
      const chg = P ? P.changeRate : last.chg;
      const kq = W.kqNow ? W.kqNow.changeRate : last ? W.kq[last.d] : null;
      const base = last || { d: "", prevD: "" };
      const ev = base.d ? matchEvents(base.d, base.prevD) : { news: [], logs: [], cur: [] };
      const vr = last ? last.vr : null;
      const rowLike = { chg, vr, resumed: last && last.resumed };
      todayHtml = `
        <h3>최근 거래일 ${base.d ? toDash(base.d) : ""}</h3>
        <div class="today">
          <div class="tile"><div class="k">아이씨에이치</div><div class="v">${pct(chg)}</div><div class="s">${P ? fmt(P.price) + "원" : ""}</div></div>
          <div class="tile"><div class="k">코스닥</div><div class="v">${pct(kq)}</div><div class="s">${W.kqNow ? fmt(W.kqNow.value, 2) : ""}</div></div>
          <div class="tile"><div class="k">시장 대비</div><div class="v">${kq == null || chg == null ? "–" : pct(chg - kq).replace("%", "%p")}</div><div class="s">초과 등락</div></div>
          <div class="tile"><div class="k">거래량 / 20일 평균</div><div class="v">${vr ? fmt(vr, 1) + "배" : "–"}</div><div class="s">${last ? fmt(last.v) + "주" : ""}</div></div>
        </div>
        <div class="mv"><div class="meta"><b>한 줄 정리:</b> ${chg == null ? "–" : readOne(rowLike, kq, ev)}</div>
          <div class="meta" style="margin-top:4px">${base.d ? invLine(base.d) : ""}</div>${evList(ev)}</div>`;
    }
    if (W.errors.length) todayHtml += `<p class="small" style="color:#c0392b">일부 데이터를 못 불러왔습니다 — ${esc(W.errors.join(" / "))}</p>`;
    $("#whyToday").innerHTML = todayHtml || `<p class="muted">시세를 불러오지 못했습니다. ${esc(W.errors.join(" / "))}</p>`;
    const h = $("#whyHint"); if (h && P) h.innerHTML = `오늘 ${pct(P.changeRate)} · 눌러서 이유 보기`;

    // ---- 큰 움직임 ----
    const curDates = new Set((D.MOVES || []).map((m) => m.date.replace(/-/g, "")));
    let big = rows.filter((r) => Math.abs(r.chg) >= 5 || (r.vr && r.vr >= 3) || curDates.has(r.d)).reverse();
    if (moveFilter === "up") big = big.filter((r) => r.chg > 0);
    if (moveFilter === "down") big = big.filter((r) => r.chg < 0);
    $("#whyMoves").innerHTML = big.length ? big.slice(0, 25).map((r) => {
      const kq = W.kq[r.d]; const ev = matchEvents(r.d, r.prevD);
      return `<div class="mv">
        <div class="mh"><span class="md">${toDash(r.d)}</span><span class="mr">${pct(r.chg)}</span>
          <span class="meta">종가 ${fmt(r.c)}원 · 거래량 ${r.vr ? fmt(r.vr, 1) + "배" : "–"} · 코스닥 ${pct(kq, 1)}</span></div>
        <div class="meta" style="margin-top:4px">${readOne(r, kq, ev)}</div>
        <div class="meta">${invLine(r.d)}</div>
        ${evList(ev)}</div>`;
    }).join("") : `<p class="muted">${rows.length ? "조건에 맞는 날이 없습니다." : "일봉 데이터를 불러오지 못했습니다."}</p>`;
  }

  /* =================== 2) 주변 시장 =================== */
  let A = null, aTab = "peers";
  async function loadAround() {
    if (A) return renderAround();
    A = { quotes: {}, idx: [], issues: {}, me: null };
    $("#aroundPane").innerHTML = `<p class="muted">불러오는 중…</p>`;
    try { A.me = (await getJSON(API + "stock?type=price")).data; } catch (e) {}
    try { A.idx = (await getJSON(API + "stock?type=index&codes=" + D.MARKET.indices.map((x) => x[1]).join(","))).data; } catch (e) { A.idxErr = e.message; }
    for (const t of D.MARKET.themes) {
      try { (await getJSON(API + "stock?type=multi&codes=" + t.stocks.map((s) => s[1]).join(","))).data.forEach((q) => (A.quotes[q.code] = q)); }
      catch (e) { t.stocks.forEach((s) => (A.quotes[s[1]] = { ok: false, error: e.message })); }
      renderAround();
    }
    renderAround();
  }
  const themeAvg = (t) => avg(t.stocks.map((s) => A.quotes[s[1]]).filter((q) => q && q.ok && q.changeRate != null).map((q) => q.changeRate));

  function bar(v, scale = 10) {
    if (v == null || isNaN(v)) return "";
    const w = Math.min(Math.abs(v) / scale, 1) * 50;
    return `<div class="bar"><i style="left:${v >= 0 ? 50 : 50 - w}%;width:${w}%;background:${v >= 0 ? "#d63b3b" : "#2f6fd6"}"></i><i style="left:50%;width:1px;background:#c9d2dd"></i></div>`;
  }
  function stockTable(stocks) {
    return `<div class="tbl-scroll"><table><thead><tr><th>종목</th><th class="n">현재가</th><th class="n">등락률</th><th style="width:28%"></th><th class="n">시총(억)</th><th>업종(KIS)</th></tr></thead><tbody>` +
      stocks.map(([n, c]) => {
        const q = A.quotes[c];
        if (!q) return `<tr><td>${esc(n)} <span class="muted">${c}</span></td><td colspan="5" class="muted">불러오는 중…</td></tr>`;
        if (!q.ok) return `<tr><td>${esc(n)} <span class="muted">${c}</span></td><td colspan="5" class="small" style="color:#c0392b">${esc(q.error)}</td></tr>`;
        return `<tr><td><b>${esc(n)}</b> <span class="muted">${c}</span></td><td class="n">${fmt(q.price)}</td><td class="n">${pct(q.changeRate)}</td><td>${bar(q.changeRate)}</td><td class="n">${fmt(q.marketCapEok)}</td><td class="small muted">${esc(q.sector || "")}</td></tr>`;
      }).join("") + `</tbody></table></div>`;
  }

  function renderAround() {
    const me = A.me, kq = (A.idx || []).find((x) => x.code === "1001");
    if (me) A.quotes[D.META.code] = { ok: true, ...me };
    const peerT = D.MARKET.themes[0];
    const pAvg = themeAvg(peerT);
    $("#aroundSummary").innerHTML = `오늘 <b>아이씨에이치</b> ${pct(me && me.changeRate)} · <b>동종 평균</b> ${pct(pAvg)} · <b>코스닥</b> ${pct(kq && kq.changeRate)}` +
      (me && pAvg != null ? ` → 동종 대비 ${pct(me.changeRate - pAvg).replace("%", "%p")}` : "");

    let h = "";
    if (aTab === "peers") {
      h = `<div class="thm"><b>${esc(peerT.name)}</b><span class="muted small">${esc(peerT.why)} · 평균 ${pct(themeAvg(peerT))}</span></div>` +
        stockTable([[D.META.name, D.META.code], ...peerT.stocks]);
    } else if (aTab === "themes") {
      h = D.MARKET.themes.slice(1).map((t) => `<div class="thm"><b>${esc(t.name)}</b><span class="muted small">${esc(t.why)} · 평균 ${pct(themeAvg(t))}</span></div>${stockTable(t.stocks)}`).join("");
    } else if (aTab === "market") {
      const rows = [
        ...(A.idx || []).map((x) => [D.MARKET.indices.find((i) => i[1] === x.code)?.[0] || x.code, x.ok ? x.changeRate : null, x.ok ? fmt(x.value, 2) : esc(x.error || "")]),
        ...D.MARKET.themes.map((t) => [t.name + " (평균)", themeAvg(t), t.stocks.length + "종목"]),
        [D.META.name, me ? me.changeRate : null, me ? fmt(me.price) + "원" : ""],
      ].sort((a, b) => (b[1] ?? -999) - (a[1] ?? -999));
      h = `<div class="tbl-scroll"><table><thead><tr><th>시장·업종·테마</th><th class="n">오늘 등락</th><th style="width:38%"></th><th class="n">지수·구성</th></tr></thead><tbody>` +
        rows.map(([n, v, s]) => `<tr${n === D.META.name ? ' style="background:#eef7f8;font-weight:600"' : ""}><td>${esc(n)}</td><td class="n">${pct(v)}</td><td>${bar(v, 5)}</td><td class="n small">${s}</td></tr>`).join("") +
        `</tbody></table></div>` + (A.idxErr ? `<p class="small" style="color:#c0392b">지수 조회 실패: ${esc(A.idxErr)}</p>` : "") +
        `<h3>산업 흐름 (누적 참고)</h3><ul class="small">${(D.INDUSTRY || []).slice(0, 8).map((r) => `<li><b>${esc(r[0])}</b> ${esc(r[1])} <span class="muted">${esc(r[2])}</span></li>`).join("")}</ul>`;
    } else if (aTab === "issues") {
      h = D.MARKET.themes.map((t, i) => `<div class="thm"><b>${esc(t.name)}</b><span class="muted small">검색어: ${esc(t.news)}</span></div><div id="iss${i}" class="small">${A.issues[i] || '<p class="muted">불러오는 중…</p>'}</div>`).join("");
      loadIssues();
    }
    $("#aroundPane").innerHTML = h;
  }
  let issuesLoading = false;
  async function loadIssues() {
    if (issuesLoading) return; issuesLoading = true;
    for (let i = 0; i < D.MARKET.themes.length; i++) {
      if (A.issues[i]) continue;
      const t = D.MARKET.themes[i];
      try {
        const j = await getJSON(API + "news?display=5&query=" + encodeURIComponent(t.news));
        A.issues[i] = j.data.length ? `<ul style="margin:0;padding-left:18px">${j.data.map((n) => `<li><span class="muted">${n.date}</span> <a href="${esc(n.origin)}" target="_blank" rel="noopener">${esc(n.title)}</a></li>`).join("")}</ul>` : `<p class="muted">최근 기사 없음</p>`;
      } catch (e) { A.issues[i] = `<p class="small" style="color:#c0392b">${esc(e.message)}</p>`; }
      const el = $("#iss" + i); if (el) el.innerHTML = A.issues[i];
    }
    issuesLoading = false;
  }

  /* =================== 연결 =================== */
  toggle($("#whyBtn"), $("#whyBody"), loadWhy);
  toggle($("#aroundBtn"), $("#aroundBody"), loadAround);
  $("#moveFilter").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; moveFilter = b.dataset.f; $$("#moveFilter button").forEach((x) => x.classList.toggle("on", x === b)); if (W) renderWhy(); });
  $("#aroundTabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; aTab = b.dataset.t; $$("#aroundTabs button").forEach((x) => x.classList.toggle("on", x === b)); if (A) renderAround(); });
  // 오늘 등락을 버튼 옆에 미리 보여주기 (가벼운 현재가 1회)
  setTimeout(async () => { try { const p = (await getJSON(API + "stock?type=price")).data; const h = $("#whyHint"); if (h) h.innerHTML = `오늘 ${pct(p.changeRate)} · 눌러서 이유 보기`; } catch (e) {} }, 2500);
})();
