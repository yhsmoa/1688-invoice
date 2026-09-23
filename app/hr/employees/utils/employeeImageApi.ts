// ============================================================
// 직원 이미지 — 브라우저 쪽 준비(압축·미리보기) + 이미지 API 호출
//   서버: app/api/hr/employees/[id]/images/route.ts
// ============================================================
import { compressImage } from '../../../../lib/compressImage';
import { IMAGE_KINDS, type ImageKind } from './employeeFields';

/** 저장 전 대기 중인 새 이미지 — previewUrl 은 object URL (다 쓰면 revoke) */
export interface PendingImage {
  file: File;
  previewUrl: string;
}

/** 저장 시 적용할 변경 — 새 이미지 또는 삭제 */
export type ImageChange = PendingImage | 'remove';
export type ImageChanges = Partial<Record<ImageKind, ImageChange>>;

export type ImageUrls = Record<ImageKind, string | null>;
export const EMPTY_IMAGE_URLS: ImageUrls = { photo: null, id_front: null, id_back: null };

// ── 선택한 파일 → 압축 + 미리보기 (실패 시 ImageCompressError 등 throw) ──
export async function prepareImage(source: File): Promise<PendingImage> {
  const { file } = await compressImage(source);
  return { file, previewUrl: URL.createObjectURL(file) };
}

export function releasePreview(change: ImageChange | undefined) {
  if (change && change !== 'remove') URL.revokeObjectURL(change.previewUrl);
}

// ── signed URL 조회 ──
export async function fetchEmployeeImageUrls(employeeId: string): Promise<ImageUrls> {
  const res = await fetch(`/api/hr/employees/${employeeId}/images`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'image fetch failed');
  return { ...EMPTY_IMAGE_URLS, ...json.data };
}

// ── 변경 적용 — 종류별로 순서대로 처리하고, 실패한 종류 목록을 돌려준다 ──
//   한 장이 실패해도 나머지는 계속 저장한다 (이미 성공한 것을 되돌리지 않음)
export async function applyImageChanges(employeeId: string, changes: ImageChanges): Promise<ImageKind[]> {
  const failed: ImageKind[] = [];

  for (const kind of IMAGE_KINDS) {
    const change = changes[kind];
    if (!change) continue;
    try {
      const res =
        change === 'remove'
          ? await fetch(`/api/hr/employees/${employeeId}/images?kind=${kind}`, { method: 'DELETE' })
          : await fetch(`/api/hr/employees/${employeeId}/images`, {
              method: 'POST',
              body: (() => {
                const form = new FormData();
                form.append('kind', kind);
                form.append('file', change.file);
                return form;
              })(),
            });
      const json = await res.json();
      if (!json.success) {
        console.error(`직원 이미지 저장 실패 (${kind}):`, json.error, json.details);
        failed.push(kind);
      }
    } catch (err) {
      console.error(`직원 이미지 저장 오류 (${kind}):`, err);
      failed.push(kind);
    }
  }

  return failed;
}
