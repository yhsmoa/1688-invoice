'use client';

import React, { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef } from 'react';
import {
  INVOICE_CELLS, INVOICE_COL_COUNT, INVOICE_COL_WIDTHS, INVOICE_FONT_FAMILY, INVOICE_ROW_COUNT,
  INVOICE_ROW_HEIGHTS, INVOICE_STAMP, colWidthPx, isValidInvoiceAmount, rangeBorders, resolveCellDisplay,
  rowHeightPx, specRange, type BorderStyle, type InvoiceCellSpec, type InvoiceInput,
} from '../../../../../lib/tradeInvoice';

// ============================================================
// InvoicePreview — 엑셀 인쇄 영역(A1:N48)을 HTML 표로 재현
//   lib/tradeInvoice 스펙(열 너비·행 높이·병합·테두리·문구)을 그대로 그린다.
//   이 DOM 이 JPG·PDF 저장의 원본이므로 시트 밖 장식은 넣지 않는다.
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

const InvoicePreview = forwardRef<HTMLDivElement, InvoicePreviewProps>(function InvoicePreview({ input, stampUrl }, ref) {
  const sheetRef = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => sheetRef.current as HTMLDivElement);

  // ── 셀에 맞춤: 셀보다 긴 문구는 엑셀 '셀에 맞춤'처럼 가로 축소 (글꼴 폭이 엑셀과 달라 넘치는 줄 보정) ──
  useLayoutEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    sheet.querySelectorAll<HTMLElement>('.inv-fit').forEach((span) => {
      span.style.transform = '';
      const cell = span.parentElement;
      if (!cell) return;
      const avail = cell.clientWidth - CELL_PADDING_PX;
      const need = span.scrollWidth;
      if (need > avail && avail > 0) span.style.transform = `scaleX(${(avail / need).toFixed(3)})`;
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

  // ── 도장 위치 (원본 앵커: I열 + 34px, 40행 + 11px) ──
  const stampLeft = colPx.slice(0, INVOICE_STAMP.col - 1).reduce((a, b) => a + b, 0) + INVOICE_STAMP.colOffsetPx;
  const stampTop = rowPx.slice(0, INVOICE_STAMP.row - 1).reduce((a, b) => a + b, 0) + INVOICE_STAMP.rowOffsetPx;

  const hasAmount = isValidInvoiceAmount(input.amount);

  const renderCell = (r: number, c: number) => {
    const spec = masters.get(`${r}:${c}`);
    const range = spec ? specRange(spec) : { r1: r, c1: c, r2: r, c2: c };
    const b = rangeBorders(range.r1, range.c1, range.r2, range.c2);
    const font = spec?.font ?? {};
    const style: React.CSSProperties = {
      borderTop: borderCss(b.top),
      borderBottom: borderCss(b.bottom),
      borderLeft: borderCss(b.left),
      borderRight: borderCss(b.right),
      fontFamily: `'${INVOICE_FONT_FAMILY[font.family ?? 'gothic']}', sans-serif`,
      fontSize: `${font.size ?? 11}pt`,
      fontWeight: font.bold ? 700 : 400,
      ...(font.color ? { color: `#${font.color}` } : {}),
      ...(spec?.fill ? { background: `#${spec.fill}` } : {}),
      ...(spec?.align ? { textAlign: spec.align } : {}),
    };

    let content: React.ReactNode = null;
    if (spec) {
      const kind = spec.kind ?? 'text';
      if (!(AMOUNT_KINDS.has(kind) && !hasAmount)) {
        const { text, currency } = resolveCellDisplay(spec, input);
        if (currency) {
          content = (
            <span className="inv-acc">
              <span>{currency}</span>
              <span>{text}</span>
            </span>
          );
        } else if (kind === 'qty') {
          content = <span className="inv-num">{text}</span>;
        } else {
          content = <span className="inv-fit">{text}</span>;
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
    <div ref={sheetRef} className="inv-sheet" style={{ width: sheetWidth, height: sheetHeight }}>
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
