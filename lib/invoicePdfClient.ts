// ============================================================
// 클라이언트 전용 — 송장 PDF 크롭 + 병합 + 인쇄
//
// 본 모듈은 브라우저 환경(canvas, window)에서만 동작한다.
// 서버 측에서 import 금지.
//
// 주요 기능:
//   1. cropPdfToContent(buf)
//      - pdfjs-dist 로 콘텐츠 영역 픽셀 스캔
//      - /Rotate 메타데이터를 보존하며 저장 좌표계로 역변환
//      - pdf-lib CropBox + MediaBox 재설정
//   2. mergeAndPrint(buffers)
//      - 여러 ArrayBuffer 를 병합
//      - hidden iframe + contentWindow.print() 으로 인쇄
//
// 레퍼런스: d:/project/stock_management/src/renderer/services/invoiceService.ts
// ============================================================

import { PDFDocument } from 'pdf-lib';

// ── pdfjs-dist 워커 설정 ──────────────────────────────────────
// Next.js 환경에서는 /public/pdf-worker/pdf.worker.min.mjs 정적 서빙 경로 사용
// (install-time 에 node_modules → public 복사, 워커 버전 매칭)
let pdfjsLibPromise: Promise<typeof import('pdfjs-dist')> | null = null;

async function getPdfjs(): Promise<typeof import('pdfjs-dist')> {
  if (pdfjsLibPromise) return pdfjsLibPromise;
  pdfjsLibPromise = (async () => {
    const pdfjsLib = await import('pdfjs-dist');
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf-worker/pdf.worker.min.mjs';
    return pdfjsLib;
  })();
  return pdfjsLibPromise;
}

// ============================================================
// cropPdfToContent — 콘텐츠 영역만 남도록 CropBox 설정
//
// /Rotate → display 변환 공식:
//   0:   stored = display
//   90:  stored.x = W - display.y,    stored.y = display.x
//   180: stored.x = W - display.x,    stored.y = H - display.y
//   270: stored.x = display.y,        stored.y = H - display.x
//   (W = 저장 페이지 너비, H = 저장 페이지 높이)
// ============================================================
export async function cropPdfToContent(arrayBuffer: ArrayBuffer): Promise<PDFDocument> {
  const pdfjsLib = await getPdfjs();

  // ── 1) 콘텐츠 영역 감지 (저해상도 픽셀 스캔) ──
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise;

  // 감지 단계에서 확정할 좌표 변수 (finally 밖에서 참조)
  let rotation: 0 | 90 | 180 | 270 = 0;
  let dispLeft = 0, dispRight = 0, dispPdfTop = 0, dispPdfBottom = 0;
  let cropW_disp = 0, cropH_disp = 0;

  // 감지용 캔버스는 함수 로컬 — 감지 완료 즉시 픽셀 버퍼 해제 유도
  let detectCanvas: HTMLCanvasElement | null = null;

  try {
    const page = await pdf.getPage(1);
    rotation = (page.rotate ?? 0) as 0 | 90 | 180 | 270;

    const detectScale = 2;
    const detectVp = page.getViewport({ scale: detectScale });
    detectCanvas = document.createElement('canvas');
    detectCanvas.width = detectVp.width;
    detectCanvas.height = detectVp.height;
    const detectCtx = detectCanvas.getContext('2d')!;
    detectCtx.fillStyle = '#ffffff';
    detectCtx.fillRect(0, 0, detectCanvas.width, detectCanvas.height);
    await page.render({ canvasContext: detectCtx, viewport: detectVp }).promise;

    const imageData = detectCtx.getImageData(0, 0, detectCanvas.width, detectCanvas.height);
    const { data, width, height } = imageData;
    let minX = width, minY = height, maxX = 0, maxY = 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        if (data[idx] < 245 || data[idx + 1] < 245 || data[idx + 2] < 245) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    // 여백 추가
    const pad = 5;
    minX = Math.max(0, minX - pad);
    minY = Math.max(0, minY - pad);
    maxX = Math.min(width - 1, maxX + pad);
    maxY = Math.min(height - 1, maxY + pad);

    // ── 2) 캔버스 좌표 → 표시(display) PDF 좌표 (Y up) ──
    const dispH_pt = detectVp.height / detectScale;
    dispLeft = minX / detectScale;
    dispRight = (maxX + 1) / detectScale;
    dispPdfTop = dispH_pt - minY / detectScale;
    dispPdfBottom = dispH_pt - (maxY + 1) / detectScale;
    cropW_disp = dispRight - dispLeft;
    cropH_disp = dispPdfTop - dispPdfBottom;
  } finally {
    // pdfjs 자원 해제 (렌더 캐시 + 워커 참조 반환)
    // 감지 완료 후 pdf 객체 불필요 → 즉시 해제하여 장수 누적 시 메모리 누수 방지
    try { pdf.cleanup(); } catch { /* noop */ }
    try { await pdf.destroy(); } catch { /* noop */ }
    // 감지용 canvas 픽셀 버퍼 해제 힌트
    if (detectCanvas) {
      detectCanvas.width = 0;
      detectCanvas.height = 0;
    }
  }

  // ── 3) 저장(stored) 좌표계로 역변환 (/Rotate 적용) ──
  const srcDoc = await PDFDocument.load(arrayBuffer);
  const srcPage = srcDoc.getPage(0);
  const mb = srcPage.getMediaBox();
  const storedPageW = mb.width;
  const storedPageH = mb.height;

  let storedX: number, storedY: number, storedW: number, storedH: number;
  switch (rotation) {
    case 90:
      storedX = storedPageW - dispPdfTop;
      storedY = dispLeft;
      storedW = cropH_disp;
      storedH = cropW_disp;
      break;
    case 180:
      storedX = storedPageW - dispRight;
      storedY = storedPageH - dispPdfTop;
      storedW = cropW_disp;
      storedH = cropH_disp;
      break;
    case 270:
      storedX = dispPdfBottom;
      storedY = storedPageH - dispRight;
      storedW = cropH_disp;
      storedH = cropW_disp;
      break;
    case 0:
    default:
      storedX = dispLeft;
      storedY = dispPdfBottom;
      storedW = cropW_disp;
      storedH = cropH_disp;
      break;
  }

  // ── 4) CropBox + MediaBox 설정 (원본 /Rotate 그대로 보존) ──
  srcPage.setCropBox(storedX, storedY, storedW, storedH);
  srcPage.setMediaBox(storedX, storedY, storedW, storedH);
  return srcDoc;
}

