// Vercel Serverless Function: 시험지 전체 분석 (문제별 정답/해설, 다중 페이지 지원)
// POST /api/analyze-paper
// Body: { images: ["data:image/jpeg;base64,...", ...] } (1~6장)
//   하위 호환: { image: "data:..." } 형식도 지원
// Response: { questions: [{ num, text, answer, explanation }, ...] }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    let { image, images } = req.body || {};

    // 하위 호환
    if (!images && image) images = [image];
    if (!images || !Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ error: '이미지가 필요합니다' });
    }
    if (images.length > 6) {
      return res.status(400).json({ error: '최대 6장까지만 업로드할 수 있어요' });
    }

    const imageBlocks = [];
    let totalSize = 0;
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      const match = img.match(/^data:(image\/(jpeg|jpg|png|webp));base64,(.+)$/);
      if (!match) {
        return res.status(400).json({ error: `${i+1}번째 이미지: 지원하지 않는 형식` });
      }
      const sizeBytes = (match[3].length * 3) / 4;
      totalSize += sizeBytes;
      if (sizeBytes > 4 * 1024 * 1024) {
        return res.status(400).json({ error: `${i+1}번째 이미지가 너무 커요 (4MB 이하)` });
      }
      imageBlocks.push({
        type: 'image',
        source: { type: 'base64', media_type: match[1], data: match[3] }
      });
    }

    if (totalSize > 20 * 1024 * 1024) {
      return res.status(400).json({ error: '전체 이미지 용량이 너무 커요 (총 20MB 이하)' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: '서버 설정 오류 (관리자 문의)' });
    }

    const userContent = [
      ...imageBlocks,
      {
        type: 'text',
        text: `이 ${images.length}개의 이미지는 한국 중·고등학교 수학 시험지의 ${images.length}개 페이지입니다. 페이지 순서대로 정리되어 있습니다. 모든 페이지의 문제를 종합해서 분석해주세요.

각 문제의 번호, 문제 본문, 정답, 풀이 해설을 추출해서 다음 JSON 형식으로 응답해주세요. 마크다운 코드블록(\`\`\`)은 사용하지 말고 순수 JSON만 출력해주세요:

{
  "questions": [
    {
      "num": 1,
      "text": "문제 본문 (선택지가 있으면 ①②③④⑤ 표기와 함께 포함)",
      "answer": "정답 (객관식이면 '③ 답내용' 형태, 주관식이면 답만)",
      "explanation": "풀이 과정과 해설을 2~4문장으로 간결하게",
      "page": 문제가 있는 페이지 번호 (1부터 시작)
    }
  ]
}

주의사항:
- 모든 페이지를 종합해서 1번 문제부터 마지막 문제까지 순서대로 추출하세요
- 같은 문제가 여러 페이지에 걸쳐있을 수 있으니 주의 (페이지 끝에 시작해서 다음 페이지로 이어지는 경우)
- 시험지에서 명확히 읽을 수 있는 문제만 추출
- 손글씨로 정답이 표시되어 있어도 무시하고 본인이 풀이해서 정답을 도출
- 수식은 가능한 한 유니코드 기호 사용 (×, ÷, ², ³, √, π, ≤, ≥, ≠ 등)
- 분수는 a/b 형태, 또는 가능하면 ½, ⅔ 등의 유니코드 사용
- 그림이나 도형이 필수인 문제는 텍스트로 도형 설명을 포함 (예: "삼각형 ABC에서 ∠A=90°일 때")
- 흐릿하거나 읽을 수 없는 문제는 questions 배열에서 제외
- 최대 30문제까지만 추출
- 해설은 풀이 단계가 보이도록 작성하되 너무 길지 않게 (학생이 빠르게 이해할 수 있도록)`
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
        max_tokens: 8192,
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
      count: parsed.questions.length,
      pageCount: images.length
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
