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
    await step("공시", async () => { W.notes = W.notes.concat(((await getJSON(API + "disclosures")).data || []).map((x) => ({ date: x.date, type: "공시", title: x.title, src: "dis" }))); });
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

  /* =================== 1-1) 수급 체크 (장중 자동 갱신) ===================
     체결강도 · VI · 코스닥/업종 · 분봉 급변 구간 · 투자자 → 번호 매긴 설명 + 기사 문장 */
  let F = null, fTimer = null, fLoading = false;
  const kstParts = () => { const d = new Date(Date.now() + 9 * 3600e3); return { dow: d.getUTCDay(), hm: d.getUTCHours() * 100 + d.getUTCMinutes() }; };
  const marketOpen = () => { const k = kstParts(); return k.dow >= 1 && k.dow <= 5 && k.hm >= 900 && k.hm < 1540; };
  const hhmm = (t) => (t ? `${t.slice(0, 2)}:${t.slice(2, 4)}` : "");
  const hanTime = (t) => (t ? `${+t.slice(0, 2)}시${+t.slice(2, 4) ? ` ${+t.slice(2, 4)}분` : ""}` : "");
  const secOf = (t) => (t ? +t.slice(0, 2) * 3600 + +t.slice(2, 4) * 60 + +(t.slice(4, 6) || 0) : 0);
  const sgn = (n, d = 2) => (n == null || isNaN(n) ? "–" : `${n > 0 ? "+" : ""}${fmt(n, d)}%`);
  const absf = (n, d = 2) => fmt(Math.abs(n), d);
  const strBand = (s) => (s < 10 ? `${Math.floor(s)}%대` : s < 1000 ? `${Math.floor(s / 10) * 10}%대` : `${fmt(s)}%`);
  const manju = (n) => { const a = Math.abs(n); return a >= 10000 ? `${fmt(a / 10000, a >= 100000 ? 0 : 1).replace(/\.0$/, "")}만주` : `${fmt(a)}주`; };

  async function loadFlow(force) {
    if (fLoading) return; fLoading = true;
    const box = $("#whyFlow");
    if (!F && box) box.innerHTML = `<div class="sflow"><p class="muted">수급 체크 불러오는 중… (체결강도·VI·업종·분봉·투자자)</p></div>`;
    try { F = (await getJSON(API + "stock?type=flow" + (force ? "&t=" + Date.now() : ""))).data; F.err = null; }
    catch (e) { F = Object.assign(F || {}, { err: e.message }); }
    fLoading = false;
    renderFlow();
  }
  function startFlowTimer() {
    stopFlowTimer();
    fTimer = setInterval(() => { if (!$("#whyBody").hidden && marketOpen() && !document.hidden) loadFlow(); }, 60e3);
  }
  function stopFlowTimer() { if (fTimer) clearInterval(fTimer); fTimer = null; }

  function buildFlow(f) {
    const P = f.price || {}, chg = P.changeRate, name = D.META.name;
    const kq = f.kosdaq && f.kosdaq.changeRate;
    const secOk = f.sector && !f.sector.notFound && f.sector.changeRate != null;
    const sec = secOk ? f.sector.changeRate : null, secName = f.sector && f.sector.name;
    const vol = P.volume, items = [];
    const W = { pre: "", ev: [], tail: [] }; // 기사 문장: 시장 → 장중 사건(시간순) → 체결강도·수급
    const down = chg < 0, dir = down ? "빠지" : "오르";
    const sw = f.swing ? (down ? f.swing.down : f.swing.up) : null;
    const swOk = sw && Math.abs(sw.chg) >= 2;
    const big = (v) => (Math.abs(v) >= 2 ? (v < 0 ? "급락" : "급등") : (v < 0 ? "약세" : "강세"));
    const verbed = (w) => (/약세|강세/.test(w) ? `${w}를 보인` : `${w}한`);

    // 1. 시장·업종
    const mkts = [kq != null ? ["코스닥", kq] : null, sec != null ? [`${secName} 업종`, sec] : null].filter(Boolean);
    if (chg != null && mkts.length) {
      const stats = mkts.map(([n, v]) => `${n}이 ${sgn(v)}`).join(", ");
      const same = mkts.filter(([, v]) => Math.sign(v) === Math.sign(chg) && Math.abs(v) >= 1);
      const opp = mkts.filter(([, v]) => Math.sign(v) === -Math.sign(chg) && Math.abs(v) >= 1);
      if (same.length) {
        const ref = same[same.length - 1][1];
        const rel = Math.abs(chg) > Math.abs(ref) * 1.3 ? `더 크게 ${down ? "빠진" : "오른"} 거예요` : Math.abs(chg) < Math.abs(ref) * 0.7 ? `오히려 덜 ${down ? "빠진" : "오른"} 편이에요` : `비슷하게 움직인 거예요`;
        items.push({ t: `시장 전체가 ${dir}는 날이에요`, b: `${stats} ${down ? "하락" : "상승"} 중이에요. ${name}(${sgn(chg)})만의 ${down ? "악재" : "호재"}라기보다 시장과 업종 전체가 ${down ? "밀리는" : "오르는"} 와중에 ${rel}.${swOk ? ` ${hhmm(sw.from)} ${down ? "급락" : "급등"}도 이 흐름 안에서 봐야 해요.` : ""}` });
        const mk = same.map(([n, v]) => `${n}(${sgn(v)})`);
        const w = same.length > 1 ? `동반 ${big(Math.sign(chg) * Math.min(...same.map(([, v]) => Math.abs(v))))}` : big(same[0][1]);
        W.pre = `${mk.join("과 ")}이 ${verbed(w)} 가운데,`;
      } else if (opp.length && Math.abs(chg) >= 2) {
        items.push({ t: `시장은 ${down ? "오르는데" : "빠지는데"} ${name}만 ${down ? "빠졌어요" : "올랐어요"}`, b: `${stats}인데 ${name}는 ${sgn(chg)}예요. 시장과 반대로 움직였으니 시장 탓은 아니에요. 종목 자체 이슈(공시·뉴스·테마·수급)를 먼저 확인해야 해요. 아래 '같은 시기 뉴스·기록'을 함께 보세요.` });
        const o = opp[0];
        W.pre = `${o[0]}(${sgn(o[1])})이 ${verbed(big(o[1]))} 가운데에도`;
      } else if (Math.abs(chg) >= 3) {
        items.push({ t: `시장은 조용한데 ${name}만 크게 움직였어요`, b: `${stats}로 시장 흐름과 다르게 ${name}만 ${sgn(chg)}예요. 시장 탓으로 쓰기는 어렵고, 종목 자체 이슈(공시·뉴스·수급)를 먼저 확인해야 해요. 아래 '같은 시기 뉴스·기록'을 함께 보세요.` });
        W.pre = `시장이 보합권에 머문 가운데,`;
      } else {
        items.push({ t: `시장과 비슷한 흐름이에요`, b: `${stats}이고 ${name}는 ${sgn(chg)}예요. 눈에 띄는 쏠림은 없어요.` });
      }
    }
    if (swOk) W.ev.push([sw.from, `${hanTime(sw.from)}경 ${down ? "매도" : "매수"} 물량이 몰리며 ${down ? "낙폭" : "상승폭"}을 키웠다.`]);

    // 장중 고점·저점 반납
    const prev = P.price != null && P.change != null ? P.price - P.change : null;
    if (prev && P.high && P.low && chg != null) {
      const hiPct = (P.high / prev - 1) * 100, loPct = (P.low / prev - 1) * 100;
      if (!down && hiPct - chg >= 3) {
        items.push({ t: `장중 고점에서 많이 내려왔어요`, b: `한때 ${sgn(hiPct)}(${fmt(P.high)}원)까지 올랐다가 지금은 ${sgn(chg)}예요. 오른 폭의 상당 부분을 되돌렸으니 "급등"만 쓰면 지금 상황과 안 맞아요.` });
        W.tail.push(`장중 한때 ${absf(hiPct, 1)}%까지 올랐으나 이후 상승폭을 ${chg / hiPct < 0.5 ? "상당 부분" : "일부"} 반납했다.`);
      } else if (down && chg - loPct >= 3) {
        items.push({ t: `장중 저점에서는 꽤 올라왔어요`, b: `한때 ${sgn(loPct)}(${fmt(P.low)}원)까지 밀렸다가 지금은 ${sgn(chg)}예요. 저가 매수가 일부 들어온 흐름이에요.` });
        W.tail.push(`장중 한때 ${absf(loPct, 1)}%까지 밀렸으나 이후 낙폭을 ${chg / loPct < 0.5 ? "상당 부분" : "일부"} 만회했다.`);
      }
    }

    // 2. VI
    const vis = (f.vi || []);
    if (vis.length) {
      const score = (x) => (/정적/.test(x.kind || "") ? 100 : 0) + Math.abs(x.dev || 0);
      const v = vis.slice().sort((x, y) => score(y) - score(x) || String(x.on).localeCompare(String(y.on)))[0];
      const rest = vis.filter((x) => x !== v);
      const kind = v.kind ? `${v.kind} ` : "";
      const dev = v.dev ? Math.abs(v.dev) : null;
      const base = v.base || null;
      const off = v.off && v.off !== "000000" ? v.off : null;
      const vUp = v.dev ? v.dev > 0 : !down;
      const near = swOk && secOf(v.on) >= secOf(sw.from) - 60 && secOf(v.on) <= secOf(sw.to) + 600;
      const restTxt = rest.length ? ` ${secOf(rest[0].on) < secOf(v.on) ? "이 밖에" : "이후"} ${rest.map((x) => `${hhmm(x.on)}(${x.kind || ""}${x.price ? ` ${fmt(x.price)}원` : ""})`).join(", ")}에도 VI가 걸렸다 풀렸어요${rest.every((x) => /동적/.test(x.kind || "")) ? " — 동적 VI는 짧은 시간 급하게 움직일 때 걸리는 거라 그 시각 전후 급변을 뜻해요" : ""}.` : "";
      items.push({ t: `VI(변동성완화장치)가 발동됐어요${vis.length > 1 ? ` (오늘 ${vis.length}번)` : ""}`,
        b: `${hhmm(v.on)}에 ${kind}VI가 걸렸${off ? `다가 ${hhmm(off)}에 해제됐어요` : "고, 아직 해제 전이에요"}. ${base && dev ? `기준가 ${fmt(base)}원에서 ${dev >= 1 ? Math.floor(dev) + "% 넘게" : absf(dev, 1) + "%"} ${vUp ? "오르" : "빠지"}면서${v.price ? `(발동가 ${fmt(v.price)}원)` : ""} 걸린 거고, ` : v.price ? `발동가는 ${fmt(v.price)}원이고, ` : ""}2분간 단일가 매매를 ${off ? "했어요" : "하는 중이에요"}.${near ? ` ${hhmm(sw.from)}~${hhmm(sw.to)}의 ${down ? "급락" : "급등"}과 거래량 급증${sw.share != null ? `(5분간 하루 거래량의 ${fmt(sw.share, 0)}%)` : ""}이 이 구간이에요.` : ""}${restTxt}` });
      const lvl = dev && base ? `${vUp ? "상승률" : "하락률"}이 ${Math.floor(dev)}%를 넘어서며 ` : "";
      const cnt = ["", "한", "두", "세", "네", "다섯"][rest.length] || rest.length;
      W.ev.push([v.on, `${lvl}변동성완화장치(VI)가 발동됐${off ? `다가 ${hanTime(off)} 해제됐다.` : "다."}${rest.length ? ` ${secOf(rest[0].on) < secOf(v.on) ? "이를 포함해 이날 VI는 모두 " + vis.length + "차례 발동됐다." : `이후 ${rest.every((x) => /동적/.test(x.kind || "")) ? "동적 VI가" : "VI가"} ${cnt} 차례 더 발동됐다.`}` : ""}`]);
    } else if (P.vi === "Y") {
      items.push({ t: "지금 VI가 걸려 있어요", b: "현재가 조회에 VI 적용 중으로 나와요. 2분간 단일가 매매 후 풀려요. 발동 시각은 VI 현황 조회가 실패해 못 가져왔어요." });
      W.tail.push("변동성완화장치(VI)가 발동됐다.");
    }

    // 3. 체결강도
    const s = f.ccnl && f.ccnl.strength;
    if (s != null) {
      const lvl = s < 30 ? "매우 낮은" : s < 80 ? "낮은" : s <= 120 ? "균형에 가까운" : s < 200 ? "높은" : "매우 높은";
      const side = s < 80 ? "매도 우위" : s > 120 ? "매수 우위" : "균형";
      const against = (side === "매도 우위" && !down) || (side === "매수 우위" && down);
      items.push({ t: against ? `주가는 ${down ? "빠졌지만" : "올랐지만"} 체결강도는 ${side}예요` : `체결강도 ${fmt(s, 2)}%면 ${side === "균형" ? "어느 쪽도 우위가 뚜렷하지 않아요" : side + "가 맞아요"}`,
        b: `체결강도는 매수 체결량을 매도 체결량으로 나눈 값이에요. 100%보다 낮으면 파는 쪽이, 높으면 사는 쪽이 더 적극적이라는 뜻인데, ${fmt(s, 2)}%는 ${lvl} 수준이에요. ${against ? `${down ? "빠진" : "오른"} 건 장 초반 일이고, 지금은 ${side === "매도 우위" ? "파는 쪽" : "사는 쪽"}이 더 적극적이라는 뜻이에요. "${down ? "매도세" : "매수세"}가 강했다"고 쓰면 이 숫자와 어긋나요.` : side === "매도 우위" ? '"매도세가 강했다"는 이 숫자로 뒷받침할 수 있어요.' : side === "매수 우위" ? '"매수세가 강했다"는 이 숫자로 뒷받침할 수 있어요.' : '"매도세/매수세가 강했다"고 쓰기엔 근거가 약해요.'}` });
      if (side !== "균형") W.tail.push(against ? `다만 체결강도는 ${strBand(s)}로 ${side}를 보이고 있다.` : `체결강도는 ${strBand(s)}로 ${side}가 뚜렷하다.`);
    }

    // 4. 투자자 수급
    const iv = f.investor;
    if (iv && f.isToday) {
      const pending = !iv.indiv && !iv.inst;
      const frNull = iv.foreign == null;
      const fr = iv.foreign || 0;
      const share = vol && !frNull ? Math.abs(fr) / vol * 100 : null;
      if (pending) {
        const small = share != null && share < 5;
        const bad = !frNull && ((down && fr < 0) || (!down && fr > 0));
        const frLine = frNull ? "외국인·개인·기관 모두 아직 집계 전이에요(빈 값)." : `오늘 외국인은 ${fr > 0 ? "+" : ""}${fmt(fr)}주예요.${vol ? ` 전체 거래량 ${fmt(vol)}주에 비하면 ${share < 5 ? "아주 작아요" : share < 15 ? "일부예요" : "적지 않아요"}(${fmt(share, 1)}%).` : ""} 개인과 기관이 0으로 나오는 건 매매를 안 해서가 아니에요.`;
        items.push({ warn: (bad && small) || frNull, t: bad && small ? `"외국인 ${down ? "매도로 하락" : "매수로 상승"}"은 쓰면 안 돼요` : `"누가 ${down ? "팔아서" : "사서"}"는 아직 쓰면 안 돼요`,
          b: `${frLine} 장중에는 집계가 안 돼서 그래요. 확정치는 장 마감 후에 나와요. 지금 단계에서는 누가 ${down ? "팔았는지" : "샀는지"} 말할 수 없어요.${f.investorPrev ? ` (참고: 전 거래일 ${toDash(f.investorPrev.d)} 개인 ${fmt(f.investorPrev.indiv)} · 외국인 ${fmt(f.investorPrev.foreign)} · 기관 ${fmt(f.investorPrev.inst)}주)` : ""}` });
      } else {
        const who = [["개인", iv.indiv], ["외국인", iv.foreign], ["기관", iv.inst]].filter(([, n]) => n);
        const sellers = who.filter(([, n]) => n < 0).sort((a, b) => a[1] - b[1]), buyers = who.filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
        const pctv = (n) => (vol ? `, 거래량의 ${fmt(Math.abs(n) / vol * 100, 0)}%` : "");
        const line = who.map(([k, n]) => `${k} ${n > 0 ? "+" : ""}${fmt(n)}주`).join(" · ");
        const main = down ? sellers[0] : buyers[0];
        const mainShare = main && vol ? Math.abs(main[1]) / vol * 100 : 0;
        items.push({ t: main && mainShare >= 10 ? `${main[0]} 순${down ? "매도" : "매수"}가 컸어요` : "수급 주체는 뚜렷하지 않아요",
          b: `${line}. ${main ? `${down ? "가장 많이 판 쪽은" : "가장 많이 산 쪽은"} ${main[0]}(${manju(main[1])}${pctv(main[1])})이에요. ` : ""}${main && mainShare >= 10 ? `"${main[0]} ${down ? "매도세" : "매수세"}"를 근거로 쓸 수 있어요.` : `거래량 대비 규모가 작아 특정 주체 때문이라고 쓰긴 어려워요.`} ${marketOpen() || kstParts().hm < 1800 ? "장 마감 직후 값은 잠정치라 저녁에 바뀔 수 있어요." : ""}` });
        if (main && mainShare >= 10) W.tail.push(`수급별로는 ${main[0]}이 ${manju(main[1])}를 순${down ? "매도" : "매수"}했다.`);
      }
    } else if (iv && !f.isToday) {
      items.push({ t: "오늘은 장이 열리지 않았어요", b: `마지막 거래일(${toDash(iv.d)}) 수급: 개인 ${fmt(iv.indiv)}주 · 외국인 ${fmt(iv.foreign)}주 · 기관 ${fmt(iv.inst)}주.` });
    }

    // 기사 문장 조립: 시장 → (이름) → 장중 사건 시간순 → 나머지
    const ev = W.ev.sort((a, b) => secOf(a[0]) - secOf(b[0])).map((x) => x[1]);
    let first = ev.shift();
    if (!first && chg != null && Math.abs(chg) >= 1) first = `전 거래일 대비 ${absf(chg)}% ${down ? "하락" : "상승"}한 ${fmt(P.price)}원에 거래되고 있다.`;
    const parts = [];
    if (first) parts.push(`${W.pre ? W.pre + " " : ""}${name}는 ${first}`);
    parts.push(...ev, ...W.tail);
    return { items, write: parts.join(" ") };
  }

  function renderFlow() {
    const box = $("#whyFlow"); if (!box) return;
    if (!F || (!F.price && F.err)) { box.innerHTML = `<div class="sflow"><p class="small" style="color:#c0392b">수급 체크를 못 불러왔어요 — ${esc(F && F.err)}</p></div>`; return; }
    const { items, write } = buildFlow(F);
    const live = marketOpen();
    const sw = F.swing;
    const facts = [
      F.ccnl && F.ccnl.strength != null ? `체결강도 ${fmt(F.ccnl.strength, 2)}%` : null,
      F.sector ? (F.sector.notFound ? `업종(${esc(F.sector.name || "-")}) 지수 미확인 — 코스닥만 반영` : `${esc(F.sector.name)} ${sgn(F.sector.changeRate)}`) : null,
      F.price && F.price.volume ? `거래량 ${fmt(F.price.volume)}주` : null,
      sw && sw.down ? `최대 5분 하락 ${hhmm(sw.down.from)}~${hhmm(sw.down.to)} ${sgn(sw.down.chg)}` : null,
      sw && sw.up ? `최대 5분 상승 ${hhmm(sw.up.from)}~${hhmm(sw.up.to)} ${sgn(sw.up.chg)}` : null,
      sw && sw.peakMinute ? `거래 최다 1분 ${hhmm(sw.peakMinute.t)} (${fmt(sw.peakMinute.share, 1)}%)` : null,
    ].filter(Boolean).join(" · ");
    box.innerHTML = `<div class="sflow">
      <div class="fh"><b>🔎 수급 체크 — 지금 주가 왜 이래요?</b>
        <span class="ctl">${live ? '<span class="live"></span>장중 1분마다 자동 갱신 · ' : "장 마감·휴장 — 자동 갱신 쉼 · "}기준 ${hhmm(F.kst)}<button id="flowRefresh">새로고침</button></span></div>
      ${items.length ? `<ol>${items.map((x) => `<li${x.warn ? ' class="warn"' : ""}><b class="t">${esc(x.t)}</b>${esc(x.b)}</li>`).join("")}</ol>` : '<p class="muted">설명할 만한 데이터가 아직 없어요.</p>'}
      ${write ? `<div class="write"><div class="lbl">이렇게 쓰시면 돼요 <button id="flowCopy">복사</button></div><span id="flowText">"${esc(write)}"</span></div>` : ""}
      <div class="facts">${facts}${F.errors && F.errors.length ? ` · <span style="color:#c0392b">못 불러온 항목: ${esc(F.errors.join(" / "))}</span>` : ""}${F.err ? ` · <span style="color:#c0392b">최근 갱신 실패: ${esc(F.err)}</span>` : ""}</div>
      <p class="facts" style="margin-top:4px">자동 문장은 숫자를 엮은 초안이에요. 원인을 확정하지 않으니 기사에 쓰기 전에 뉴스·공시를 함께 확인하세요.</p>
    </div>`;
    const rb = $("#flowRefresh"); if (rb) rb.onclick = () => loadFlow(true);
    const cb = $("#flowCopy"); if (cb) cb.onclick = async () => { try { await navigator.clipboard.writeText(write); cb.textContent = "복사됨"; } catch (e) { cb.textContent = "복사 실패"; } setTimeout(() => (cb.textContent = "복사"), 1500); };
    const h = $("#whyHint"); if (h && F.price) h.innerHTML = `오늘 ${pct(F.price.changeRate)}${F.ccnl && F.ccnl.strength != null ? ` · 체결강도 ${fmt(F.ccnl.strength, 0)}%` : ""}${(F.vi || []).length ? " · VI 발동" : ""} · 눌러서 이유 보기`;
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
  toggle($("#whyBtn"), $("#whyBody"), () => { loadWhy(); loadFlow(); startFlowTimer(); });
  toggle($("#aroundBtn"), $("#aroundBody"), loadAround);
  $("#moveFilter").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; moveFilter = b.dataset.f; $$("#moveFilter button").forEach((x) => x.classList.toggle("on", x === b)); if (W) renderWhy(); });
  $("#aroundTabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; aTab = b.dataset.t; $$("#aroundTabs button").forEach((x) => x.classList.toggle("on", x === b)); if (A) renderAround(); });
  // 오늘 등락을 버튼 옆에 미리 보여주기 (가벼운 현재가 1회)
  setTimeout(async () => { try { const p = (await getJSON(API + "stock?type=price")).data; const h = $("#whyHint"); if (h) h.innerHTML = `오늘 ${pct(p.changeRate)} · 눌러서 이유 보기`; } catch (e) {} }, 2500);
})();
