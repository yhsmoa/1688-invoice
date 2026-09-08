'use client';

import React from 'react';
import type { LabelElement } from '../../../lib/labelTypes';

// ============================================================
// 캔버스 툴바 — 요소 추가 · 정렬 · 되돌리기 · 화면 배율
//
// 저장/삭제/테스트출력 같은 "템플릿 전체" 동작은 페이지 상단 헤더에 있다.
// 여기는 캔버스에서 손이 자주 가는 것만 둔다.
// ============================================================

export type AlignAction = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

const ADD_BUTTONS: { type: LabelElement['type']; label: string }[] = [
  { type: 'text', label: '텍스트' },
  { type: 'barcode', label: '바코드' },
  { type: 'qr', label: 'QR' },
  { type: 'box', label: '박스' },
  { type: 'line', label: '선' },
  { type: 'image', label: '이미지·기호' },
];

const ALIGN_BUTTONS: { action: AlignAction; label: string; title: string }[] = [
  { action: 'left', label: '⇤', title: '라벨 왼쪽에 붙이기' },
  { action: 'hcenter', label: '↔', title: '가로 가운데' },
  { action: 'right', label: '⇥', title: '라벨 오른쪽에 붙이기' },
  { action: 'top', label: '⇑', title: '라벨 위에 붙이기' },
  { action: 'vcenter', label: '↕', title: '세로 가운데' },
  { action: 'bottom', label: '⇓', title: '라벨 아래에 붙이기' },
];

const SNAP_OPTIONS = [
  { value: 0, label: '자유' },
  { value: 0.5, label: '0.5mm' },
  { value: 1, label: '1mm' },
];

interface Props {
  onAdd: (type: LabelElement['type']) => void;
  scale: number;
  onScale: (v: number) => void;
  onFit: () => void;
  showGrid: boolean;
  onShowGrid: (v: boolean) => void;
  snapMm: number;
  onSnapMm: (v: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  hasSelection: boolean;
  onAlign: (a: AlignAction) => void;
}

const CanvasToolbar: React.FC<Props> = ({
  onAdd,
  scale,
  onScale,
  onFit,
  showGrid,
  onShowGrid,
  snapMm,
  onSnapMm,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  hasSelection,
  onAlign,
}) => (
  <div className="lc-toolbar">
    {/* 요소 추가 */}
    <div className="lc-tool-group">
      {ADD_BUTTONS.map((b) => (
        <button key={b.type} className="ls-btn-sm" onClick={() => onAdd(b.type)}>
          + {b.label}
        </button>
      ))}
    </div>

    <span className="lc-sep" />

    {/* 정렬 */}
    <div className="lc-tool-group">
      {ALIGN_BUTTONS.map((b) => (
        <button
          key={b.action}
          className="ls-btn-icon"
          title={b.title}
          disabled={!hasSelection}
          onClick={() => onAlign(b.action)}
        >
          {b.label}
        </button>
      ))}
    </div>

    <span className="lc-sep" />

    {/* 되돌리기 */}
    <div className="lc-tool-group">
      <button className="ls-btn-icon" title="되돌리기 (Ctrl+Z)" disabled={!canUndo} onClick={onUndo}>
        ↶
      </button>
      <button className="ls-btn-icon" title="다시하기 (Ctrl+Y)" disabled={!canRedo} onClick={onRedo}>
        ↷
      </button>
    </div>

    <span className="lc-spacer" />

    {/* 화면 배율 · 격자 · 스냅 */}
    <div className="lc-tool-group">
      <label className="lc-inline">
        <input
          type="checkbox"
          checked={showGrid}
          onChange={(e) => onShowGrid(e.target.checked)}
        />
        격자
      </label>

      <label className="lc-inline">
        스냅
        <select value={snapMm} onChange={(e) => onSnapMm(Number(e.target.value))}>
          {SNAP_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <label className="lc-inline lc-zoom">
        확대
        <input
          type="range"
          min={3}
          max={20}
          step={0.5}
          value={scale}
          onChange={(e) => onScale(Number(e.target.value))}
        />
        <span className="lc-zoom-val">{scale.toFixed(1)}×</span>
      </label>

      <button className="ls-btn-sm" onClick={onFit}>
        화면 맞춤
      </button>
    </div>
  </div>
);

export default CanvasToolbar;
