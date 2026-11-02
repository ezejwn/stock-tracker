import os
import requests
from dotenv import load_dotenv

# .env 파일 로드
load_dotenv()

APP_KEY = os.getenv("KIS_APPKEY")
APP_SECRET = os.getenv("KIS_APPSECRET")
ACCOUNT_NO = os.getenv("KIS_ACCOUNT_NO")

# 키 불러오기 확인
print("APP Key 로드 성공 여부:", bool(APP_KEY))

# 한국투자증권 토큰 발급 요청 (실전투자 서버)
URL = "https://openapi.koreainvestment.com:9443"

headers = {"content-type": "application/json"}
body = {
    "grant_type": "client_credentials",
    "appkey": APP_KEY,
    "appsecret": APP_SECRET
}

response = requests.post(f"{URL}/oauth2/tokenP", headers=headers, json=body)

if response.status_code == 200:
    access_token = response.json().get("access_token")
    print("토큰 발급 성공!")
    print("Access Token:", access_token)
else:
    print("토큰 발급 실패:", response.json())