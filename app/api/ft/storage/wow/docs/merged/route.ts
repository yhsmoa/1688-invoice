import { NextRequest, NextResponse } from 'next/server';
import { PDFDocument } from 'pdf-lib';
import { supabase } from '../../../../../../../lib/supabase';
import { fail, fetchIn, serverError } from '../../../storageShared';

export const dynamic = 'force-dynamic';

// ============================================================
// POST /api/ft/storage/wow/docs/merged — 와우 박스 서류 전체 인쇄용 (한 PDF 로 합침)
//
//   [서류준비] 탭의 [부착문서] / [동봉문서] 버튼 → 숨은 form 을 새 탭으로 제출
//     form 필드: kind = label | manifest, box_ids = 박스 id 를 쉼표로 (화면 순서 그대로)
//     (박스가 많으면 주소가 너무 길어지므로 GET 이 아니라 form POST)
//   → 박스마다 wow-docs 버킷의 PDF 를 받아 화면 순서대로 이어 붙여 inline 으로 돌려준다
//     브라우저 PDF 화면에서 한 번에 인쇄한다
//   그 서류가 없는 박스는 건너뛰고, 건너뛴 박스 수는 X-Wow-Skipped 헤더로 알린다
// ============================================================

const BUCKET = 'wow-docs';
/** 한 번에 합칠 수 있는 박스 수 — 서버 메모리 · 응답 시간 보호 */
const MAX_BOXES = 300;

interface DocBoxRow {
  id: string;
  order_number: string;
  box_no: number;
  label_path: string | null;
  manifest_path: string | null;
}

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const kind = String(form.get('kind') ?? '');
    const ids = String(form.get('box_ids') ?? '').split(',').map((s) => s.trim()).filter(Boolean);

    if (kind !== 'label' && kind !== 'manifest') return fail('kind(label|manifest) 가 필요합니다.');
    if (ids.length === 0) return fail('인쇄할 박스가 없습니다.');
    if (ids.length > MAX_BOXES) return fail(`한 번에 ${MAX_BOXES}박스까지 인쇄할 수 있습니다.`);

    // ── 박스 서류 경로 (요청 순서대로 다시 정렬) ──
    const rows = await fetchIn<DocBoxRow>(
      'ft_wow_boxes', 'id, order_number, box_no, label_path, manifest_path', 'id', ids);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const ordered = Array.from(new Set(ids)).map((id) => byId.get(id)).filter((r): r is DocBoxRow => !!r);

    const paths = ordered
      .map((r) => (kind === 'label' ? r.label_path : r.manifest_path))
      .filter((p): p is string => !!p);
    const skipped = ordered.length - paths.length + (ids.length - ordered.length);
    if (paths.length === 0) return fail('첨부된 서류가 없습니다.', 404);

    // ── 내려받기는 동시에, 이어 붙이기는 화면 순서대로 ──
    const files = await Promise.all(paths.map(async (path) => {
      const { data, error } = await supabase.storage.from(BUCKET).download(path);
      if (error || !data) throw error ?? new Error(`서류를 받지 못했습니다: ${path}`);
      return new Uint8Array(await data.arrayBuffer());
    }));

    const merged = await PDFDocument.create();
    for (const bytes of files) {
      const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const pages = await merged.copyPages(src, src.getPageIndices());
      pages.forEach((p) => merged.addPage(p));
    }
    const out = await merged.save();

    const fileName = `wow-${kind}-${paths.length}boxes.pdf`;
    return new NextResponse(Buffer.from(out), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${fileName}"`,
        'Cache-Control': 'no-store',
        'X-Wow-Skipped': String(skipped),
      },
    });
  } catch (error) {
    return serverError('와우출고 서류 합치기', error);
  }
}
