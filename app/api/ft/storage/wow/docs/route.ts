import { NextRequest, NextResponse } from 'next/server';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { supabase } from '../../../../../../lib/supabase';
import { fail, serverError, fetchIn } from '../../storageShared';

export const dynamic = 'force-dynamic';

// ============================================================
// 와우 박스 서류(부착문서 label · 동봉문서 manifest) — 로켓이 private 버킷 wow-docs 에 올린 PDF
//
//   GET  ?box_id=&kind=label|manifest
//     박스 하나 → service role signed URL(10분)로 redirect. 화면은 링크를 새 탭으로 연다
//     (URL 이 만료돼도 다시 누르면 새로 발급)
//   POST { box_ids: string[], kind }
//     [전체 부착문서] · [전체 동봉문서] — 박스 여러 개의 서류를 받은 순서대로 한 PDF 로 합쳐 내려준다
//     서류가 아직 없는 박스는 건너뛴다. 하나도 없으면 404
//     순서지정한 박스(ship_seq)는 그 박스의 장마다 오른쪽 아래에 순서 배지(검은 동그라미 + 흰 숫자)를 찍는다
//       — 부착문서 · 동봉문서 · 운송장(택배엑셀 상품명 맨 앞)의 번호가 같아 서로 짝을 맞춘다
//       자리는 로켓(immongRK_scan rkShipDocs.js)의 도장과 같은 오른쪽 아래 · 가장자리 14pt
//       쿠팡 서류는 돌려 놓지 않은 쪽(rotation 0)이다 (2026-11-27 부착문서 288×432 · 동봉문서 595×842 확인)
// ============================================================

const BUCKET = 'wow-docs';
const SIGNED_URL_EXPIRES_IN = 600;
const MAX_BOXES = 500;
const DOWNLOAD_CONCURRENCY = 8;

type DocKind = 'label' | 'manifest';
interface BoxDocs { id: string; label_path: string | null; manifest_path: string | null; ship_seq: number | null }

// ── 순서 배지 (pt) ──
/** 동그라미 반지름 · 쪽 가장자리에서 띄우는 거리 */
const BADGE_RADIUS = 26;
const BADGE_MARGIN = 14;
/** 숫자 크기 — 동그라미 안쪽 너비(BADGE_TEXT_FIT)를 넘으면 들어갈 때까지 줄인다 (세 자리 번호) */
const BADGE_FONT_SIZE = 30;
const BADGE_TEXT_FIT = BADGE_RADIUS * 1.5;
/** Helvetica Bold 숫자의 높이 = 글자 크기의 0.72 (세로 가운데 맞춤용) */
const DIGIT_HEIGHT_RATIO = 0.72;

function drawSeqBadge(page: PDFPage, seq: number, font: PDFFont) {
  const box = page.getMediaBox();
  const cx = box.x + box.width - BADGE_MARGIN - BADGE_RADIUS;
  const cy = box.y + BADGE_MARGIN + BADGE_RADIUS;
  const text = String(seq);
  const size = Math.min(BADGE_FONT_SIZE, BADGE_FONT_SIZE * BADGE_TEXT_FIT / font.widthOfTextAtSize(text, BADGE_FONT_SIZE));

  page.drawCircle({ x: cx, y: cy, size: BADGE_RADIUS, color: rgb(0, 0, 0) });
  page.drawText(text, {
    x: cx - font.widthOfTextAtSize(text, size) / 2,
    y: cy - (size * DIGIT_HEIGHT_RATIO) / 2,
    size,
    font,
    color: rgb(1, 1, 1),
  });
}

const isKind = (v: unknown): v is DocKind => v === 'label' || v === 'manifest';
const pathOf = (box: BoxDocs | null | undefined, kind: DocKind) =>
  (kind === 'label' ? box?.label_path : box?.manifest_path) ?? null;

export async function GET(request: NextRequest) {
  const boxId = request.nextUrl.searchParams.get('box_id');
  const kind = request.nextUrl.searchParams.get('kind');
  if (!boxId || !isKind(kind)) return fail('box_id, kind(label|manifest) 가 필요합니다.');

  try {
    const { data: box, error } = await supabase
      .from('ft_wow_boxes')
      .select('id, label_path, manifest_path')
      .eq('id', boxId)
      .maybeSingle();
    if (error) throw error;
    const path = pathOf(box as BoxDocs | null, kind);
    if (!path) return fail('등록된 서류가 없습니다.', 404);

    const { data: signed, error: signErr } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_EXPIRES_IN);
    if (signErr) throw signErr;
    return NextResponse.redirect(signed.signedUrl);
  } catch (error) {
    return serverError('와우출고 서류 조회', error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { box_ids, kind } = await request.json();
    const ids = Array.isArray(box_ids) ? box_ids.filter((v): v is string => typeof v === 'string' && !!v) : [];
    if (ids.length === 0 || !isKind(kind)) return fail('box_ids, kind(label|manifest) 가 필요합니다.');
    if (ids.length > MAX_BOXES) return fail(`한 번에 ${MAX_BOXES}박스까지 받을 수 있습니다.`);

    // ── 받은 순서(화면 순서)대로 서류 경로 + 순서 번호 ──
    const boxes = await fetchIn<BoxDocs>('ft_wow_boxes', 'id, label_path, manifest_path, ship_seq', 'id', ids);
    const byId = new Map(boxes.map((b) => [b.id, b]));
    const docs: { path: string; seq: number | null }[] = [];
    for (const id of ids) {
      const box = byId.get(id);
      const path = pathOf(box, kind);
      if (path) docs.push({ path, seq: box?.ship_seq ?? null });
    }
    if (docs.length === 0) return fail('등록된 서류가 없습니다.', 404);

    // ── 내려받기 (몇 개씩 나눠서) → 순서대로 합치기 ──
    const files: ArrayBuffer[] = new Array(docs.length);
    for (let i = 0; i < docs.length; i += DOWNLOAD_CONCURRENCY) {
      await Promise.all(docs.slice(i, i + DOWNLOAD_CONCURRENCY).map(async ({ path }, j) => {
        const { data, error } = await supabase.storage.from(BUCKET).download(path);
        if (error) throw error;
        files[i + j] = await data.arrayBuffer();
      }));
    }
    const merged = await PDFDocument.create();
    const badgeFont = await merged.embedFont(StandardFonts.HelveticaBold);
    for (const [i, file] of files.entries()) {
      const src = await PDFDocument.load(file);
      const { seq } = docs[i];
      for (const page of await merged.copyPages(src, src.getPageIndices())) {
        merged.addPage(page);
        // 순서지정한 박스는 장마다 순서 배지 (동봉문서가 여러 장이면 장마다)
        if (seq !== null) drawSeqBadge(page, seq, badgeFont);
      }
    }

    return new NextResponse(Buffer.from(await merged.save()), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="wow-${kind}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return serverError('와우출고 서류 모아 받기', error);
  }
}
