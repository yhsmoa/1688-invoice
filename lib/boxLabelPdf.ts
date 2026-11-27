import { jsPDF } from 'jspdf';

// ============================================================
// 박스 라벨 PDF (10 × 15cm 세로 용지, 90° 회전 3줄)
//
//   1줄 날짜(YYMMDD) / 2줄 위치(박스코드) / 3줄 부피(박스 사이즈)
//   사용처
//     · app/export-invoice/box-label  — 통관 엑셀 '품목별' 시트에서 읽은 행
//     · app/shipment-v2 [마킹라벨]    — 쉽먼트 박스 목록 (ft_box_info.size)
//   레이아웃 값은 기존 box-label 페이지와 동일 (출력물이 바뀌지 않도록)
//
// 와우출고 마킹라벨 (같은 용지, 90° 회전 4줄) — 아래 downloadMarkingLabelPdf
//     · app/storage/wow [마킹라벨]   — 와우출고 출고준비 탭
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

// ============================================================
// 와우출고 마킹라벨 — 10 × 15cm 세로 용지, 90° 회전 4줄
//
//   1줄 날짜 / 2줄 (순서) 마킹번호 / 3줄 발주번호-박스번호 (마대면 "마대1") / 4줄 센터 (마대면 "마대해체")
//   순서 = 순서지정 번호 (마대는 여러 박스의 순서가 합쳐져 있어 "M"). 마킹번호 앞에 검은 동그라미 + 흰 글자로 찍는다
//     — 부착문서 · 동봉문서의 순서 배지(app/api/ft/storage/wow/docs)와 같은 모양이라 눈으로 짝을 맞춘다
//   한글이 들어가서 jsPDF 기본 글꼴(영문 전용)로는 찍을 수 없다.
//   → 화면 글꼴(NanumSquare — app/layout.tsx 가 불러온다)로 캔버스에 그려 그림으로 넣는다
//     (라벨 설정의 인쇄 lib/labelRender.ts 와 같은 방식. 글꼴을 못 받으면 PC 의 한글 글꼴로 그린다)
//   읽는 방향은 위 박스 라벨과 같다 (용지 아래쪽에서 위로)
// ============================================================
export interface MarkingLabelEntry {
  date: string;
  /** 마킹번호 앞 동그라미 안의 글자 — 순서지정 번호, 마대면 "M" (없으면 null: 순서지정을 거치지 않은 박스) */
  badge: string | null;
  /** 마킹번호 (BR-X-48) */
  code: string;
  /** 발주번호-박스번호, 마대면 "마대1" */
  ref: string;
  /** 센터, 마대면 "마대해체" */
  dest: string;
}

/** 그림의 촘촘함 — 라벨 프린터(203dpi = 8 dots/mm)와 같다 */
const MARKING_PX_PER_MM = 8;
const MARKING_FONT_FAMILY = 'NanumSquare, "Malgun Gothic", sans-serif';
const MARKING_FONT_WEIGHT = 800;
/** 글자 크기 · 줄마다 글자 밑선의 위치 (읽는 방향의 위에서부터) · 왼쪽 여백 · 한 줄의 최대 너비 */
const MARKING_FONT_MM = 19;
const MARKING_BASELINES_MM = [22, 45, 68, 91];
const MARKING_LEFT_MM = 12;
const MARKING_MAX_WIDTH_MM = 130;
/** 순서 동그라미 — 지름 · 마킹번호와의 간격 · 안의 숫자 크기(두 자리 기준, 넘치면 줄인다) · 숫자가 쓸 수 있는 너비 */
const MARKING_BADGE_MM = 19;
const MARKING_BADGE_GAP_MM = 4;
const MARKING_BADGE_FONT_MM = 14;
const MARKING_BADGE_TEXT_FIT_MM = MARKING_BADGE_MM * 0.72;
/** 2줄(마킹번호)의 자리 — MARKING_BASELINES_MM 의 몇 번째인가 */
const MARKING_CODE_LINE = 1;

const markingFont = (sizePx: number) => `${MARKING_FONT_WEIGHT} ${sizePx}px ${MARKING_FONT_FAMILY}`;

