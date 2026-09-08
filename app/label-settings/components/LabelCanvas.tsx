'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import LabelPreview from './LabelPreview';
import type { LabelData, LabelElement, LabelTemplate } from '../../../lib/labelTypes';
import { isTextBox } from '../../../lib/labelTypes';
import { measureElement, rasterElement, type ElementBox } from '../../../lib/labelRender';
import { useRasterVersion } from '../hooks/useRasterVersion';

/** 캔버스가 요소마다 들고 있는 영역 정보 */
interface CanvasBox extends ElementBox {
  /** 영역 텍스트가 현재 샘플로 잘리는가 */
  clipped?: boolean;
}

// ============================================================
// 라벨 캔버스 — 드래그로 배치하는 편집 화면
//
// 구성 (겹쳐 놓는다)
//   1) LabelPreview  : 인쇄와 동일한 래스터 (아래층)
//   2) SVG 오버레이   : 격자 · 클릭 판정 · 선택 테두리 · 크기 핸들 (위층)
//   두 층 모두 같은 크기(mm × scale) 라 좌표가 정확히 겹친다.
//
// 좌표계
//   · SVG viewBox 는 mm 단위 (0 0 width_mm height_mm)
//   · 마우스 이동량(px) ÷ scale = 이동량(mm)
//
// 크기 핸들은 "화면에 보이는 상자" 기준으로 움직인다. 회전된 요소는
// 화면 폭/높이를 요소 고유 폭/높이로 되돌려 저장한다 (90/270 이면 교환).
// 바코드는 폭이 데이터로 정해지므로 회전 시 핸들을 숨긴다.
// ============================================================

const RULER = 18; // 눈금자 두께 (px)
const HANDLE_PX = 8; // 크기 핸들 한 변 (px)

export type ElementPatch = Partial<Record<string, unknown>>;

interface LabelCanvasProps {
  template: LabelTemplate;
  data: LabelData;
  /** px per mm */
  scale: number;
  showGrid: boolean;
  /** 스냅 간격 (mm). 0 이면 스냅 없음 */
  snapMm: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /**
   * 요소 변경.
   * commit=false → 드래그 중 (되돌리기 기록 없이 화면만 갱신)
   * commit=true  → 드래그 종료 (되돌리기 한 단계로 기록)
   */
  onElementChange: (id: string, patch: ElementPatch, commit: boolean) => void;
}

type DragMode = 'move' | 'resize-e' | 'resize-s' | 'resize-se';

interface DragState {
  id: string;
  mode: DragMode;
  startX: number;
  startY: number;
  origin: LabelElement;
  box: ElementBox;
  lastPatch: ElementPatch | null;
}

