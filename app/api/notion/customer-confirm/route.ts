import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';

// ============================================================
// POST /api/notion/customer-confirm
//
// /import-product-v2 [고객확인] 모달 → 체크된 항목을 Notion DB 로 전송.
// (구 Google Sheets Apps Script sendSelectedRowToNotion 대체)
//
// 요청: multipart/form-data
//   - seller_code : string            → Notion '팀' select
//   - payload     : JSON string       → 항목 메타 배열 (아래 ItemPayload)
//   - file_<id>   : File (optional)   → 항목별 첨부 이미지
//
// 처리:
//   1. 첨부 이미지 → Supabase Storage 공개 버킷 업로드 → public URL
//   2. 항목당 Notion 페이지 1개 생성
//      - properties : 상품명/주문번호/팀/상태/수량/생성일시 (구 스크립트 호환)
//      - children   : 옵션 정보 + 이미지(좌 img_url / 우 첨부) + 확인 항목 + 사이트 링크
//   3. 항목별 성공/실패 집계 반환
//
// env: NOTION_API_KEY, NOTION_DATABASE_ID (서버 환경변수)
// ============================================================

// ── 상수 ──
const NOTION_API_URL = 'https://api.notion.com/v1/pages';
const NOTION_VERSION = '2022-06-28';
const STORAGE_BUCKET = 'customer-confirm';   // 첨부 이미지 공개 버킷

// ── 항목 메타 타입 (클라이언트 payload) ──
interface ItemPayload {
  id: string;
  item_no: string | null;
  item_name: string | null;
  option_name: string | null;
  china_option1: string | null;
  china_option2: string | null;
  order_no: string | null;
  order_qty: number | null;
  confirm_qty: string | null;   // 확인수량 (Notion '수량')
  arrival_qty: number | null;   // 입고개수 (참고용)
  img_url: string | null;
  site_url: string | null;
  attributes: string[];   // 한글 라벨 (기타는 "기타: ..." 형태)
  has_file: boolean;
}

// ── Storage 버킷 보장 (최초 1회) ──
let bucketEnsured = false;
async function ensureBucket(): Promise<void> {
  if (bucketEnsured) return;
  const { data } = await supabase.storage.getBucket(STORAGE_BUCKET);
  if (!data) {
    // 미존재 시 공개 버킷 생성 (Notion 이 외부 URL 로 이미지를 가져갈 수 있어야 함)
    const { error } = await supabase.storage.createBucket(STORAGE_BUCKET, { public: true });
    // 동시 요청 경합으로 이미 생성된 경우의 에러는 무시
    if (error && !/already exists/i.test(error.message)) {
      throw new Error(`Storage 버킷 생성 실패: ${error.message}`);
    }
  }
  bucketEnsured = true;
}

