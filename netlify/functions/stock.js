const fetch = require('node-fetch');

exports.handler = async function(event, context) {
  const APP_KEY = process.env.KIS_APPKEY;
  const APP_SECRET = process.env.KIS_APPSECRET;
  const URL = "https://openapi.koreainvestment.com:9443";
  
  const stockCode = event.queryStringParameters.code || "005930";

  try {
    // 1. 한국투자증권 토큰 발급
    const tokenRes = await fetch(`${URL}/oauth2/tokenP`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        appkey: APP_KEY,
        appsecret: APP_SECRET
      })
    });
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "토큰 발급 실패", detail: tokenData })
      };
    }

    // 2. 주식 현재가 조회
    const priceRes = await fetch(`${URL}/uapi/domestic-stock/v1/quotations/inquire-price?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=${stockCode}`, {
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${accessToken}`,
        'appkey': APP_KEY,
        'appsecret': APP_SECRET,
        'tr_id': 'FHKST01010100'
      }
    });

    const priceData = await priceRes.json();

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(priceData.output)
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};