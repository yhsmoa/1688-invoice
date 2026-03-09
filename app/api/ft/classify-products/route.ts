import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';

// ============================================================
// Gemini API 설정
// ============================================================
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-2.5-flash-lite';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// ============================================================
// 분류 프롬프트 생성
// ============================================================
function buildClassificationPrompt(itemNames: string[]): string {
  const productList = itemNames
    .map((name, i) => `${i + 1}. ${name}`)
    .join('\n');

  return `
다음 제품들을 각각 분류해주세요.

**제품 목록:**
${productList}

**분류 카테고리 (다음 중 하나만 선택):**
- 티셔츠 (블라우스도 티셔츠로 분류, 그냥 '니트' 만 있는 경우도 티셔츠)
- 셔츠
- 바지
- 원피스
- 투피스 (쓰리피쓰도 투피스로 분류)
- 치마
- 자켓 (가디건도 자켓으로 분류)
- 가방
- 조끼
- 숄
- 장갑
- 앞치마
- 슬리퍼
- 머리핀
- 봉제 인형
- 체인
- 쿠션

**분류 규칙:**
1. 제품명에 "블라우스"가 포함되면 → 티셔츠
2. 제품명에 "쓰리피쓰"가 포함되면 → 투피스
3. 제품명에 "가디건"이 포함되면 → 자켓
4. 위 카테고리에 해당하지 않으면 → 알 수 없음

**출력 형식 (매우 중요):**
각 줄에 "번호|카테고리" 형식으로만 답변하세요.
예시:
1|티셔츠
2|바지
3|원피스

다른 설명은 절대 포함하지 마세요.
`;
}

// ============================================================
// Gemini API 호출
// ============================================================
async function callGemini(prompt: string): Promise<string> {
  const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API 오류 (${res.status}): ${errText}`);
  }

  const json = await res.json();
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini 응답이 비어 있습니다.');
  return text.trim();
}

// ============================================================
// 응답 파싱: "번호|카테고리" → Map<number, string>
// ============================================================
function parseClassificationResponse(text: string): Map<number, string> {
  const result = new Map<number, string>();
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split('|');
    if (parts.length === 2) {
      const num = parseInt(parts[0].trim(), 10);
      const category = parts[1].trim();
      if (!isNaN(num) && category) {
        result.set(num, category);
      }
    }
  }
  return result;
}

// ============================================================
// POST /api/ft/classify-products
// Body: { item_names: string[] }
//   → unique item_name 목록을 Gemini로 분류
//   → ft_order_items.customs_category 업데이트
//   → 업데이트된 건수 반환
// ============================================================
export async function POST(request: NextRequest) {
  try {
    if (!GEMINI_API_KEY) {
      return NextResponse.json(
        { success: false, error: 'GEMINI_API_KEY가 설정되지 않았습니다.' },
        { status: 500 }
      );
    }

    const body = await request.json();
    const { item_names } = body;

    if (!item_names || !Array.isArray(item_names) || item_names.length === 0) {
      return NextResponse.json(
        { success: false, error: '분류할 item_names가 없습니다.' },
        { status: 400 }
      );
    }

    // ── 1) Gemini 분류 요청 (50개씩 배치) ──
    const BATCH = 50;
    const classificationMap = new Map<string, string>(); // item_name → category

    for (let i = 0; i < item_names.length; i += BATCH) {
      const batch = item_names.slice(i, i + BATCH);
      const prompt = buildClassificationPrompt(batch);
      const response = await callGemini(prompt);
      const parsed = parseClassificationResponse(response);

      for (const [num, category] of parsed) {
        const idx = num - 1; // 1-based → 0-based
        if (idx >= 0 && idx < batch.length) {
          classificationMap.set(batch[idx], category);
        }
      }
    }

    // ── 2) ft_order_items 업데이트 (item_name 기준 일괄) ──
    let updateCount = 0;
    for (const [itemName, category] of classificationMap) {
      const { error, count } = await supabase
        .from('ft_order_items')
        .update({ customs_category: category })
        .eq('item_name', itemName)
        .is('customs_category', null);

      if (error) {
        console.error(`customs_category 업데이트 오류 (${itemName}):`, error);
      } else {
        updateCount += (count ?? 0);
      }
    }

    return NextResponse.json({
      success: true,
      classified: classificationMap.size,
      updated: updateCount,
      classifications: Object.fromEntries(classificationMap),
    });
  } catch (error) {
    console.error('classify-products 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: '품목 분류 중 오류가 발생했습니다.',
        details: (error as Record<string, unknown>)?.message ?? JSON.stringify(error),
      },
      { status: 500 }
    );
  }
}
