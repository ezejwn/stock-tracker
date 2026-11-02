const axios = require('axios');

exports.handler = async function (event, context) {
  const query = event.queryStringParameters.query || '주식';
  
  const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
  const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;

  if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "네이버 API 키가 설정되지 않았습니다." })
    };
  }

  try {
    const response = await axios.get('https://openapi.naver.com/v1/search/news.json', {
      params: {
        query: query,
        display: 5,
        sort: 'date'
      },
      headers: {
        'X-Naver-Client-Id': NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': NAVER_CLIENT_SECRET
      }
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(response.data.items)
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};