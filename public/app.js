/* 아이씨에이치 기업 노트 — 화면 렌더링 (데이터는 data/ich-data.js) */
(function () {
  const D = window.ICH;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmt = (n, d = 0) => (n == null || isNaN(n) ? "–" : Number(n).toLocaleString("ko-KR", { maximumFractionDigits: d, minimumFractionDigits: d }));
  const signCls = (n) => (n > 0 ? "pos" : n < 0 ? "neg" : "");
  const TAGN = { dis: "공시", co: "회사", ext: "외부", hear: "전언", est: "추정" };
  const tag = (k) => (k ? `<span class="tag ${k}">${TAGN[k] || k}</span>` : "");
  const ls = {
    get(k, d) { try { const v = localStorage.getItem("ichnote:" + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("ichnote:" + k, JSON.stringify(v)); } catch (e) {} },
  };

  let LIVE = { price: D.META.refPrice, shares: D.META.sharesEst, ok: false };
  let DAILY = [];
  let WEBLOG = [];

  /* ---------- 머리 ---------- */
  function header() {
    $("#created").textContent = D.META.created;
    const dates = [...D.LOG.map((l) => l.date), ...D.CHANGELOG.map((c) => c[0]), ...WEBLOG.map((l) => l.date)];
    $("#lastUpdated").textContent = dates.sort().slice(-1)[0] || D.META.created;
    $("#logCount").textContent = D.LOG.length + WEBLOG.length;
    $$(".eqAsOf").forEach((e) => (e.textContent = D.META.equityAsOf));
    $$(".eqV").forEach((e) => (e.textContent = fmt(D.META.equity)));
  }

  /* ---------- 개요·관점·사업 ---------- */
  function overview() {
    $("#profileTbl").innerHTML = "<tbody>" + D.PROFILE.map(([k, v]) => `<tr><th style="width:90px">${k}</th><td>${esc(v)}</td></tr>`).join("") + "</tbody>";
    $("#oneLine").textContent = D.THESIS.oneLine;
    $("#tPoints").innerHTML = D.THESIS.points.map(([t, s]) => `<li>${esc(t)} ${tag(s)}</li>`).join("");
    $("#tConcerns").innerHTML = D.THESIS.concerns.map(([t, s]) => `<li>${esc(t)} ${tag(s)}</li>`).join("");
    $("#tKpis").innerHTML = D.THESIS.kpis.map((t) => `<li>${esc(t)}</li>`).join("");
    const colors = ["#16325c", "#0f7b8a", "#d27a12", "#57a773"];
    $("#segBar").innerHTML = D.SEGMENTS.map((s, i) => `<div style="width:${s.share}%;background:${colors[i % 4]}">${s.share >= 12 ? esc(s.name) + " " : ""}${s.share}%</div>`).join("");
    $("#segAsOf").textContent = D.SEGMENT_ASOF;
    $("#segTbl").innerHTML = "<thead><tr><th>제품군</th><th class='n'>비중</th><th>설명</th><th>흐름</th></tr></thead><tbody>" +
      D.SEGMENTS.map((s, i) => `<tr><td><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${colors[i % 4]};margin-right:6px"></span><b>${esc(s.name)}</b></td><td class="n">${s.share}%</td><td>${esc(s.desc)}</td><td>${esc(s.trend)}</td></tr>`).join("") + "</tbody>";
  }

  /* ---------- 아이템 트래커 ---------- */
  let itemStage = "전체";
  function items() {
    const stages = ["전체", ...new Set(D.ITEMS.map((i) => i.stage))];
    $("#itemFilter").innerHTML = `<div class="seg">${stages.map((s) => `<button data-s="${s}" class="${s === itemStage ? "on" : ""}">${s}${s === "전체" ? "" : " " + D.ITEMS.filter((i) => i.stage === s).length}</button>`).join("")}</div>`;
    const list = D.ITEMS.filter((i) => itemStage === "전체" || i.stage === itemStage);
    $("#itemTbl").innerHTML = "<thead><tr><th>아이템</th><th>고객</th><th>단계</th><th>시작</th><th>규모(회사 언급)</th><th>메모</th><th>최근 업데이트</th></tr></thead><tbody>" +
      list.map((i) => `<tr><td><b>${esc(i.item)}</b></td><td>${esc(i.customer)}</td><td><span class="badge st-${i.stage}">${i.stage}</span></td><td class="small">${esc(i.start)}</td><td class="small">${esc(i.size)}</td><td class="small">${esc(i.memo)}</td><td class="small" style="white-space:nowrap">${i.updated} ${tag(i.src)}</td></tr>`).join("") + "</tbody>";
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("#itemFilter button");
    if (b) { itemStage = b.dataset.s; items(); }
  });

  /* ---------- 실적 ---------- */
  function finance() {
    const a = D.ANNUAL;
    const rows = [["매출액", a.sales], ["영업이익", a.op], ["당기순이익", a.ni], ["영업활동현금흐름", a.ocf]];
    let h = "<thead><tr><th>항목</th>" + a.years.map((y) => `<th class="n">${y}</th>`).join("") + "</tr></thead><tbody>";
    rows.forEach(([k, v]) => (h += `<tr><td>${k}</td>` + v.map((x) => `<td class="n ${x < 0 ? "neg" : ""}">${fmt(x)}</td>`).join("") + "</tr>"));
    h += "<tr><td>영업이익률</td>" + a.sales.map((s, i) => { const r = (a.op[i] / s) * 100; return `<td class="n ${r < 0 ? "neg" : ""}">${fmt(r, 1)}%</td>`; }).join("") + "</tr>";
    h += "<tr><td>매출 증가율</td><td class='n'>–</td>" + a.sales.slice(1).map((s, i) => { const r = (s / a.sales[i] - 1) * 100; return `<td class="n ${r < 0 ? "neg" : ""}">${fmt(r, 1)}%</td>`; }).join("") + "</tr></tbody>";
    $("#annualTbl").innerHTML = h;

    $("#qTbl").innerHTML = "<thead><tr><th>분기</th><th class='n'>매출</th><th class='n'>영업이익</th><th class='n'>영업이익률</th><th>비고</th></tr></thead><tbody>" +
      D.QUARTERS.map((r) => {
        const m = r.op != null ? (r.op / r.s) * 100 : null;
        return `<tr${r.guide ? ' style="background:#fffaf0"' : ""}><td>${r.q}${r.guide ? " (가이던스)" : ""}</td><td class="n">${fmt(r.s, r.s % 1 ? 1 : 0)}</td><td class="n ${signCls(r.op)}">${r.op == null ? "–" : fmt(r.op)}</td><td class="n">${m == null ? "–" : fmt(m, 1) + "%"}</td><td class="small">${esc(r.src)} ${r.guide ? tag("hear") : r.est ? tag("est") : ""}</td></tr>`;
      }).join("") + "</tbody>";

    let b = "<thead><tr><th>항목</th>" + D.BS.cols.map((c) => `<th class="n">${c}</th>`).join("") + "</tr></thead><tbody>";
    D.BS.rows.forEach(([k, v, u]) => (b += `<tr><td>${k}</td>` + v.map((x) => `<td class="n">${fmt(x, u ? 0 : x % 1 ? 1 : 0)}${u || ""}</td>`).join("") + "</tr>"));
    $("#bsTbl").innerHTML = b + "</tbody>";

    $("#guideTbl").innerHTML = "<thead><tr><th>시점</th><th>내용</th></tr></thead><tbody>" + D.GUIDANCE.map(([d, t, s]) => `<tr><td class="n" style="text-align:left">${d}</td><td>${esc(t)} ${tag(s)}</td></tr>`).join("") + "</tbody>";
    qbars();
  }
  function qbars() {
    const Q = D.QUARTERS, W = 900, H = 300, L = 50, R = 20, T = 28, B = 40;
    const max = Math.max(180, ...Q.map((q) => q.s * 1.15));
    const bw = (W - L - R) / Q.length, y = (v) => T + (H - T - B) * (1 - v / max);
    let s = `<defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#e3f2f4"/><line x1="0" y1="0" x2="0" y2="6" stroke="#0f7b8a" stroke-width="2"/></pattern></defs>`;
    [0, 50, 100, 150].forEach((v) => (s += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#eceff3"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="#8a93a3">${v}</text>`));
    s += `<rect x="${L}" y="${y(133)}" width="${W - L - R}" height="${y(125) - y(133)}" fill="#d27a12" opacity=".14"/><line x1="${L}" x2="${W - R}" y1="${y(129)}" y2="${y(129)}" stroke="#d27a12" stroke-dasharray="5 5"/>`;
    s += `<text x="${L}" y="14" font-size="11.5" fill="#8a93a3">막대 위: 매출 · 막대 안: 영업이익 (억 원)</text><text x="${W - R}" y="14" text-anchor="end" font-size="11.5" fill="#d27a12">┄ 손익분기 구간 125~133억 (회사 언급 연 500~530억 ÷ 4)</text>`;
    Q.forEach((r, i) => {
      const x = L + i * bw + bw * 0.2, w = bw * 0.6, h = y(0) - y(r.s);
      s += `<rect x="${x}" y="${y(0)}" width="${w}" height="0" rx="4" fill="${r.guide ? "url(#hatch)" : "url(#gq)"}" stroke="${r.guide ? "#0f7b8a" : "none"}"><animate attributeName="height" from="0" to="${h}" dur=".9s" begin="${i * 0.08}s" fill="freeze"/><animate attributeName="y" from="${y(0)}" to="${y(r.s)}" dur=".9s" begin="${i * 0.08}s" fill="freeze"/></rect>`;
      s += `<text x="${x + w / 2}" y="${y(r.s) - 6}" text-anchor="middle" font-size="12" font-weight="700" fill="#15181d">${Math.round(r.s)}</text>`;
      if (r.op != null) s += `<text x="${x + w / 2}" y="${y(0) - 8}" text-anchor="middle" font-size="11" font-weight="700" fill="#fff">${r.op > 0 ? "+" : ""}${r.op}</text>`;
      s += `<text x="${x + w / 2}" y="${H - B + 18}" text-anchor="middle" font-size="12" fill="#4a5260">${r.q}${r.guide ? "E" : ""}</text>`;
    });
    $("#qbars").innerHTML = s;
  }

  /* ---------- 자본·산업·일정 ---------- */
  function misc() {
    $("#capTbl").innerHTML = "<thead><tr><th>시점</th><th>내용</th></tr></thead><tbody>" + D.CAPITAL.map(([d, t, s]) => `<tr><td style="white-space:nowrap">${d}</td><td>${esc(t)} ${tag(s)}</td></tr>`).join("") + "</tbody>";
    $("#indTbl").innerHTML = "<thead><tr><th>분야</th><th>내용</th><th>출처</th></tr></thead><tbody>" + D.INDUSTRY.map(([a, b, c]) => `<tr><td style="white-space:nowrap"><b>${a}</b></td><td>${esc(b)}</td><td class="small muted">${esc(c)}</td></tr>`).join("") + "</tbody>";
    $("#calTbl").innerHTML = "<tbody>" + D.CALENDAR.map(([d, t]) => `<tr><td style="white-space:nowrap"><b>${d}</b></td><td>${esc(t)}</td></tr>`).join("") + "</tbody>";
    $("#riskList").innerHTML = D.RISKS.map((r) => `<li>${esc(r)}</li>`).join("");
    $("#timeline").innerHTML = D.TIMELINE.map(([d, t, b]) => `<div class="ev ${b ? "big" : ""}"><div class="d">${d}</div><div>${esc(t)}</div></div>`).join("");
    $("#glossTbl").innerHTML = "<tbody>" + D.GLOSSARY.map(([a, b]) => `<tr><td style="white-space:nowrap"><b>${a}</b></td><td>${esc(b)}</td></tr>`).join("") + "</tbody>";
    $("#srcList").innerHTML = D.SOURCES.map(([t, u]) => (u ? `<li><a href="${u}" target="_blank" rel="noopener">${esc(t)}</a></li>` : `<li>${esc(t)}</li>`)).join("");
    $("#chgTbl").innerHTML = "<tbody>" + D.CHANGELOG.map(([d, t]) => `<tr><td style="white-space:nowrap">${d}</td><td>${esc(t)}</td></tr>`).join("") + "</tbody>";
  }

  /* ---------- 누적 기록 ---------- */
  let logType = "전체", logQ = "";
  function logs() {
    const all = [...WEBLOG, ...D.LOG].sort((a, b) => b.date.localeCompare(a.date));
    const types = ["전체", "미팅", "IR", "공시", "기사", "메모"].filter((t) => t === "전체" || all.some((l) => l.type === t));
    $("#logType").innerHTML = types.map((t) => `<button data-t="${t}" class="${t === logType ? "on" : ""}">${t}${t === "전체" ? "" : " " + all.filter((l) => l.type === t).length}</button>`).join("");
    const q = logQ.trim().toLowerCase();
    const list = all.filter((l) => (logType === "전체" || l.type === logType) && (!q || (l.title + " " + (l.body || []).join(" ")).toLowerCase().includes(q)));
    $("#logList").innerHTML = list.length ? list.map((l) => `
      <div class="log t-${l.type}">
        <div class="lh"><span class="ld">${l.date}</span><span class="ty ty-${l.type}">${l.type}</span><span class="lt">${esc(l.title)}</span>${tag(l.src)}
          ${l.visibility === "private" ? '<span class="badge os-미확인">비공개</span>' : ""}
          ${l.fromWeb ? `<span class="web">사이트에서 추가</span>${ADMIN ? ` <button class="btn" data-del="${l.id}" style="padding:1px 8px;font-size:11px">삭제</button>` : ""}` : ""}
          ${l.link ? `<a class="small" href="${esc(l.link)}" target="_blank" rel="noopener">링크</a>` : ""}</div>
        ${l.body && l.body.length ? `<ul>${l.body.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : ""}
      </div>`).join("") : `<p class="muted">해당하는 기록이 없습니다.</p>`;
    header();
  }
  $("#logType").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { logType = b.dataset.t; logs(); } });
  $("#logSearch").addEventListener("input", (e) => { logQ = e.target.value; logs(); });

  let ADMIN = false;
  async function loadWebLog() {
    const token = ls.get("token", "");
    if (token) $("#fToken").value = token;
    try {
      const r = await fetch("/.netlify/functions/notes", { headers: token ? { "x-admin-token": token } : {} });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      WEBLOG = j.data || []; ADMIN = !!j.admin;
      if (!j.writable) $("#fMsg").textContent = "서버에 NOTE_ADMIN_TOKEN이 없어 추가 기능이 꺼져 있습니다.";
    } catch (e) {
      WEBLOG = [];
      $("#fMsg").textContent = "기록 API 미연결 — 배포 후 사용 가능 (데이터 파일 기록은 그대로 보임)";
    }
    logs();
    if (typeof renderLiveNews === "function" && LIVENEWS.length) renderLiveNews();
  }
  $("#fDate").value = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  $("#fSave").addEventListener("click", async () => {
    const token = $("#fToken").value.trim();
    ls.set("token", token);
    const body = { date: $("#fDate").value, type: $("#fType").value, src: $("#fSrc").value, title: $("#fTitle").value, body: $("#fBody").value, link: $("#fLink").value, visibility: $("#fVis").value };
    $("#fMsg").textContent = "저장 중…";
    try {
      const r = await fetch("/.netlify/functions/notes", { method: "POST", headers: { "content-type": "application/json", "x-admin-token": token }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      $("#fTitle").value = ""; $("#fBody").value = ""; $("#fLink").value = "";
      $("#fMsg").textContent = "저장했습니다.";
      await loadWebLog();
    } catch (e) { $("#fMsg").textContent = "실패: " + e.message; }
  });
  $("#logList").addEventListener("click", async (e) => {
    const id = e.target.dataset && e.target.dataset.del; if (!id) return;
    if (!confirm("이 기록을 삭제할까요?")) return;
    await fetch("/.netlify/functions/notes?id=" + encodeURIComponent(id), { method: "DELETE", headers: { "x-admin-token": ls.get("token", "") } });
    loadWebLog();
  });

  /* ---------- 확인할 것 ---------- */
  let openSt = "전체";
  function openQs() {
    const sts = ["전체", "미확인", "일부", "확인"];
    $("#openFilter").innerHTML = `<div class="seg">${sts.map((s) => `<button data-s="${s}" class="${s === openSt ? "on" : ""}">${s}${s === "전체" ? "" : " " + D.OPEN.filter((o) => o.status === s).length}</button>`).join("")}</div>`;
    const list = D.OPEN.filter((o) => openSt === "전체" || o.status === openSt);
    $("#openTbl").innerHTML = "<thead><tr><th style='width:34px'>#</th><th>확인할 것</th><th>왜</th><th>상태</th><th>들은 내용</th></tr></thead><tbody>" +
      list.map((o) => `<tr><td class="muted">${D.OPEN.indexOf(o) + 1}</td><td>${esc(o.q)}</td><td class="small muted">${esc(o.why)}</td><td><span class="badge os-${o.status}">${o.status}</span></td><td class="small">${o.answer ? esc(o.answer) + (o.date ? ` <span class="muted">${o.date}</span>` : "") : "–"}</td></tr>`).join("") + "</tbody>";
  }
  $("#openFilter").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { openSt = b.dataset.s; openQs(); } });

  /* ---------- 기사 ---------- */
  function news(q = "") {
    q = q.trim().toLowerCase();
    const list = D.NEWS.filter((n) => !q || n[1].toLowerCase().includes(q));
    const byM = {};
    list.forEach((n) => (byM[n[0]] = byM[n[0]] || []).push(n));
    $("#newsList").innerHTML = Object.keys(byM).sort().reverse().map((m) => `<h3 style="font-size:14px;margin:14px 0 4px">${m.replace("-", ".")}</h3><ul style="margin:0;padding-left:18px">${byM[m].map((n) => `<li><a href="${n[2]}" target="_blank" rel="noopener">${esc(n[1])}</a></li>`).join("")}</ul>`).join("");
    $("#newsCount").textContent = `${list.length}건`;
  }
  $("#newsSearch").addEventListener("input", (e) => news(e.target.value));

  /* ---------- 실시간 뉴스 (네이버) ---------- */
  let LIVENEWS = [], liveQ = "아이씨에이치";
  const known = () => new Set([...D.NEWS.map((n) => n[2]), ...[...D.LOG, ...WEBLOG].map((l) => l.link).filter(Boolean)]);
  async function loadLiveNews() {
    $("#liveNews").innerHTML = `<p class="muted">불러오는 중…</p>`;
    try {
      const r = await fetch("/.netlify/functions/news?display=20&query=" + encodeURIComponent(liveQ)); const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      LIVENEWS = j.data; renderLiveNews();
    } catch (e) {
      $("#liveNews").innerHTML = `<p class="muted">뉴스 API 미연결 — Netlify 환경변수에 NAVER_CLIENT_ID / NAVER_CLIENT_SECRET을 넣으면 표시됩니다.</p>`;
    }
  }
  function renderLiveNews() {
    const K = known();
    $("#liveNews").innerHTML = LIVENEWS.length ? `<table><tbody>` + LIVENEWS.map((n, i) => {
      const isNew = !K.has(n.link) && !K.has(n.origin);
      return `<tr><td class="n" style="text-align:left;width:92px;color:var(--ink3)">${n.date}</td>
        <td><a href="${esc(n.origin)}" target="_blank" rel="noopener"><b>${esc(n.title)}</b></a> ${isNew ? '<span class="badge os-미확인">NEW</span>' : ""}
        <div class="muted" style="font-size:12.5px">${esc(n.desc).slice(0, 140)}</div></td>
        <td style="width:70px">${ADMIN && isNew ? `<button class="btn" data-addnews="${i}" style="padding:2px 8px;font-size:12px;white-space:nowrap">+ 기록</button>` : ""}</td></tr>`;
    }).join("") + `</tbody></table>` : `<p class="muted">검색 결과가 없습니다.</p>`;
  }
  $("#liveNewsQ").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; $$("#liveNewsQ button").forEach((x) => x.classList.toggle("on", x === b)); liveQ = b.dataset.q; loadLiveNews(); });
  $("#liveNews").addEventListener("click", async (e) => {
    const i = e.target.dataset && e.target.dataset.addnews; if (i == null) return;
    const n = LIVENEWS[+i]; e.target.disabled = true; e.target.textContent = "…";
    try {
      const r = await fetch("/.netlify/functions/notes", { method: "POST", headers: { "content-type": "application/json", "x-admin-token": ls.get("token", "") },
        body: JSON.stringify({ date: n.date, type: "기사", src: "ext", title: n.title, body: n.desc, link: n.origin, visibility: "public" }) });
      const j = await r.json(); if (!j.ok) throw new Error(j.error);
      await loadWebLog(); renderLiveNews();
    } catch (err) { e.target.textContent = "실패"; alert(err.message); }
  });

  /* ---------- 밸류 ---------- */
  function calc() {
    const p = +$("#cPrice").value, sh = +$("#cShares").value, eq = +$("#cEquity").value, gain = +$("#cGain").value, disc = +$("#cDisc").value, sales = +$("#cSales").value;
    const cap = (p * sh) / 1e8, bps = (eq * 1e8) / sh, adjEq = eq + gain * (1 - disc / 100);
    $("#oCap").textContent = fmt(cap) + "억"; $("#oBps").textContent = fmt(bps) + "원";
    $("#oPbr").textContent = fmt(cap / eq, 2) + "배"; $("#oPbr2").textContent = fmt(cap / adjEq, 2) + "배";
    $("#oPsr").textContent = fmt(cap / sales, 2) + "배"; $("#oP1").textContent = fmt(bps) + "원";
    $("#tPbr").textContent = fmt(cap / eq, 2) + "배";
  }
  let PEERLIVE = {};
  async function loadPeers() {
    const codes = D.PEERS.filter((p) => p[4] !== "live").map((p) => p[1]);
    const res = await Promise.all(codes.map((c) => fetch("/.netlify/functions/stock?type=price&code=" + c).then((r) => r.json()).catch(() => null)));
    let n = 0;
    res.forEach((j, i) => { if (j && j.ok) { PEERLIVE[codes[i]] = j.data; n++; } });
    if (n) $("#peerNote").textContent = `2025 실적은 고정, 시총·PER·PBR은 KIS 실시간 (${new Date().toLocaleString("ko-KR", { hour12: false })}). 우열 판단은 넣지 않음.`;
    peers();
  }
  function peers() {
    const cap = (LIVE.price * LIVE.shares) / 1e8, pbr = cap / D.META.equity;
    $("#peerTbl").innerHTML = "<thead><tr><th>회사</th><th class='n'>2025 매출</th><th class='n'>영업이익</th><th class='n'>OPM</th><th class='n'>시총(억)</th><th class='n'>PER</th><th class='n'>PBR</th><th class='n'>PSR</th><th>비교 이유</th></tr></thead><tbody>" +
      D.PEERS.map(([n, c, s, op, mc, per, pb, why]) => {
        const me = mc === "live", L = PEERLIVE[c];
        const m = me ? cap : L && L.marketCapEok ? L.marketCapEok : mc;
        const pv = me ? pbr : L && L.pbr ? L.pbr : pb;
        if (!me && L && L.per) per = L.per > 0 ? L.per : "적자";
        return `<tr${me ? ' style="background:#eef7f8;font-weight:600"' : ""}><td style="white-space:nowrap">${n} <span class="muted">${c}</span></td><td class="n">${fmt(s)}</td><td class="n ${op < 0 ? "neg" : ""}">${fmt(op)}</td><td class="n ${op < 0 ? "neg" : ""}">${fmt((op / s) * 100, 1)}%</td><td class="n">${fmt(m)}</td><td class="n">${typeof per === "number" ? fmt(per, 1) : per}</td><td class="n">${fmt(pv, 2)}</td><td class="n">${fmt(m / s, 2)}</td><td class="small muted">${esc(why)}</td></tr>`;
      }).join("") + "</tbody>";
  }

  /* ---------- 차트 ---------- */
  function drawChart(days) {
    const svg = $("#chart"), W = 640, H = 220, L = 46, R = 8, T = 10, B = 22;
    const data = DAILY.slice(-Math.round(days * 0.69));
    if (!data.length) { svg.innerHTML = `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="13" fill="#8a93a3">시세 API 연결 후 표시됩니다 (README 참고)</text>`; return; }
    const cs = data.map((d) => d.c), mn = Math.min(...cs) * 0.95, mx = Math.max(...cs) * 1.03;
    const x = (i) => L + ((W - L - R) * i) / (data.length - 1 || 1), y = (v) => T + (H - T - B) * (1 - (v - mn) / (mx - mn));
    let s = "";
    for (let k = 0; k <= 4; k++) { const v = mn + ((mx - mn) * k) / 4; s += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#eef0f3"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="10" fill="#8a93a3">${fmt(v)}</text>`; }
    const p = data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.c).toFixed(1)}`).join("");
    s += `<path d="${p} L${x(data.length - 1)},${H - B} L${L},${H - B}Z" fill="#0f7b8a" opacity=".08"/><path d="${p}" fill="none" stroke="#0f7b8a" stroke-width="2"/>`;
    [0, Math.floor(data.length / 2), data.length - 1].forEach((i) => { const d = data[i].d; s += `<text x="${x(i)}" y="${H - 6}" text-anchor="${i ? (i === data.length - 1 ? "end" : "middle") : "start"}" font-size="10" fill="#8a93a3">${d.slice(2, 4)}.${d.slice(4, 6)}.${d.slice(6)}</text>`; });
    // 누적 기록 중 미팅·공시 날짜를 차트에 점으로
    const marks = [...D.LOG, ...WEBLOG].filter((l) => l.type === "미팅" || l.type === "공시");
    marks.forEach((m) => {
      const key = m.date.replace(/-/g, ""); const i = data.findIndex((d) => d.d >= key);
      if (i >= 0) s += `<circle cx="${x(i)}" cy="${y(data[i].c)}" r="4" fill="${m.type === "미팅" ? "#d27a12" : "#2f6fd6"}" stroke="#fff" stroke-width="1.5"><title>${m.date} ${esc(m.title)}</title></circle>`;
    });
    svg.innerHTML = s;
  }
  function drawPBRBand() {
    const svg = $("#pbrBand"), W = 900, H = 260, L = 56, R = 110, T = 14, B = 26;
    const bps = (D.META.equity * 1e8) / (LIVE.shares || D.META.sharesEst);
    const mults = [0.5, 0.75, 1.0, 1.25], data = DAILY.slice(-250);
    const vals = data.map((d) => d.c).concat(mults.map((m) => bps * m), [LIVE.price]);
    const mn = Math.min(...vals) * 0.9, mx = Math.max(...vals) * 1.05, n = Math.max(data.length, 2);
    const x = (i) => L + ((W - L - R) * i) / (n - 1), y = (v) => T + (H - T - B) * (1 - (v - mn) / (mx - mn));
    let s = "";
    mults.forEach((m) => { const v = bps * m; s += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="${m === 1 ? "#16325c" : "#9aa6b6"}" stroke-dasharray="6 5"/><text x="${W - R + 6}" y="${y(v) + 4}" font-size="11.5" fill="#4a5260">${m}배 ${fmt(v)}원</text>`; });
    if (data.length) {
      s += `<path d="${data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.c).toFixed(1)}`).join("")}" fill="none" stroke="#0f7b8a" stroke-width="2"/>`;
      s += `<text x="${L}" y="${H - 6}" font-size="10.5" fill="#8a93a3">${data[0].d.slice(0, 4)}.${data[0].d.slice(4, 6)}</text><text x="${W - R}" y="${H - 6}" text-anchor="end" font-size="10.5" fill="#8a93a3">${data[data.length - 1].d.slice(0, 4)}.${data[data.length - 1].d.slice(4, 6)}</text>`;
    } else {
      s += `<circle cx="${W - R - 10}" cy="${y(LIVE.price)}" r="5" fill="#0f7b8a"/><text x="${W - R - 18}" y="${y(LIVE.price) - 8}" text-anchor="end" font-size="12" fill="#0f7b8a">현재 ${fmt(LIVE.price)}원</text><text x="${(L + W - R) / 2}" y="${H / 2}" text-anchor="middle" font-size="12" fill="#8a93a3">일봉은 시세 API 연결 후 표시</text>`;
    }
    svg.innerHTML = s;
  }

  /* ---------- KIS 시세 ---------- */
  async function loadPrice() {
    try {
      const r = await fetch("/.netlify/functions/stock?type=price", { cache: "no-store" });
      const j = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status} — 함수 응답이 JSON이 아님 (함수 미배포 가능)` }));
      if (!j.ok) throw new Error(j.error);
      const d = j.data;
      LIVE = { price: d.price, shares: d.shares || LIVE.shares, ok: true };
      $("#liveDot").classList.add("on");
      $("#liveLabel").textContent = "한국투자증권 실시간 · " + new Date(j.at).toLocaleString("ko-KR", { hour12: false });
      $("#qPrice").textContent = fmt(d.price) + "원";
      const arrow = d.change > 0 ? "▲" : d.change < 0 ? "▼" : "–";
      $("#qChg").innerHTML = `<span class="${signCls(d.change)}">${arrow} ${fmt(Math.abs(d.change))} (${d.changeRate > 0 ? "+" : ""}${fmt(d.changeRate, 2)}%)</span>`;
      $("#qCap").textContent = fmt(d.marketCapEok) + "억"; $("#qPbr").textContent = d.pbr ? fmt(d.pbr, 2) + "배" : "–";
      $("#qVol").textContent = fmt(d.volume); $("#qHi").textContent = fmt(d.w52High); $("#qLo").textContent = fmt(d.w52Low); $("#qSh").textContent = fmt(d.shares);
      $("#tCap").textContent = fmt(d.marketCapEok) + "억"; $("#tCapS").textContent = "KIS 실시간";
      $("#cPrice").value = d.price; if (d.shares) $("#cShares").value = d.shares;
    } catch (e) {
      $("#liveLabel").textContent = "오프라인 — 참고가 사용 (" + D.META.refPriceNote + ")";
      $("#qPrice").textContent = fmt(LIVE.price) + "원";
      $("#qChg").innerHTML = `<span class="small" style="color:#c0392b">시세 연결 실패: ${esc(String(e.message || e)).slice(0, 160)}</span>`;
      const cap = (LIVE.price * LIVE.shares) / 1e8;
      $("#qCap").textContent = fmt(cap) + "억"; $("#qPbr").textContent = fmt(cap / D.META.equity, 2) + "배"; $("#qSh").textContent = fmt(LIVE.shares) + " (추정)";
      $("#tCap").textContent = fmt(cap) + "억"; $("#tCapS").textContent = "참고가 기준 · 추정";
    }
    calc(); peers(); drawPBRBand();
  }
  async function loadDaily() {
    try { const r = await fetch("/.netlify/functions/stock?type=daily&days=400"); const j = await r.json(); if (!j.ok) throw new Error(j.error); DAILY = j.data; } catch (e) { DAILY = []; }
    drawChart(+$("#rangeSeg .on").dataset.d); drawPBRBand();
  }
  async function loadInvestor() {
    try {
      const r = await fetch("/.netlify/functions/stock?type=investor"); const j = await r.json(); if (!j.ok) throw new Error();
      const l5 = j.data.slice(0, 5), sum = (k) => l5.reduce((a, b) => a + (b[k] || 0), 0);
      $("#invBox").innerHTML = `최근 5거래일 순매수(주): 개인 <b class="${signCls(sum("indiv"))}">${fmt(sum("indiv"))}</b> · 외국인 <b class="${signCls(sum("foreign"))}">${fmt(sum("foreign"))}</b> · 기관 <b class="${signCls(sum("inst"))}">${fmt(sum("inst"))}</b> <span class="muted">· 차트 점: <span style="color:#d27a12">●</span> 미팅 <span style="color:#2f6fd6">●</span> 공시</span>`;
    } catch (e) { $("#invBox").innerHTML = ""; }
  }

  /* ---------- 목차 ---------- */
  function toc() {
    const links = $$("nav.toc a");
    const io = new IntersectionObserver((es) => es.forEach((en) => { if (en.isIntersecting) links.forEach((a) => a.classList.toggle("on", a.getAttribute("href") === "#" + en.target.id)); }), { rootMargin: "-40% 0px -55% 0px" });
    $$("section[id]").forEach((s) => io.observe(s));
  }

  /* ---------- 시작 ---------- */
  $("#cPrice").value = D.META.refPrice; $("#cShares").value = D.META.sharesEst; $("#cEquity").value = D.META.equity; $("#cSales").value = D.META.ttmSales;
  header(); overview(); items(); finance(); misc(); logs(); openQs(); news(); toc();
  ["cPrice", "cShares", "cEquity", "cGain", "cDisc", "cSales"].forEach((id) => $("#" + id).addEventListener("input", calc));
  $("#rangeSeg").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; $$("#rangeSeg button").forEach((x) => x.classList.toggle("on", x === b)); drawChart(+b.dataset.d); });
  calc(); peers(); drawChart(180); drawPBRBand();
  loadPrice(); loadDaily(); loadInvestor(); loadWebLog(); loadLiveNews(); loadPeers();
  setInterval(() => { const h = (new Date().getUTCHours() + 9) % 24; if (h >= 9 && h < 16) loadPrice(); }, 60000);
})();
