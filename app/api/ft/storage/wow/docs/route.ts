import { NextRequest, NextResponse } from 'next/server';
import { PDFDocument } from 'pdf-lib';
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
// ============================================================

const BUCKET = 'wow-docs';
const SIGNED_URL_EXPIRES_IN = 600;
const MAX_BOXES = 500;
const DOWNLOAD_CONCURRENCY = 8;

type DocKind = 'label' | 'manifest';
interface BoxDocs { id: string; label_path: string | null; manifest_path: string | null }

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

    // ── 받은 순서(화면 순서)대로 서류 경로 ──
    const boxes = await fetchIn<BoxDocs>('ft_wow_boxes', 'id, label_path, manifest_path', 'id', ids);
    const byId = new Map(boxes.map((b) => [b.id, b]));
    const paths = ids.map((id) => pathOf(byId.get(id), kind)).filter((p): p is string => !!p);
    if (paths.length === 0) return fail('등록된 서류가 없습니다.', 404);

    // ── 내려받기 (몇 개씩 나눠서) → 순서대로 합치기 ──
    const files: ArrayBuffer[] = new Array(paths.length);
    for (let i = 0; i < paths.length; i += DOWNLOAD_CONCURRENCY) {
      await Promise.all(paths.slice(i, i + DOWNLOAD_CONCURRENCY).map(async (path, j) => {
        const { data, error } = await supabase.storage.from(BUCKET).download(path);
        if (error) throw error;
        files[i + j] = await data.arrayBuffer();
      }));
    }
    const merged = await PDFDocument.create();
    for (const file of files) {
      const src = await PDFDocument.load(file);
      (await merged.copyPages(src, src.getPageIndices())).forEach((page) => merged.addPage(page));
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
