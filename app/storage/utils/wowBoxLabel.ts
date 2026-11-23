import { jsPDF } from 'jspdf';
import JsBarcode from 'jsbarcode';

// ============================================================
// 와우출고 박스 라벨 — 50 × 70mm 세로 (component/BoxLabelModal.tsx 와 같은 용지 · 같은 인쇄 방식)
//
//   로켓(immongRK_scan)의 박스 라벨과 같은 내용을 이 용지에 맞춰 놓는다:
//     ┌──────────────────────┐
//     │ 센터          (입고예정일) │
//     │ 발주번호-박스번호 (큰 글씨) │
//     │ ▌▌▌ 바코드 ▌▌▌           │  ← 모바일(/m/wow) · [순서지정] 이 찍는 값 = "발주번호-박스번호"
//     │ 박스 n / 총 · 크기        │
//     │ 상품 n종 · n개            │
//     └──────────────────────┘
//   센터 이름 · 크기가 한글이라 글자는 캔버스에 그려 그림으로 넣는다 (jsPDF 기본 글꼴은 한글이 없다)
//   인쇄: PDF 를 숨은 iframe 에 넣고 인쇄 창을 띄운다
// ============================================================

export interface WowBoxLabel {
  /** 발주번호-박스번호 — 큰 글씨 + 바코드 값 */
  code: string;
  center: string;
  /** 입고예정일 표기 (예: '11/26') — 없으면 빈 문자열 */
  arrival: string;
  /** 박스 순번 표기 (예: '2 / 5') */
  seq: string;
  size: string;
  /** 수량 표기 (예: '상품 3종 · 12개') */
  summary: string;
}

// ── 용지 (mm) · 캔버스 해상도 ──
const PAGE_W_MM = 50;
const PAGE_H_MM = 70;
const PX_PER_MM = 12;
const MARGIN_MM = 3;

// ── 배치 (mm, 위에서부터) ──
const CENTER_Y_MM = 9;
const CODE_Y_MM = 23;
const BARCODE_Y_MM = 28;
const BARCODE_W_MM = 44;
const BARCODE_H_MM = 17;
const SEQ_Y_MM = 55;
const SUMMARY_Y_MM = 64;

// ── 글자 크기 (mm) ──
const CENTER_FONT_MM = 6;
const ARRIVAL_FONT_MM = 4.2;
const CODE_FONT_MM = 6.4;
const SEQ_FONT_MM = 5.6;
const SUMMARY_FONT_MM = 3.8;

const FONT_FAMILY = "'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";
const PRINT_FRAME_ID = 'wow-box-label-print-frame';

const px = (mm: number) => Math.round(mm * PX_PER_MM);

/** 폭을 넘으면 글자 크기를 줄여 한 줄에 맞춘다 */
function fitText(ctx: CanvasRenderingContext2D, text: string, fontMm: number, maxWidthMm: number, weight = 700) {
  let size = px(fontMm);
  ctx.font = `${weight} ${size}px ${FONT_FAMILY}`;
  const maxWidth = px(maxWidthMm);
  while (size > 8 && ctx.measureText(text).width > maxWidth) {
    size -= 1;
    ctx.font = `${weight} ${size}px ${FONT_FAMILY}`;
  }
}

function drawLabel(label: WowBoxLabel): string {
  const canvas = document.createElement('canvas');
  canvas.width = px(PAGE_W_MM);
  canvas.height = px(PAGE_H_MM);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context 를 만들 수 없습니다.');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'alphabetic';
  const innerW = PAGE_W_MM - MARGIN_MM * 2;

  // ── 센터 (왼쪽) · 입고예정일 (오른쪽) ──
  ctx.textAlign = 'right';
  ctx.font = `700 ${px(ARRIVAL_FONT_MM)}px ${FONT_FAMILY}`;
  const arrivalText = label.arrival ? `(${label.arrival})` : '';
  const arrivalW = arrivalText ? ctx.measureText(arrivalText).width / PX_PER_MM + 1.5 : 0;
  if (arrivalText) ctx.fillText(arrivalText, px(PAGE_W_MM - MARGIN_MM), px(CENTER_Y_MM));
  ctx.textAlign = 'left';
  fitText(ctx, label.center, CENTER_FONT_MM, innerW - arrivalW);
  ctx.fillText(label.center, px(MARGIN_MM), px(CENTER_Y_MM));

  // ── 발주번호-박스번호 ──
  ctx.textAlign = 'center';
  fitText(ctx, label.code, CODE_FONT_MM, innerW, 800);
  ctx.fillText(label.code, px(PAGE_W_MM / 2), px(CODE_Y_MM));

  // ── 바코드 (CODE128) ──
  const bc = document.createElement('canvas');
  JsBarcode(bc, label.code, { format: 'CODE128', width: 3, height: 120, displayValue: false, margin: 0 });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bc, px((PAGE_W_MM - BARCODE_W_MM) / 2), px(BARCODE_Y_MM), px(BARCODE_W_MM), px(BARCODE_H_MM));

  // ── 박스 순번 (왼쪽) · 크기 (오른쪽) ──
  ctx.textAlign = 'left';
  fitText(ctx, label.seq, SEQ_FONT_MM, innerW / 2, 800);
  ctx.fillText(label.seq, px(MARGIN_MM), px(SEQ_Y_MM));
  ctx.textAlign = 'right';
  fitText(ctx, label.size, SEQ_FONT_MM, innerW / 2 - 1, 800);
  ctx.fillText(label.size, px(PAGE_W_MM - MARGIN_MM), px(SEQ_Y_MM));

  // ── 수량 ──
  ctx.textAlign = 'center';
  fitText(ctx, label.summary, SUMMARY_FONT_MM, innerW, 600);
  ctx.fillText(label.summary, px(PAGE_W_MM / 2), px(SUMMARY_Y_MM));

  return canvas.toDataURL('image/png');
}

/** 라벨을 한 장씩 담은 PDF 를 만들어 인쇄 창을 띄운다. labels 가 비어 있으면 아무것도 하지 않는다 */
export function printWowBoxLabels(labels: WowBoxLabel[]): void {
  if (labels.length === 0) return;

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [PAGE_W_MM, PAGE_H_MM] });
  labels.forEach((label, index) => {
    if (index > 0) pdf.addPage([PAGE_W_MM, PAGE_H_MM], 'portrait');
    pdf.addImage(drawLabel(label), 'PNG', 0, 0, PAGE_W_MM, PAGE_H_MM);
  });

  // ── 숨은 iframe 에 넣고 인쇄 (앞서 쓴 iframe 은 치운다) ──
  document.getElementById(PRINT_FRAME_ID)?.remove();
  const url = URL.createObjectURL(pdf.output('blob'));
  const frame = document.createElement('iframe');
  frame.id = PRINT_FRAME_ID;
  frame.hidden = true;
  frame.src = url;
  frame.onload = () => {
    frame.contentWindow?.print();
    URL.revokeObjectURL(url);
  };
  document.body.appendChild(frame);
}
