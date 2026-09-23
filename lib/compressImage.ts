// ============================================================
// 첨부 이미지 압축 — 업로드 전에 브라우저에서 JPEG 로 줄인다
//
// 사용처: 상품입고 고객확인 첨부(V2CustomerConfirmModal), 직원관리 사진·신분증(hr/employees)
//
// 배경:
//   고객확인 첨부 사진이 원본 PNG(장당 11~18MB) 그대로 올라가서, 느린 회선에서
//   한 장에 2분 가까이 걸리고 1시간에 수백 MB 를 쓰는 문제가 있었다.
//   (2026-09-14 18시대 16장 222MB + 중간에 끊긴 재업로드 6건)
//
// 규칙:
//   1. 이미 목표 용량 이하인 파일은 원본 그대로 사용 (다시 인코딩하면 화질만 손해)
//   2. 긴 변을 MAX_EDGE 이하로 축소 (확대는 하지 않음)
//   3. JPEG 품질을 QUALITY_STEPS 순서로 낮춰 가며 TARGET_BYTES 이하가 되면 멈춘다
//   4. 최저 품질로도 넘으면 크기를 EDGE_SHRINK 비율로 줄여 다시 시도 (MIN_EDGE 까지)
//   5. 투명 PNG 는 흰 배경 위에 그린다 (JPEG 는 투명도가 없어 검게 나오는 것 방지)
//   6. 휴대폰 사진의 EXIF 회전을 반영해 디코딩한다
//   7. 브라우저가 해석하지 못하는 형식(HEIC 등)은 오류로 알린다 —
//      원본을 대신 올리지 않는다 (용량 문제 재발 + Notion 에서도 표시되지 않음)
// ============================================================

// ── 압축 기준값 ──
/** 목표 용량 — 이 이하가 되면 멈춘다 */
export const TARGET_BYTES = 500 * 1024;
/** 긴 변 최대 픽셀 — 상품 불량·라벨 글씨 확인에 충분한 크기 */
export const MAX_EDGE = 1600;
/** 크기 재축소 하한 — 이보다 작게는 줄이지 않는다 */
const MIN_EDGE = 1000;
/** 품질로 목표를 못 맞췄을 때 긴 변 축소 비율 */
const EDGE_SHRINK = 0.8;
/** JPEG 품질 단계 (높은 순) */
const QUALITY_STEPS = [0.85, 0.75, 0.65, 0.55] as const;
/** 출력 형식 */
const OUTPUT_TYPE = 'image/jpeg';

export interface CompressResult {
  /** 업로드할 파일 (압축본 또는 이미 작은 원본) */
  file: File;
  originalBytes: number;
  outputBytes: number;
  /** 압축을 실제로 했는지 (false = 원본 그대로) */
  compressed: boolean;
}

/** 사용자에게 그대로 보여줄 메시지를 담는 오류 */
export class ImageCompressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageCompressError';
  }
}

// ============================================================
// 디코딩 — EXIF 회전 반영. createImageBitmap 우선, 미지원 시 <img> 로
// ============================================================
type Decoded = { source: CanvasImageSource; width: number; height: number; release: () => void };

async function decodeImage(file: File): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      // 일부 브라우저는 옵션을 지원하지 않거나 형식을 못 읽는다 → <img> 경로로 재시도
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => undefined };
  } catch {
    throw new ImageCompressError(
      `이미지를 읽을 수 없습니다 (${file.type || file.name}).\nJPG 또는 PNG 로 저장한 뒤 다시 첨부해주세요.`,
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ── 캔버스 → JPEG Blob ──
function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new ImageCompressError('이미지 변환에 실패했습니다.'))),
      OUTPUT_TYPE,
      quality,
    );
  });
}

// ── 지정한 긴 변으로 그린 캔버스 ──
function drawScaled(decoded: Decoded, maxEdge: number): HTMLCanvasElement {
  const scale = Math.min(1, maxEdge / Math.max(decoded.width, decoded.height));
  const width = Math.max(1, Math.round(decoded.width * scale));
  const height = Math.max(1, Math.round(decoded.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ImageCompressError('브라우저에서 이미지 처리를 지원하지 않습니다.');

  ctx.fillStyle = '#ffffff';            // 투명 영역 → 흰색
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(decoded.source, 0, 0, width, height);
  return canvas;
}

/** 확장자를 .jpg 로 바꾼 파일명 */
function toJpegName(name: string): string {
  const base = name.replace(/\.[^./\\]+$/, '') || 'image';
  return `${base}.jpg`;
}

// ============================================================
// 메인
// ============================================================
export async function compressImage(file: File): Promise<CompressResult> {
  if (!file.type.startsWith('image/') && file.type !== '') {
    throw new ImageCompressError('이미지 파일만 첨부할 수 있습니다.');
  }

  // ── 1) 이미 작으면 원본 그대로 ──
  if (file.size <= TARGET_BYTES) {
    return { file, originalBytes: file.size, outputBytes: file.size, compressed: false };
  }

  const decoded = await decodeImage(file);
  try {
    let edge = Math.min(MAX_EDGE, Math.max(decoded.width, decoded.height));
    let best: Blob | null = null;

    // ── 2~4) 품질 단계 → 부족하면 크기 축소 후 반복 ──
    while (true) {
      const canvas = drawScaled(decoded, edge);
      for (const quality of QUALITY_STEPS) {
        const blob = await canvasToBlob(canvas, quality);
        if (!best || blob.size < best.size) best = blob;
        if (blob.size <= TARGET_BYTES) break;
      }
      canvas.width = 0;                  // 큰 캔버스 메모리 즉시 해제
      canvas.height = 0;

      if ((best && best.size <= TARGET_BYTES) || edge <= MIN_EDGE) break;
      edge = Math.max(MIN_EDGE, Math.round(edge * EDGE_SHRINK));
    }

    if (!best) throw new ImageCompressError('이미지 변환에 실패했습니다.');

    // 압축본이 원본보다 크면(드문 경우) 의미가 없으므로 원본 유지
    if (best.size >= file.size) {
      return { file, originalBytes: file.size, outputBytes: file.size, compressed: false };
    }

    const output = new File([best], toJpegName(file.name), { type: OUTPUT_TYPE, lastModified: Date.now() });
    return { file: output, originalBytes: file.size, outputBytes: output.size, compressed: true };
  } finally {
    decoded.release();
  }
}

/** 바이트 → 사람이 읽는 크기 (KB / MB) */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}
