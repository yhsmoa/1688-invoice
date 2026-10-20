'use client';

import React, { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef } from 'react';
import {
  INVOICE_CELLS, INVOICE_COL_COUNT, INVOICE_COL_WIDTHS, INVOICE_FONT_FAMILY, INVOICE_ROW_COUNT,
  INVOICE_ROW_HEIGHTS, INVOICE_STAMP, SYNTHETIC_BOLD_FAMILIES, SYNTHETIC_BOLD_STROKE_EM, colWidthPx,
  isValidInvoiceAmount, mergeInvoiceFont, rangeBorders, resolveCellDisplay, rowHeightPx, specRange,
  type BorderStyle, type InvoiceCellSpec, type InvoiceFont, type InvoiceInput,
} from '../../../../../lib/tradeInvoice';

// ============================================================
// InvoicePreview — 엑셀 인쇄 영역(A1:N48)을 HTML 표로 재현
//   lib/tradeInvoice 스펙(열 너비·행 높이·병합·테두리·문구)을 그대로 그린다.
//   이 DOM 이 JPG·PDF 저장의 원본이므로 시트 밖 장식은 넣지 않는다.
//
//   테두리는 선 하나를 셀 하나만 그린다 (오른쪽·아래쪽 담당, 맨 왼쪽 열만 왼쪽 선).
//   html2canvas 는 border-collapse 를 합치지 않고 양쪽 셀 테두리를 모두 그려
//   선이 원본보다 두 배 두껍게 저장되기 때문이다.
// ============================================================

interface InvoicePreviewProps {
  input: InvoiceInput;
  /** 도장 이미지 object URL (로딩 전엔 null) */
  stampUrl: string | null;
}

const BORDER_CSS: Record<BorderStyle, string> = {
  thin: '1px solid #000',
  medium: '2px solid #000',
  double: '3px double #000',
};
const borderCss = (s?: BorderStyle) => (s ? BORDER_CSS[s] : 'none');

const AMOUNT_KINDS = new Set(['qty', 'amount', 'total', 'fobAmount']);

/** 셀 좌우 padding 합 (.inv-table td 의 0 2px) */
const CELL_PADDING_PX = 4;

/**
 * 시트 바깥 여유 (px) — 표 바깥 테두리는 표 경계에 반쯤 걸쳐 그려지므로,
 * 여유 없이 캡처하면 오른쪽 바깥선이 절반 잘린다. 가장 굵은 선(3px double)이 들어갈 만큼.
 */
const SHEET_BLEED_PX = 3;

/**
 * 돋움은 10pt(13px) 이하에서 글꼴에 든 비트맵 글자로 바뀌어 폭이 22% 좁아진다
 * (원본 인쇄본은 윤곽선 글자). 화면·캡처 모두 같은 현상이라, 11pt 로 그린 뒤 원래 크기로 축소한다.
 */
const DOTUM_BITMAP_MAX_PT = 10;
const DOTUM_OUTLINE_PT = 11;

/** 실제로 그릴 글자 크기와, 원래 크기로 되돌릴 축소 배율 */
function renderSize(font: InvoiceFont): { pt: number; glyphScale: number } {
  const pt = font.size ?? 11;
  if ((font.family ?? 'gothic') === 'dotum' && pt <= DOTUM_BITMAP_MAX_PT) {
    return { pt: DOTUM_OUTLINE_PT, glyphScale: pt / DOTUM_OUTLINE_PT };
  }
  return { pt, glyphScale: 1 };
}

// ── 글꼴 → CSS (가짜 굵게 글꼴은 보통 굵기 + 엑셀과 같은 두께의 윤곽선) ──
function fontCss(font: InvoiceFont): React.CSSProperties {
  const family = font.family ?? 'gothic';
  const synthetic = !!font.bold && SYNTHETIC_BOLD_FAMILIES.has(family);
  return {
    fontFamily: `'${INVOICE_FONT_FAMILY[family]}', sans-serif`,
    fontSize: `${renderSize(font).pt}pt`,
    fontWeight: font.bold && !synthetic ? 700 : 400,
    textDecoration: font.underline ? 'underline' : 'none',
    ...(font.color ? { color: `#${font.color}` } : {}),
    ...(synthetic ? { WebkitTextStrokeWidth: `${SYNTHETIC_BOLD_STROKE_EM}em`, WebkitTextStrokeColor: 'currentColor' } : {}),
  };
}

