// 예약 실행 — 30분마다 네이버 증권 아이씨에이치 뉴스를 수집해 아카이브에 누적
// 일정은 netlify.toml의 [functions."news-collect"] schedule에서 정합니다.

const { getStore, collect } = require("../lib/newsfeed");

exports.handler = async function (event) {
  try {
    const r = await collect(getStore(event));
    console.log("news-collect", JSON.stringify(r));
    return { statusCode: 200, body: JSON.stringify(r) };
  } catch (e) {
    console.error("news-collect 실패", e);
    return { statusCode: 500, body: String(e.message || e) };
  }
};
