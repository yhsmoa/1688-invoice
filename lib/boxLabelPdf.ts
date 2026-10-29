import { jsPDF } from 'jspdf';

// ============================================================
// 박스 라벨 PDF (10 × 15cm 세로 용지, 90° 회전 3줄)
//
//   1줄 날짜(YYMMDD) / 2줄 위치(박스코드) / 3줄 부피(박스 사이즈)
//   사용처
//     · app/export-invoice/box-label  — 통관 엑셀 '품목별' 시트에서 읽은 행
//     · app/shipment-v2 [박스라벨]    — 쉽먼트 박스 목록 (ft_box_info.size)
//   레이아웃 값은 기존 box-label 페이지와 동일 (출력물이 바뀌지 않도록)
// ============================================================

export interface BoxLabelEntry {
  date: string;
  location: string;
  /** 3번째 줄 — 비어 있으면 빈 줄 */
  weight: string;
}

// ── 용지 (mm) ──
const PAGE_WIDTH_MM = 100;
const PAGE_HEIGHT_MM = 150;

// ── 글자 배치 (mm) ──
const FONT_SIZE = 72;
const LINE_SPACING_MM = 28;
const FIRST_LINE_X_MM = 30;
const TEXT_Y_MM = PAGE_HEIGHT_MM - 15;

/** 라벨 PDF 를 만들어 다운로드한다. entries 가 비어 있으면 아무것도 하지 않는다. */
export function downloadBoxLabelPdf(entries: BoxLabelEntry[], fileName: string): void {
  if (entries.length === 0) return;

  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [PAGE_WIDTH_MM, PAGE_HEIGHT_MM],
  });

  entries.forEach((item, index) => {
    if (index > 0) pdf.addPage([PAGE_WIDTH_MM, PAGE_HEIGHT_MM], 'portrait');

    pdf.setFontSize(FONT_SIZE);
    pdf.setFont('helvetica', 'bold');

    // 90도 회전 텍스트: x = 줄 위치(용지 가로), y = 글자 시작(용지 아래쪽에서 위로)
    const lines = [item.date, item.location, item.weight || ''];
    lines.forEach((text, i) => {
      pdf.text(text, FIRST_LINE_X_MM + LINE_SPACING_MM * i, TEXT_Y_MM, { angle: 90 });
    });
  });

  pdf.save(fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`);
}

/** 오늘 날짜 YYMMDD (브라우저 로컬 시각) */
export function todayYYMMDD(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}