// ============================================================
// mergeAndPrint — 여러 PDF buffer → 병합 → hidden iframe 인쇄
//
// 처리 흐름:
//   1) 각 buffer 를 cropPdfToContent 로 크롭 (실패 시 수집 후 skip)
//   2) pdf-lib 로 단일 PDFDocument 에 병합
//   3) Blob → object URL → hidden iframe → contentWindow.print()
//   4) 인쇄 완료/취소 후 object URL revoke + iframe 정리 (지연 시간 유지)
//
// 반환값: { success, failed } — failed 는 크롭/병합 실패한 buffer index 리스트
// ============================================================
export interface MergePrintResult {
  success: number;
  failedIndices: number[];
}

export async function mergeAndPrint(buffers: ArrayBuffer[]): Promise<MergePrintResult> {
  const failedIndices: number[] = [];
  const mergedDoc = await PDFDocument.create();

  for (let i = 0; i < buffers.length; i++) {
    try {
      const croppedDoc = await cropPdfToContent(buffers[i]);
      const [copiedPage] = await mergedDoc.copyPages(croppedDoc, [0]);
      mergedDoc.addPage(copiedPage);
    } catch (err) {
      console.error(`invoicePdfClient: buffer[${i}] 처리 실패`, err);
      failedIndices.push(i);
    }
  }

  const success = mergedDoc.getPageCount();
  if (success === 0) {
    return { success: 0, failedIndices };
  }

  const mergedBytes = await mergedDoc.save();
  // pdf-lib save() 는 Uint8Array 반환 — Blob 에 그대로 전달
  const blob = new Blob([mergedBytes as unknown as BlobPart], { type: 'application/pdf' });
  const blobUrl = URL.createObjectURL(blob);

  // ── hidden iframe 으로 인쇄 트리거 ──
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.src = blobUrl;

  document.body.appendChild(iframe);

  await new Promise<void>((resolve) => {
    const onLoad = () => {
      try {
        const win = iframe.contentWindow;
        if (!win) {
          resolve();
          return;
        }
        // PDF 뷰어 준비 시간 확보 (브라우저별 렌더 타이밍 보정)
        setTimeout(() => {
          try {
            win.focus();
            win.print();
          } catch (err) {
            console.error('iframe print 오류:', err);
          }
          resolve();
        }, 500);
      } catch (err) {
        console.error('iframe onLoad 오류:', err);
        resolve();
      }
    };
    iframe.addEventListener('load', onLoad, { once: true });
  });

  // ── 정리: 60초 후 iframe + blobUrl 해제 ──
  //    인쇄 대화상자가 열려있는 동안 revoke 되면 일부 브라우저가 빈 페이지를 인쇄할 수 있어
  //    충분한 여유를 둔다.
  setTimeout(() => {
    try {
      URL.revokeObjectURL(blobUrl);
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    } catch {
      /* noop */
    }
  }, 60000);

  return { success, failedIndices };
}
