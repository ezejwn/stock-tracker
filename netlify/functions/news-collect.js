// 예약 실행 — 30분마다 아이씨에이치 기사(네이버 증권)와 공시(DART·네이버 증권)를 수집해 누적
// 일정은 netlify.toml의 [functions."news-collect"] schedule에서 정합니다.

const news = require("../lib/newsfeed");
const dart = require("../lib/disclosures");

exports.handler = async function (event) {
  const out = {};
  try { out.news = await news.collect(news.getStore(event)); } catch (e) { out.news = { error: String(e.message || e) }; }
  try { out.disclosures = await dart.collect(dart.getStore(event)); } catch (e) { out.disclosures = { error: String(e.message || e) }; }
  for (const k in out) delete out[k]._arc;
  console.log("news-collect", JSON.stringify(out));
  return { statusCode: 200, body: JSON.stringify(out) };
};
