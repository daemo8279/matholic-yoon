// Vercel Serverless Function: 시험지 전체 분석 (문제별 정답/해설)
// POST /api/analyze-paper
// Body: { image: "data:image/jpeg;base64,..." }
// Response: { questions: [{ num, text, answer, explanation }, ...] }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { image } = req.body || {};
    if (!image || typeof image !== 'string') {
      return res.status(400).json({ error: '이미지가 필요합니다' });
    }

    const match = image.match(/^data:(image\/(jpeg|jpg|png|webp));base64,(.+)$/);
    if (!match) {
      return res.status(400).json({ error: '지원하지 않는 이미지 형식입니다' });
    }
    const mediaType = match[1];
    const base64Data = match[3];

    const sizeBytes = (base64Data.length * 3) / 4;
    if (sizeBytes > 4 * 1024 * 1024) {
      return res.status(400).json({ error: '이미지가 너무 큽니다 (4MB 이하)' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: '서버 설정 오류 (관리자 문의)' });
    }

    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
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
                text: `이 한국 중·고등학교 수학 시험지를 자세히 분석해주세요.

각 문제의 번호, 문제 본문, 정답, 풀이 해설을 추출해서 다음 JSON 형식으로 응답해주세요. 마크다운 코드블록(\`\`\`)은 사용하지 말고 순수 JSON만 출력해주세요:

{
  "questions": [
    {
      "num": 1,
      "text": "문제 본문 (선택지가 있으면 ①②③④⑤ 표기와 함께 포함)",
      "answer": "정답 (객관식이면 '③ 답내용' 형태, 주관식이면 답만)",
      "explanation": "풀이 과정과 해설을 2~4문장으로 간결하게"
    }
  ]
}

주의사항:
- 시험지에서 명확히 읽을 수 있는 문제만 추출하세요
- 손글씨로 정답이 표시되어 있어도 무시하고 본인이 풀이해서 정답을 도출하세요
- 수식은 가능한 한 유니코드 기호 사용 (×, ÷, ², ³, √, π, ≤, ≥, ≠ 등)
- 분수는 a/b 형태, 또는 가능하면 ½, ⅔ 등의 유니코드 사용
- 그림이나 도형이 필수인 문제는 텍스트로 도형 설명을 포함 (예: "삼각형 ABC에서 ∠A=90°일 때")
- 흐릿하거나 읽을 수 없는 문제는 questions 배열에서 제외하세요
- 최대 25문제까지만 추출 (시험지에 더 많아도 처음 25문제만)
- 해설은 풀이 단계가 보이도록 작성하되 너무 길지 않게 (학생이 빠르게 이해할 수 있도록)`
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

    let parsed;
    try {
      const cleaned = responseText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      console.error('Claude 응답 파싱 실패:', responseText.substring(0, 500));
      return res.status(502).json({
        error: 'AI 응답 형식 오류',
        rawResponse: responseText.substring(0, 200)
      });
    }

    if (!parsed.questions || !Array.isArray(parsed.questions) || parsed.questions.length === 0) {
      return res.status(422).json({
        error: '문제를 추출할 수 없었어요',
        detail: '시험지가 흐릿하거나 글씨가 잘 보이지 않아요. 더 선명한 사진으로 다시 시도해주세요.'
      });
    }

    return res.status(200).json({
      questions: parsed.questions,
      count: parsed.questions.length
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
    bodyParser: { sizeLimit: '8mb' },
    responseLimit: '8mb'
  },
  maxDuration: 60  // 시험지 전체 분석은 시간이 더 걸림
};