const InvoicePreview = forwardRef<HTMLDivElement, InvoicePreviewProps>(function InvoicePreview({ input, stampUrl }, ref) {
  const sheetRef = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => sheetRef.current as HTMLDivElement);

  // ── 글자 축소(data-gs) + 셀에 맞춤: 셀보다 긴 문구·금액은 엑셀 '셀에 맞춤'처럼 가로 축소 ──
  //    (글꼴 폭이 엑셀과 달라 넘치는 줄 보정)
  useLayoutEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    sheet.querySelectorAll<HTMLElement>('.inv-fit, .inv-acc, .inv-num').forEach((el) => {
      const gs = Number(el.dataset.gs) || 1;
      el.style.transform = gs !== 1 ? `scale(${gs})` : '';
      const cell = el.parentElement;
      if (!cell) return;
      const avail = cell.clientWidth - CELL_PADDING_PX;
      const need = el.scrollWidth * gs;
      if (need > avail + 0.5 && avail > 0) el.style.transform = `scale(${((gs * avail) / need).toFixed(4)}, ${gs})`;
    });
  }, [input]);

  // ── 격자 치수 ──
  const colPx = useMemo(() => INVOICE_COL_WIDTHS.map(colWidthPx), []);
  const rowPx = useMemo(() => INVOICE_ROW_HEIGHTS.map(rowHeightPx), []);
  const sheetWidth = colPx.reduce((a, b) => a + b, 0);
  const sheetHeight = rowPx.reduce((a, b) => a + b, 0);

  // ── 셀 배치: 좌상단 셀 → 스펙, 병합으로 덮인 셀 → 건너뜀 (인쇄 영역 밖 스펙은 제외) ──
  const { masters, covered } = useMemo(() => {
    const masters = new Map<string, InvoiceCellSpec>();
    const covered = new Set<string>();
    for (const spec of INVOICE_CELLS) {
      const { r1, c1, r2, c2 } = specRange(spec);
      if (r1 > INVOICE_ROW_COUNT || c1 > INVOICE_COL_COUNT) continue;
      masters.set(`${r1}:${c1}`, spec);
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (r !== r1 || c !== c1) covered.add(`${r}:${c}`);
    }
    return { masters, covered };
  }, []);

  // ── 도장 위치 (원본 앵커: I열 + 34px, 40행 + 11px) — 시트 바깥 여유만큼 밀어 표 좌표와 맞춘다 ──
  const stampLeft = SHEET_BLEED_PX + colPx.slice(0, INVOICE_STAMP.col - 1).reduce((a, b) => a + b, 0) + INVOICE_STAMP.colOffsetPx;
  const stampTop = SHEET_BLEED_PX + rowPx.slice(0, INVOICE_STAMP.row - 1).reduce((a, b) => a + b, 0) + INVOICE_STAMP.rowOffsetPx;

  const hasAmount = isValidInvoiceAmount(input.amount);

  const renderCell = (r: number, c: number) => {
    const spec = masters.get(`${r}:${c}`);
    const range = spec ? specRange(spec) : { r1: r, c1: c, r2: r, c2: c };
    const b = rangeBorders(range.r1, range.c1, range.r2, range.c2);
    const style: React.CSSProperties = {
      // 선 하나 = 셀 하나: 위쪽 선은 윗 셀의 아래쪽, 왼쪽 선은 왼쪽 셀의 오른쪽이 그린다 (맨 윗 행·맨 왼쪽 열만 직접)
      borderTop: range.r1 === 1 ? borderCss(b.top) : 'none',
      borderBottom: borderCss(b.bottom),
      borderLeft: range.c1 === 1 ? borderCss(b.left) : 'none',
      borderRight: borderCss(b.right),
      ...fontCss(spec?.font ?? {}),
      ...(spec?.fill ? { background: `#${spec.fill}` } : {}),
      ...(spec?.align ? { textAlign: spec.align } : {}),
    };

    let content: React.ReactNode = null;
    if (spec?.runs) {
      // 서식 있는 문구 — 조각마다 셀 글꼴 위에 조각 글꼴을 덮어 그린다
      content = (
        <span className="inv-fit">
          {spec.runs.map((run, i) => (
            <span key={i} style={fontCss(mergeInvoiceFont(spec.font, run.font))}>{run.text}</span>
          ))}
        </span>
      );
    } else if (spec) {
      const kind = spec.kind ?? 'text';
      if (!(AMOUNT_KINDS.has(kind) && !hasAmount)) {
        const { text, currency } = resolveCellDisplay(spec, input);
        // 축소해 그리는 글자(돋움 10pt) — 셀 폭을 채우는 블록은 축소 전 폭을 1/배율 로 넓혀 둔다
        const gs = renderSize(spec.font ?? {}).glyphScale;
        const scaled = gs !== 1 ? { 'data-gs': gs } : {};
        const blockWidth = gs !== 1 ? { width: `${100 / gs}%` } : undefined;
        if (currency) {
          content = (
            <span className="inv-acc" {...scaled} style={blockWidth}>
              <span>{currency}</span>
              <span>{text}</span>
            </span>
          );
        } else if (kind === 'qty') {
          content = <span className="inv-num" {...scaled} style={blockWidth}>{text}</span>;
        } else {
          content = <span className="inv-fit" {...scaled}>{text}</span>;
        }
      }
    }

    return (
      <td
        key={c}
        colSpan={range.c2 - range.c1 + 1}
        rowSpan={range.r2 - range.r1 + 1}
        style={style}
      >
        {content}
      </td>
    );
  };

  return (
    <div
      ref={sheetRef}
      className="inv-sheet"
      style={{ width: sheetWidth + SHEET_BLEED_PX * 2, height: sheetHeight + SHEET_BLEED_PX * 2, padding: SHEET_BLEED_PX }}
    >
      <table className="inv-table" style={{ width: sheetWidth }}>
        <colgroup>
          {colPx.map((w, i) => <col key={i} style={{ width: w }} />)}
        </colgroup>
        <tbody>
          {rowPx.map((h, i) => {
            const r = i + 1;
            return (
              <tr key={r} style={{ height: h }}>
                {colPx.map((_, j) => {
                  const c = j + 1;
                  return covered.has(`${r}:${c}`) ? null : renderCell(r, c);
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      {stampUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="inv-stamp"
          src={stampUrl}
          alt=""
          style={{ left: stampLeft, top: stampTop, width: INVOICE_STAMP.widthPx, height: INVOICE_STAMP.heightPx }}
        />
      )}
    </div>
  );
});

export default InvoicePreview;
