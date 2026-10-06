import { dbAccessHeaders } from '../../../../../component/DbAccessGate';
import { invoiceFileBase, type InvoiceInput } from '../../../../../lib/tradeInvoice';

// ============================================================
// exportInvoice — 인보이스 저장 helper (클라이언트)
//   excel / EXCEL2 : 서버(/api/trade-invoice/excel)가 만든 xlsx 를 받아 저장
//   jpg / pdf      : 미리보기 DOM(A1:N48 시트)을 html2canvas 로 그려 저장
//   도장 이미지     : 접근 코드 헤더가 필요해 <img src> 대신 fetch → object URL
// ============================================================

export type InvoiceExportKind = 'excel' | 'excel2' | 'jpg' | 'pdf';

// ── 공통 ──
function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 다운로드가 시작된 뒤 해제 (즉시 해제하면 일부 브라우저가 저장에 실패)
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const json = await res.json();
    return json?.error || fallback;
  } catch {
    return fallback;
  }
}

// ── 도장 이미지 ──
export async function fetchStampObjectUrl(): Promise<string> {
  const res = await fetch('/api/trade-invoice/stamp', { headers: dbAccessHeaders() });
  if (!res.ok) throw new Error(await readError(res, '도장 이미지를 불러오지 못했습니다.'));
  return URL.createObjectURL(await res.blob());
}

// ── 엑셀 (원본 템플릿 / 개정본) ──
export async function downloadInvoiceExcel(input: InvoiceInput, variant: 'template' | 'v2'): Promise<void> {
  const params = new URLSearchParams({ variant, amount: String(input.amount), date: input.date });
  const res = await fetch(`/api/trade-invoice/excel?${params.toString()}`, { headers: dbAccessHeaders() });
  if (!res.ok) throw new Error(await readError(res, '엑셀 생성에 실패했습니다.'));
  triggerDownload(await res.blob(), `${invoiceFileBase(input.date)}${variant === 'v2' ? '_v2' : ''}.xlsx`);
}

// ── 시트 DOM → 캔버스 (JPG·PDF 공용, 2배 해상도) ──
async function renderSheet(sheet: HTMLElement): Promise<HTMLCanvasElement> {
  const { default: html2canvas } = await import('html2canvas');
  return html2canvas(sheet, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
}

export async function downloadInvoiceJpg(sheet: HTMLElement, input: InvoiceInput): Promise<void> {
  const canvas = await renderSheet(sheet);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('이미지 변환에 실패했습니다.'))), 'image/jpeg', 0.95),
  );
  triggerDownload(blob, `${invoiceFileBase(input.date)}.jpg`);
}

/** A4 세로, 여백 10mm 안에 비율 유지로 맞춘다 */
export async function downloadInvoicePdf(sheet: HTMLElement, input: InvoiceInput): Promise<void> {
  const canvas = await renderSheet(sheet);
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const PAGE_W = 210;
  const PAGE_H = 297;
  const MARGIN = 10;
  const maxW = PAGE_W - MARGIN * 2;
  const maxH = PAGE_H - MARGIN * 2;
  const ratio = canvas.height / canvas.width;
  let w = maxW;
  let h = w * ratio;
  if (h > maxH) {
    h = maxH;
    w = h / ratio;
  }
  pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', (PAGE_W - w) / 2, MARGIN, w, h);
  pdf.save(`${invoiceFileBase(input.date)}.pdf`);
}