/** 값 정리 — 스냅 간격이 있으면 그 배수로, 없으면 0.1mm 로 */
function quantize(v: number, snapMm: number): number {
  const step = snapMm > 0 ? snapMm : 0.1;
  return Math.round(v / step) * step;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

/** 소수점 잔여 오차 제거 (0.30000000000000004 방지) */
function tidy(v: number): number {
  return Math.round(v * 100) / 100;
}

const LabelCanvas: React.FC<LabelCanvasProps> = ({
  template,
  data,
  scale,
  showGrid,
  snapMm,
  selectedId,
  onSelect,
  onElementChange,
}) => {
  const W = template.width_mm;
  const H = template.height_mm;
  const cssW = Math.max(1, W * scale);
  const cssH = Math.max(1, H * scale);

  const dragRef = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState(false);
  const rasterVersion = useRasterVersion();

  // ── 요소별 실제 점유 영역 (회전 반영) ──
  const boxes = useMemo(() => {
    const map = new Map<string, CanvasBox>();
    for (const el of template.layout || []) {
      const box = measureElement(el, template, data);
      // 영역 텍스트가 이 샘플로 잘리면 캔버스에 표시한다 (선택 안 해도 보이게)
      const clipped =
        el.type === 'text' &&
        (rasterElement(el, template, data)?.text?.clippedLines ?? 0) > 0;
      map.set(el.id, { ...box, clipped });
    }
    return map;
    // layout/규격/데이터가 바뀌거나 이미지가 늦게 읽히면 다시 측정
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, data, rasterVersion]);

  // ============================================================
  // 드래그
  // ============================================================
  const startDrag = useCallback(
    (e: React.PointerEvent, el: LabelElement, mode: DragMode) => {
      if (el.locked) return;
      e.preventDefault();
      e.stopPropagation();
      onSelect(el.id);
      dragRef.current = {
        id: el.id,
        mode,
        startX: e.clientX,
        startY: e.clientY,
        origin: el,
        box: boxes.get(el.id) ?? { x_mm: el.x_mm, y_mm: el.y_mm, w_mm: 5, h_mm: 5 },
        lastPatch: null,
      };
      setDragging(true);
    },
    [boxes, onSelect]
  );

  useEffect(() => {
    if (!dragging) return;

    const handleMove = (e: PointerEvent) => {
      const st = dragRef.current;
      if (!st) return;
      const dx = (e.clientX - st.startX) / scale;
      const dy = (e.clientY - st.startY) / scale;
      const o = st.origin;
      let patch: ElementPatch | null = null;

      if (st.mode === 'move') {
        const x = clamp(quantize(o.x_mm + dx, snapMm), 0, Math.max(0, W - st.box.w_mm));
        const y = clamp(quantize(o.y_mm + dy, snapMm), 0, Math.max(0, H - st.box.h_mm));
        patch = { x_mm: tidy(x), y_mm: tidy(y) };
      } else {
        // ── 크기 조절: 화면에 보이는 상자 크기를 먼저 정하고, 회전이면 요소 고유 폭/높이로 되돌린다 ──
        const resizeW = st.mode === 'resize-e' || st.mode === 'resize-se';
        const resizeH = st.mode === 'resize-s' || st.mode === 'resize-se';
        const screenW = resizeW
          ? clamp(quantize(st.box.w_mm + dx, snapMm), 1, Math.max(1, W - o.x_mm))
          : st.box.w_mm;
        const screenH = resizeH
          ? clamp(quantize(st.box.h_mm + dy, snapMm), 0.5, Math.max(0.5, H - o.y_mm))
          : st.box.h_mm;
        const swap = o.rotate === 90 || o.rotate === 270;
        const elW = swap ? screenH : screenW;
        const elH = swap ? screenW : screenH;

        if (o.type === 'text') {
          patch = { max_w_mm: tidy(Math.max(2, elW)) };
          // 높이를 끌면 한 줄 텍스트도 영역(상자)이 된다
          if (isTextBox(o) || resizeH) patch.h_mm = tidy(Math.max(1, elH));
        } else if (o.type === 'barcode') {
          patch = { h_mm: tidy(Math.max(2, elH)) };
        } else if (o.type === 'box' || o.type === 'line') {
          patch = { w_mm: tidy(Math.max(0.2, elW)), h_mm: tidy(Math.max(0.1, elH)) };
        } else if (o.type === 'image') {
          // 비율 유지면 가로 기준으로 세로를 따라가게 한다
          const keep = o.keep_ratio !== false && o.w_mm > 0 && o.h_mm > 0;
          const w = Math.max(1, elW);
          const h = keep ? (w * o.h_mm) / o.w_mm : Math.max(1, elH);
          patch = { w_mm: tidy(w), h_mm: tidy(h) };
        }
      }

      if (!patch) return;
      st.lastPatch = patch;
      onElementChange(st.id, patch, false);
    };

    const handleUp = () => {
      const st = dragRef.current;
      // 실제로 움직였을 때만 되돌리기 한 단계로 확정한다
      if (st?.lastPatch) onElementChange(st.id, st.lastPatch, true);
      dragRef.current = null;
      setDragging(false);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [dragging, scale, snapMm, W, H, onElementChange]);

  // ============================================================
  // 눈금자
  // ============================================================
  const ticks = (lengthMm: number) => {
    const out: { mm: number; major: boolean }[] = [];
    const step = scale >= 8 ? 1 : scale >= 4 ? 2 : 5;
    for (let mm = 0; mm <= Math.ceil(lengthMm); mm += step) {
      out.push({ mm, major: mm % 10 === 0 });
    }
    return out;
  };

  const rulerFont = 8;

  // ============================================================
  // 렌더링
  // ============================================================
  const handleMm = HANDLE_PX / scale;

  return (
    <div className="lc-frame" style={{ gridTemplateColumns: `${RULER}px ${cssW}px` }}>
      {/* 좌상단 모서리 */}
      <div className="lc-corner" style={{ width: RULER, height: RULER }} />

      {/* 가로 눈금자 */}
      <svg className="lc-ruler lc-ruler-x" width={cssW} height={RULER}>
        {ticks(W).map(({ mm, major }) => (
          <g key={mm}>
            <line
              x1={mm * scale}
              y1={major ? 4 : RULER - 5}
              x2={mm * scale}
              y2={RULER}
              stroke="#9ca3af"
              strokeWidth={1}
            />
            {major && (
              <text x={mm * scale + 2} y={rulerFont + 1} fontSize={rulerFont} fill="#6b7280">
                {mm}
              </text>
            )}
          </g>
        ))}
      </svg>

      {/* 세로 눈금자 */}
      <svg className="lc-ruler lc-ruler-y" width={RULER} height={cssH}>
        {ticks(H).map(({ mm, major }) => (
          <g key={mm}>
            <line
              x1={major ? 4 : RULER - 5}
              y1={mm * scale}
              x2={RULER}
              y2={mm * scale}
              stroke="#9ca3af"
              strokeWidth={1}
            />
            {major && (
              <text x={1} y={mm * scale + rulerFont + 1} fontSize={rulerFont} fill="#6b7280">
                {mm}
              </text>
            )}
          </g>
        ))}
      </svg>

      {/* 라벨 본체 */}
      <div className="lc-stage" style={{ width: cssW, height: cssH }}>
        <LabelPreview template={template} data={data} scale={scale} className="lc-paper" />

        <svg
          className="lc-overlay"
          width={cssW}
          height={cssH}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
        >
          {/* 빈 곳 클릭 → 선택 해제 */}
          <rect
            x={0}
            y={0}
            width={W}
            height={H}
            fill="transparent"
            onPointerDown={() => onSelect(null)}
          />

          {/* 격자 */}
          {showGrid && (
            <g pointerEvents="none">
              {Array.from({ length: Math.floor(W) }, (_, i) => i + 1).map((mm) => (
                <line
                  key={`gx${mm}`}
                  x1={mm}
                  y1={0}
                  x2={mm}
                  y2={H}
                  stroke={mm % 5 === 0 ? '#c7d2fe' : '#e5e7eb'}
                  strokeWidth={0.06}
                />
              ))}
              {Array.from({ length: Math.floor(H) }, (_, i) => i + 1).map((mm) => (
                <line
                  key={`gy${mm}`}
                  x1={0}
                  y1={mm}
                  x2={W}
                  y2={mm}
                  stroke={mm % 5 === 0 ? '#c7d2fe' : '#e5e7eb'}
                  strokeWidth={0.06}
                />
              ))}
            </g>
          )}

          {/* 요소 클릭 판정 — 배열 순서대로 그려서 뒤쪽이 위에 온다 */}
          {(template.layout || []).map((el) => {
            if (el.hidden) return null;
            const box = boxes.get(el.id);
            if (!box) return null;
            const isBox = el.type === 'text' && isTextBox(el);
            return (
              <g key={el.id}>
                {/* 영역 텍스트는 상자 윤곽을 늘 옅게 보여준다 — "여기가 글이 흐르는 범위" */}
                {isBox && (
                  <rect
                    x={box.x_mm}
                    y={box.y_mm}
                    width={box.w_mm}
                    height={box.h_mm}
                    fill="none"
                    stroke={box.clipped ? '#f87171' : '#c7d2fe'}
                    strokeWidth={0.1}
                    strokeDasharray="0.4 0.3"
                    pointerEvents="none"
                  />
                )}
                <rect
                  x={box.x_mm}
                  y={box.y_mm}
                  width={Math.max(box.w_mm, 0.8)}
                  height={Math.max(box.h_mm, 0.8)}
                  fill="transparent"
                  style={{ cursor: el.locked ? 'not-allowed' : 'move' }}
                  onPointerDown={(e) => startDrag(e, el, 'move')}
                />
                {/* 잘림 표시 — 우하단 빨간 귀퉁이 */}
                {box.clipped && (
                  <path
                    d={`M ${box.x_mm + box.w_mm} ${box.y_mm + box.h_mm - 1.6} L ${box.x_mm + box.w_mm} ${box.y_mm + box.h_mm} L ${box.x_mm + box.w_mm - 1.6} ${box.y_mm + box.h_mm} Z`}
                    fill="#ef4444"
                    pointerEvents="none"
                  >
                    <title>이 샘플로는 글이 잘립니다</title>
                  </path>
                )}
              </g>
            );
          })}

          {/* 선택 표시 + 크기 핸들 */}
          {(template.layout || []).map((el) => {
            if (el.id !== selectedId || el.hidden) return null;
            const box = boxes.get(el.id);
            if (!box) return null;
            const outOfBounds =
              box.x_mm + box.w_mm > W + 0.05 || box.y_mm + box.h_mm > H + 0.05;
            const rotated = !!el.rotate;

            const handle = (cx: number, cy: number, mode: DragMode, cursor: string) => (
              <rect
                x={cx - handleMm / 2}
                y={cy - handleMm / 2}
                width={handleMm}
                height={handleMm}
                fill="#fff"
                stroke="#2563eb"
                strokeWidth={0.12}
                style={{ cursor }}
                onPointerDown={(e) => startDrag(e, el, mode)}
              />
            );

            return (
              <g key={`sel_${el.id}`}>
                <rect
                  x={box.x_mm}
                  y={box.y_mm}
                  width={Math.max(box.w_mm, 0.8)}
                  height={Math.max(box.h_mm, 0.8)}
                  fill="none"
                  stroke={outOfBounds ? '#dc2626' : '#2563eb'}
                  strokeWidth={0.18}
                  strokeDasharray="0.7 0.4"
                  pointerEvents="none"
                />
                {/* 텍스트: 오른쪽(폭) · 아래(높이) · 모서리(대각선) — 회전돼도 화면 기준으로 동작 */}
                {!el.locked && el.type === 'text' && (
                  <>
                    {handle(box.x_mm + box.w_mm, box.y_mm + box.h_mm / 2, 'resize-e', 'ew-resize')}
                    {handle(box.x_mm + box.w_mm / 2, box.y_mm + box.h_mm, 'resize-s', 'ns-resize')}
                    {handle(box.x_mm + box.w_mm, box.y_mm + box.h_mm, 'resize-se', 'nwse-resize')}
                  </>
                )}
                {!el.locked && !rotated && el.type === 'barcode' &&
                  handle(box.x_mm + box.w_mm / 2, box.y_mm + box.h_mm, 'resize-s', 'ns-resize')}
                {!el.locked && (el.type === 'box' || el.type === 'line' || el.type === 'image') &&
                  handle(box.x_mm + box.w_mm, box.y_mm + box.h_mm, 'resize-se', 'nwse-resize')}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
};

export default LabelCanvas;