// ── 첨부 이미지 업로드 → public URL ──
async function uploadImage(itemId: string, file: File): Promise<string> {
  await ensureBucket();
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `${itemId}/${Date.now()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, buffer, { contentType: file.type || 'image/jpeg', upsert: true });

  if (error) throw new Error(`이미지 업로드 실패: ${error.message}`);

  return supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path).data.publicUrl;
}

// ── 외부 이미지 블록 ──
function imageBlock(url: string) {
  return {
    object: 'block',
    type: 'image',
    image: { type: 'external', external: { url } },
  };
}

// ── 페이지 본문(children) 구성 ──
function buildChildren(item: ItemPayload, attachedUrl: string | null) {
  const children: Record<string, unknown>[] = [];

  // 1) 옵션/식별 정보 (아이템번호 - 중국옵션1, 중국옵션2)
  const chinaOption = [item.china_option1, item.china_option2].filter(Boolean).join(', ');
  const infoText = `아이템번호: ${item.item_no || '-'}${chinaOption ? ` / 옵션: ${chinaOption}` : ''}`;
  children.push({
    object: 'block',
    type: 'paragraph',
    paragraph: { rich_text: [{ type: 'text', text: { content: infoText } }] },
  });

  // 2) 이미지 — 둘 다 있으면 2단(좌 img_url / 우 첨부), 하나면 단독 블록
  const left = item.img_url ? [imageBlock(item.img_url)] : [];
  const right = attachedUrl ? [imageBlock(attachedUrl)] : [];

  if (left.length > 0 && right.length > 0) {
    children.push({
      object: 'block',
      type: 'column_list',
      column_list: {
        children: [
          { object: 'block', type: 'column', column: { children: left } },
          { object: 'block', type: 'column', column: { children: right } },
        ],
      },
    });
  } else if (left.length > 0) {
    children.push(left[0]);
  } else if (right.length > 0) {
    children.push(right[0]);
  }

  // 3) 확인 항목 — 확인수량 + to_do 체크리스트
  const hasConfirmQty = item.confirm_qty != null && String(item.confirm_qty).trim() !== '';
  if (hasConfirmQty || item.attributes.length > 0) {
    children.push({
      object: 'block',
      type: 'heading_3',
      heading_3: { rich_text: [{ type: 'text', text: { content: '확인 항목' } }] },
    });
    // 확인수량 : n / 입고개수 m
    if (hasConfirmQty) {
      children.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{
            type: 'text',
            text: { content: `확인수량: ${item.confirm_qty} / 입고개수: ${item.arrival_qty ?? 0}` },
          }],
        },
      });
    }
    for (const attr of item.attributes) {
      children.push({
        object: 'block',
        type: 'to_do',
        to_do: { rich_text: [{ type: 'text', text: { content: attr } }], checked: false },
      });
    }
  }

  // 4) 사이트 링크
  if (item.site_url) {
    children.push({
      object: 'block',
      type: 'bookmark',
      bookmark: { url: String(item.site_url) },
    });
  }

  return children;
}

// ── Notion 페이지 생성 ──
async function createNotionPage(
  item: ItemPayload,
  sellerCode: string,
  attachedUrl: string | null,
  apiKey: string,
  databaseId: string,
  dateOnly: string,
): Promise<void> {
  // 상품명 = 상품명 + ", " + 옵션명 (구 스크립트 호환)
  const fullProductName =
    [item.item_name, item.option_name].filter(Boolean).join(', ') || '(상품명 없음)';

  // 수량/입고는 Notion Number 속성 → 숫자로 전송 (확인수량은 0 허용)
  const confirmNum =
    item.confirm_qty != null && String(item.confirm_qty).trim() !== ''
      ? Number(item.confirm_qty)
      : null;
  const arrivalNum = Number(item.arrival_qty ?? 0) || 0;

  const body = {
    parent: { database_id: databaseId },
    properties: {
      '상품명': { title: [{ text: { content: fullProductName } }] },
      // 주문번호 = 모달 카드 헤더의 아이템번호 (item_no)
      '주문번호': { rich_text: [{ text: { content: String(item.item_no ?? '') } }] },
      '팀': { select: { name: String(sellerCode) } },
      '상태': { select: { name: '확인요청' } },
      // 수량 = 입력한 확인수량 / 입고 = 입고개수 (Notion Number 속성)
      '수량': { number: confirmNum },
      '입고': { number: arrivalNum },
      '생성일시': { date: { start: dateOnly } },
    },
    children: buildChildren(item, attachedUrl),
  };

  const res = await fetch(NOTION_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Notion-Version': NOTION_VERSION,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const result = await res.json().catch(() => ({}));
    throw new Error(result.message || `Notion API 오류 (status ${res.status})`);
  }
}

export async function POST(request: NextRequest) {
  try {
    // ── env 검증 ──
    const apiKey = process.env.NOTION_API_KEY;
    const databaseId = process.env.NOTION_DATABASE_ID;
    if (!apiKey || !databaseId) {
      return NextResponse.json(
        { success: false, error: 'NOTION_API_KEY / NOTION_DATABASE_ID 환경변수가 설정되지 않았습니다.' },
        { status: 500 }
      );
    }

    // ── multipart 파싱 ──
    const formData = await request.formData();
    const sellerCode = String(formData.get('seller_code') || '');
    const payloadRaw = formData.get('payload');

    if (!payloadRaw || typeof payloadRaw !== 'string') {
      return NextResponse.json(
        { success: false, error: 'payload 가 필요합니다.' },
        { status: 400 }
      );
    }

    let items: ItemPayload[];
    try {
      items = JSON.parse(payloadRaw);
    } catch {
      return NextResponse.json(
        { success: false, error: 'payload 파싱에 실패했습니다.' },
        { status: 400 }
      );
    }

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { success: false, error: '전송할 항목이 없습니다.' },
        { status: 400 }
      );
    }

    // ── 생성일시 (KST 기준 YYYY-MM-DD) ──
    const dateOnly = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());

    // ── 항목별 처리 (순차 — Notion rate limit 안전) ──
    let created = 0;
    const failed: { item_no: string; error: string }[] = [];

    for (const item of items) {
      try {
        // 첨부 이미지 업로드 (있을 때만)
        let attachedUrl: string | null = null;
        const file = formData.get(`file_${item.id}`);
        if (file && file instanceof File && file.size > 0) {
          attachedUrl = await uploadImage(item.id, file);
        }

        await createNotionPage(item, sellerCode, attachedUrl, apiKey, databaseId, dateOnly);
        created += 1;
      } catch (err) {
        console.error(`Notion 페이지 생성 실패 (${item.item_no}):`, err);
        failed.push({
          item_no: item.item_no || item.id,
          error: err instanceof Error ? err.message : '알 수 없는 오류',
        });
      }
    }

    return NextResponse.json({ success: true, created, failed });
  } catch (error) {
    console.error('customer-confirm 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Notion 저장 중 오류가 발생했습니다.',
        details: (error as Record<string, unknown>)?.message ?? JSON.stringify(error),
      },
      { status: 500 }
    );
  }
}
