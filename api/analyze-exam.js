// Vercel Serverless Function: 시험지 이미지 분석
// POST /api/analyze-exam
// Body: { image: "data:image/jpeg;base64,..." }
// Response: { isMathExam: boolean, confidence: number, info: {...}, message: string }

export default async function handler(req, res) {
  // CORS (필요시)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { image } = req.body || {};

    if (!image || typeof image !== 'string') {
      return res.status(400).json({ error: '이미지가 필요합니다' });
    }

    // data URL에서 base64 부분만 추출
    // 형식: "data:image/jpeg;base64,/9j/4AAQ..."
    const match = image.match(/^data:(image\/(jpeg|jpg|png|webp));base64,(.+)$/);
    if (!match) {
      return res.status(400).json({ error: '지원하지 않는 이미지 형식입니다 (JPEG, PNG, WebP만 지원)' });
    }
    const mediaType = match[1];
    const base64Data = match[3];

    // 이미지 크기 제한 (Claude API는 base64 5MB 제한이지만 보수적으로 4MB)
    const sizeBytes = (base64Data.length * 3) / 4;
    if (sizeBytes > 4 * 1024 * 1024) {
      return res.status(400).json({ error: '이미지가 너무 큽니다 (4MB 이하로 업로드해주세요)' });
    }

    // 환경변수에서 API 키 가져오기
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error('ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다');
      return res.status(500).json({ error: '서버 설정 오류 (관리자 문의)' });
    }

    // Claude API 호출
    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mediaType,
                  data: base64Data
                }
              },
              {
                type: 'text',
                text: `이 이미지를 분석해서 한국 중·고등학교의 수학 시험지인지 판단해주세요.

다음 JSON 형식으로만 응답해주세요. 마크다운 코드블록(\`\`\`)은 사용하지 말고 순수 JSON만 출력해주세요:

{
  "isMathExam": true 또는 false,
  "confidence": 0~100 사이의 정수 (확신도),
  "subject": "수학" 또는 감지된 과목명 또는 null,
  "grade": "중1" / "중2" / "중3" / "고1" / "고2" / "고3" 중 하나 또는 null,
  "examType": "중간고사" / "기말고사" / "모의고사" / "연습문제" 등 또는 null,
  "schoolName": 시험지에 학교명이 보이면 학교명, 안 보이면 null,
  "questionCount": 검출된 대략적인 문항 수 (정수) 또는 null,
  "topics": ["감지된 단원명1", "단원명2"] 형태 배열, 없으면 [],
  "message": 사용자에게 보여줄 한국어 메시지 (1~2 문장)
}

판단 기준:
- 수학 기호(+, -, ×, ÷, =, √, ², ³, π, ∫ 등)나 수학 용어(방정식, 함수, 도형, 확률 등)가 포함된 한국 학교 시험지면 isMathExam: true
- 다른 과목(영어, 국어, 과학 등) 시험지면 isMathExam: false
- 시험지가 아닌 사진(풍경, 인물, 일반 문서 등)이면 isMathExam: false
- 흐릿하거나 글씨를 읽을 수 없으면 isMathExam: false 이고 message에 "사진이 흐릿해요. 다시 촬영해주세요" 같은 안내`
              }
            ]
          }
        ]
      })
    });

    if (!claudeResponse.ok) {
      const errText = await claudeResponse.text();
      console.error('Claude API 오류:', claudeResponse.status, errText);
      return res.status(502).json({
        error: 'AI 분석 서비스 오류',
        detail: claudeResponse.status === 401 ? 'API 키 인증 실패' : `상태 코드 ${claudeResponse.status}`
      });
    }

    const claudeData = await claudeResponse.json();
    const responseText = claudeData.content?.[0]?.text || '';

    // JSON 파싱 (마크다운 코드블록이 있을 수도 있어서 정리)
    let parsed;
    try {
      const cleaned = responseText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      console.error('Claude 응답 파싱 실패:', responseText);
      return res.status(502).json({
        error: 'AI 응답 형식 오류',
        rawResponse: responseText.substring(0, 200)
      });
    }

    // 결과 반환
    return res.status(200).json({
      isMathExam: !!parsed.isMathExam,
      confidence: parsed.confidence || 0,
      info: {
        subject: parsed.subject || null,
        grade: parsed.grade || null,
        examType: parsed.examType || null,
        schoolName: parsed.schoolName || null,
        questionCount: parsed.questionCount || null,
        topics: parsed.topics || []
      },
      message: parsed.message || (parsed.isMathExam ? '수학 시험지가 인식되었어요!' : '수학 시험지를 업로드 해주세요.')
    });

  } catch (error) {
    console.error('서버 오류:', error);
    return res.status(500).json({
      error: '분석 중 오류가 발생했습니다',
      detail: error.message
    });
  }
}

// Vercel 함수 설정 - 응답이 클 수 있으므로 타임아웃과 메모리 조정
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '8mb'  // 이미지 base64 + 여유분
    },
    responseLimit: '8mb'
  },
  maxDuration: 30  // Claude API 응답까지 30초 대기
};
