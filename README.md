# 매쓰홀릭 시험대비 (Matholic Exam)

AI 기반 수학 시험 예측 시스템 프로토타입 (B2C용)

## 🎯 주요 기능

- 학교/학년/시험 정보 입력
- **시험지 사진 촬영 → Claude AI가 수학 시험지 여부 자동 판별**
- AI 예측 시험 문제 생성 (10문항)
- 실제 시험 환경 (30분 타이머)
- 채점 결과 + 해설 제공
- 단원별/유형별 학습 분석 보고서 (개념/기본/실력/심화)
- 취약 유형 쌍둥이 문항 풀이

## 🚀 Vercel 배포 가이드

### 1. GitHub에 코드 업로드

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/matholic-exam.git
git push -u origin main
```

⚠️ **`.env` 파일은 절대 커밋하지 마세요!** (`.gitignore`에 이미 추가되어 있음)

### 2. Vercel에 임포트

1. https://vercel.com 접속 → 로그인
2. **Add New → Project** → GitHub 레포 선택
3. **Project Name**: `matholic-exam-b2c` 등 (이미 존재하면 다른 이름)
4. Framework Preset: **Other** (자동 감지됨)
5. Root Directory: 그대로 두기 (./)

### 3. 환경 변수 등록 (가장 중요!)

배포 전에 반드시 환경 변수를 추가하세요.

**Vercel 프로젝트 페이지 → Settings → Environment Variables**

| Name | Value | Environment |
|------|-------|-------------|
| `ANTHROPIC_API_KEY` | `sk-ant-api03-...` (발급받은 전체 키) | Production, Preview, Development 모두 체크 |

저장 후 **Deployments → 가장 최근 배포 → Redeploy** 클릭해서 새 환경변수 적용.

### 4. Claude API 키 발급 방법

1. https://console.anthropic.com 접속 → 가입 (Google 로그인 가능)
2. **Settings → Billing**에서 결제 카드 등록 + $10~$25 충전
3. **Settings → Limits**에서 월 사용 한도 설정 (권장: $50/월)
4. **API Keys → Create Key** → 이름 입력 → 생성된 키 복사
5. ⚠️ 키는 생성 시점에만 보이므로 즉시 안전한 곳에 보관

## 🔒 보안 주의사항

- **API 키를 절대 HTML, JS, GitHub에 직접 넣지 마세요**
- `index.html`의 카메라는 브라우저에서 동작하지만, **Claude API 호출은 항상 `/api/analyze-exam` 서버리스 함수를 거칩니다**
- 환경 변수는 Vercel 서버에서만 접근 가능하므로 사용자에게 노출되지 않습니다

## 💰 비용 안내

- Claude Sonnet 4.6 기준 시험지 1장 분석 시 약 **$0.01~$0.03** (이미지 크기에 따라)
- 학생 100명이 시험지 1장씩 업로드 = 약 $1~$3
- 사용량은 https://console.anthropic.com 에서 실시간 확인 가능

## 🧪 로컬 개발

```bash
# Vercel CLI 설치
npm i -g vercel

# 환경 변수 파일 생성 (.gitignore에 포함되어 있음)
echo 'ANTHROPIC_API_KEY="sk-ant-api03-..."' > .env

# 로컬 개발 서버 실행 (서버리스 함수 포함)
vercel dev
```

http://localhost:3000 으로 접속해서 테스트할 수 있습니다.

## 📁 프로젝트 구조

```
matholic-exam/
├── index.html              # 메인 앱 (모든 화면 포함)
├── api/
│   └── analyze-exam.js     # Claude API 프록시 (서버리스)
├── package.json
├── vercel.json             # Vercel 배포 설정
├── .gitignore              # API 키 보호
└── README.md
```

## ⚠️ 카메라 사용 시 주의사항

- **HTTPS 필수**: 카메라 API는 보안상 HTTPS에서만 동작 (Vercel 배포는 자동 HTTPS)
- **localhost 예외**: 로컬 개발 시 `localhost`는 HTTP여도 카메라 사용 가능
- **모바일**: iOS Safari 11+, Android Chrome 53+ 지원
- **권한 거부 시**: 파일 선택 버튼으로 갤러리에서 사진 업로드 가능

## 🛠️ 문제 해결

**"카메라 권한이 거부되었어요" 메시지**
→ 브라우저 주소창의 자물쇠 아이콘 클릭 → 카메라 권한 허용 → 새로고침

**"AI 분석 서비스 오류 (401)" 메시지**
→ Vercel 환경 변수의 API 키가 잘못되었거나 만료됨 → 새 키 발급 후 재배포

**"이미지가 너무 큽니다" 오류**
→ 코드에서 이미 1600px로 리사이즈하지만, 그래도 크면 화질을 더 낮추거나 카메라 해상도 조정