// ── 라벨 한 장을 용지 방향(세로) 그대로의 그림으로 ──
function renderMarkingLabel(entry: MarkingLabelEntry): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = PAGE_WIDTH_MM * MARKING_PX_PER_MM;
  canvas.height = PAGE_HEIGHT_MM * MARKING_PX_PER_MM;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('라벨 그림을 만들 수 없습니다.');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 90° 돌린다: 이후 x = 용지 아래 → 위 (글이 흐르는 방향), y = 용지 왼쪽 → 오른쪽 (줄이 쌓이는 방향)
  ctx.translate(0, canvas.height);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'alphabetic';

  const px = (mm: number) => mm * MARKING_PX_PER_MM;
  const sizePx = px(MARKING_FONT_MM);
  /** 글자 크기를 한 줄(maxPx)에 들어갈 만큼만 줄여 글꼴을 잡는다 */
  const fitFont = (text: string, basePx: number, maxPx: number) => {
    ctx.font = markingFont(basePx);
    const width = ctx.measureText(text).width;
    if (width > maxPx) ctx.font = markingFont(Math.floor(basePx * maxPx / width));
  };

  [entry.date, entry.code, entry.ref, entry.dest].forEach((text, i) => {
    if (!text) return;
    const baseline = px(MARKING_BASELINES_MM[i]);
    let left = px(MARKING_LEFT_MM);

    // ── 2줄: 순서 동그라미를 먼저 그리고 마킹번호를 그 오른쪽에 ──
    if (i === MARKING_CODE_LINE && entry.badge) {
      const radius = px(MARKING_BADGE_MM) / 2;
      // 동그라미의 세로 가운데 = 대문자 · 숫자의 가운데 (밑선에서 글자 높이의 절반 위)
      ctx.font = markingFont(sizePx);
      const capHeight = ctx.measureText('X').actualBoundingBoxAscent;
      const cx = left + radius;
      const cy = baseline - capHeight / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();

      const label = entry.badge;
      fitFont(label, px(MARKING_BADGE_FONT_MM), px(MARKING_BADGE_TEXT_FIT_MM));
      const digit = ctx.measureText(label);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, cx - digit.width / 2, cy + digit.actualBoundingBoxAscent / 2);
      ctx.fillStyle = '#000000';
      left += px(MARKING_BADGE_MM + MARKING_BADGE_GAP_MM);
    }

    // 긴 글(발주번호-박스번호)은 한 줄에 들어갈 만큼만 줄인다
    fitFont(text, sizePx, px(MARKING_LEFT_MM + MARKING_MAX_WIDTH_MM) - left);
    ctx.fillText(text, left, baseline);
  });
  return canvas;
}

/** 와우출고 마킹라벨 PDF 를 만들어 다운로드한다. entries 가 비어 있으면 아무것도 하지 않는다. */
export async function downloadMarkingLabelPdf(entries: MarkingLabelEntry[], fileName: string): Promise<void> {
  if (entries.length === 0) return;

  // 글꼴은 처음 쓸 때 내려받는다 — 받기 전에 그리면 다른 글꼴로 찍힌다 (못 받아도 PC 글꼴로 계속 간다)
  await document.fonts.load(markingFont(MARKING_FONT_MM * MARKING_PX_PER_MM), entries.map((e) => e.ref + e.dest).join(''))
    .catch((err) => console.error('마킹라벨 글꼴 불러오기 오류:', err));

  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [PAGE_WIDTH_MM, PAGE_HEIGHT_MM],
  });
  entries.forEach((entry, index) => {
    if (index > 0) pdf.addPage([PAGE_WIDTH_MM, PAGE_HEIGHT_MM], 'portrait');
    pdf.addImage(renderMarkingLabel(entry).toDataURL('image/png'), 'PNG', 0, 0, PAGE_WIDTH_MM, PAGE_HEIGHT_MM);
  });

  pdf.save(fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`);
}

/** 오늘 날짜 YYMMDD (브라우저 로컬 시각) */
export function todayYYMMDD(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}
