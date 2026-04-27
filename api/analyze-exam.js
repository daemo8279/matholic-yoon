// Vercel Serverless Function: 시험지 이미지 분석 (다중 페이지 지원)
// POST /api/analyze-exam
// Body: { images: ["data:image/jpeg;base64,...", ...] } (1~6장)
//   하위 호환: { image: "data:..." } 형식도 지원
// Response: { isMathExam, confidence, info, message }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    let { image, images } = req.body || {};

    // 하위 호환: 단일 image 필드도 처리
    if (!images && image) images = [image];
    if (!images || !Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ error: '이미지가 필요합니다' });
    }
    if (images.length > 6) {
      return res.status(400).json({ error: '최대 6장까지만 업로드할 수 있어요' });
    }

    // 각 이미지 파싱
    const imageBlocks = [];
    let totalSize = 0;
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      if (typeof img !== 'string') {
        return res.status(400).json({ error: `${i+1}번째 이미지 형식이 잘못됐어요` });
      }
      const match = img.match(/^data:(image\/(jpeg|jpg|png|webp));base64,(.+)$/);
      if (!match) {
        return res.status(400).json({ error: `${i+1}번째 이미지: 지원하지 않는 형식 (JPEG, PNG, WebP만)` });
      }
      const mediaType = match[1];
      const base64Data = match[3];
      const sizeBytes = (base64Data.length * 3) / 4;
      totalSize += sizeBytes;
      if (sizeBytes > 4 * 1024 * 1024) {
        return res.status(400).json({ error: `${i+1}번째 이미지가 너무 커요 (4MB 이하)` });
      }
      imageBlocks.push({
        type: 'image',
        source: { type: 'base64', media_type: mediaType, data: base64Data }
      });
    }

    if (totalSize > 20 * 1024 * 1024) {
      return res.status(400).json({ error: '전체 이미지 용량이 너무 커요 (총 20MB 이하)' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error('ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다');
      return res.status(500).json({ error: '서버 설정 오류 (관리자 문의)' });
    }

    const userContent = [
      ...imageBlocks,
      {
        type: 'text',
        text: `이 ${images.length}개의 이미지는 한국 중·고등학교 수학 시험지의 ${images.length}개 페이지입니다. 페이지들을 종합적으로 분석해서 수학 시험지인지 판단해주세요.

다음 JSON 형식으로만 응답해주세요. 마크다운 코드블록(\`\`\`)은 사용하지 말고 순수 JSON만 출력해주세요:

{
  "isMathExam": true 또는 false,
  "confidence": 0~100 사이의 정수,
  "subject": "수학" 또는 감지된 과목명 또는 null,
  "grade": "중1" / "중2" / "중3" / "고1" / "고2" / "고3" 중 하나 또는 null,
  "examType": "중간고사" / "기말고사" / "모의고사" / "연습문제" 등 또는 null,
  "schoolName": 시험지에 학교명이 보이면 학교명, 안 보이면 null,
  "questionCount": 모든 페이지를 합친 대략적인 문항 수 (정수) 또는 null,
  "topics": ["감지된 단원명1", "단원명2"] 형태 배열,
  "message": 사용자에게 보여줄 한국어 메시지 (1~2문장)
}

판단 기준:
- 여러 페이지 중 하나라도 수학 시험지의 일부면 isMathExam: true
- 수학 기호(+, -, ×, ÷, =, √, ², ³, π, ∫ 등)나 수학 용어(방정식, 함수, 도형, 확률 등)가 한 페이지라도 있으면 수학 시험지로 인정
- 다른 과목(영어, 국어, 과학) 시험지나 일반 사진(풍경, 인물 등)만 있으면 isMathExam: false
- 일부 페이지가 흐릿해도 다른 페이지가 선명하면 인정
- 페이지가 시험지 같지만 모두 흐릿해서 읽을 수 없으면 isMathExam: false`
      }
    ];

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
        messages: [{ role: 'user', content: userContent }]
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

    return res.status(200).json({
      isMathExam: !!parsed.isMathExam,
      confidence: parsed.confidence || 0,
      info: {
        subject: parsed.subject || null,
        grade: parsed.grade || null,
        examType: parsed.examType || null,
        schoolName: parsed.schoolName || null,
        questionCount: parsed.questionCount || null,
        topics: parsed.topics || [],
        pageCount: images.length
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

export const config = {
  api: {
    bodyParser: { sizeLimit: '32mb' },
    responseLimit: '8mb'
  },
  maxDuration: 60
};
