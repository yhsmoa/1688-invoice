'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FtOrderItem } from '../../import-product-v2/hooks/useFtData';
import {
  optionDbStatus,
  optionIdOf,
  type Board,
  type Card,
  type OptionGroup,
  type OptionStatus,
} from '../utils/buildBoards';
import { cardKeyOf, compareText, EMPTY_OPT, normOpt, optionKeyOf } from '../utils/groupKeys';
import type { BatchStatus } from '../hooks/useAllocationBatch';

// ============================================================
// 모달 왼쪽 — 구성품 범례 + "사이즈 → 색상" 순 옵션 목록
//
//   [화이트 이미지 SET 1/2] [블랙 이미지 SET 2/2]        ← 범례 (색상 확인용)
//   ─ 130 ─────────────────────────────
//     ▣ 화이트  130   [ 4 ] / 잔여 4
//     ▣ 블랙    130   [ 3 ] / 잔여 4      ← 세트 짝이 위아래로 붙어 불일치가 바로 보임
//   ─ 140 ─────────────────────────────
//     ▣ 화이트  140   [   ] / 잔여 4
//     ▣ 블랙    140   (이 배송에 없음 · 입고 0 / 주문 4)
//
// 처리 순서는 "옵션 하나씩" — 화이트 120 → [모두] → 블랙 120 → [모두] … (케어라벨이 섞이지 않게)
//   · Enter 는 수량만 확정하고 다음 입력칸으로 넘어가지 않는다 — 이어서 [저장]/[라벨]/[모두] 로 진행
//     (선택은 그 행에 남아 오른쪽 표에서 배분 결과를 바로 확인할 수 있다)
//   · 선택한 행만 또렷하게, 나머지는 흐리게. 저장 안 한 입력이 있는 옵션(lockedOptionId)이 있으면
//     다른 옵션은 전부(같은 색상의 다른 사이즈도) 입력 잠금
//   · 입력은 Enter / blur 에서 확정 → 부모가 주문행 순서대로 배분 (거부 시 빨간 테두리·되돌림)
//   · 입력한 적 없는 칸은 blur 해도 아무것도 하지 않는다 (저장된 배치를 지우지 않게)
// ============================================================

/** 입력 거부 표시 유지 시간 */
const ERROR_FLASH_MS = 1500;

interface OptionListProps {
  board: Board;
  /** 이 배송(검색 결과)에 없는 세트 구성품 */
  externalParts: FtOrderItem[];
  arrivalMap: Map<string, number>;
  alloc: Map<string, number>;
  status: BatchStatus;
  /** 저장 안 한 입력이 들어간 옵션 — 다른 옵션은 잠근다 */
  lockedOptionId: string | null;
  selectedOptionId: string | null;
  disabled: boolean;
  onSelectOption: (optionId: string) => void;
  /** 옵션 수량 확정 — 받아들였으면 true */
  onCommitOption: (optionId: string, qty: number) => boolean;
}

// ── 목록 한 줄 ──
type Line =
  | { kind: 'option'; key: string; card: Card; opt: OptionGroup }
  | {
      kind: 'external';
      key: string;
      color: string;
      size: string;
      imgUrl: string | null;
      arrived: number;
      ordered: number;
    };

// ── 범례 한 칸 (보드 카드 + 이 배송에 없는 색상) ──
interface LegendItem {
  key: string;
  color: string;
  imgUrl: string | null;
  setSeq: number | null;
  setTotal: number | null;
  external: boolean;
}

// ── 옵션 표시 상태 — 입력 중이면 입력값 기준, 아니면 DB 기준 ──
function viewStatus(opt: OptionGroup, pendingQty: number): OptionStatus {
  if (pendingQty > 0) return pendingQty >= opt.remainingTotal ? 'done' : 'partial';
  return optionDbStatus(opt);
}

// ── 사이즈 정렬 — 사이즈 없음('-') 은 맨 뒤 ──
function compareSize(a: string, b: string): number {
  if (a === EMPTY_OPT && b !== EMPTY_OPT) return 1;
  if (b === EMPTY_OPT && a !== EMPTY_OPT) return -1;
  return compareText(a, b);
}

const sizeLabel = (size: string) => (size === EMPTY_OPT ? 'FREE' : size);
const colorLabel = (color: string) => (color === EMPTY_OPT || !color ? '—' : color);

const OptionList: React.FC<OptionListProps> = ({
  board,
  externalParts,
  arrivalMap,
  alloc,
  status,
  lockedOptionId,
  selectedOptionId,
  disabled,
  onSelectOption,
  onCommitOption,
}) => {
  const { t } = useTranslation();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errorId, setErrorId] = useState<string | null>(null);
  const inputRefs = useRef(new Map<string, HTMLInputElement>());

  // ── 보드가 바뀌면 입력 초안 초기화 ──
  useEffect(() => {
    setDrafts({});
    setErrorId(null);
  }, [board.key]);

  useEffect(() => {
    if (!errorId) return;
    const timer = setTimeout(() => setErrorId(null), ERROR_FLASH_MS);
    return () => clearTimeout(timer);
  }, [errorId]);

  // ============================================================
  // 목록 구성 — 범례 / 사이즈별 묶음
  // ============================================================
  const { legend, groups } = useMemo(() => {
    // ── 이 배송에 없는 구성품: (색상 카드, 사이즈) 별로 합산 ──
    const externalByKey = new Map<
      string,
      { cardKey: string; color: string; size: string; imgUrl: string | null; setSeq: number | null; arrived: number; ordered: number }
    >();
    for (const r of externalParts) {
      const cardKey = cardKeyOf(r);
      const size = optionKeyOf(r);
      const key = `${cardKey}::${size}`;
      const entry = externalByKey.get(key) ?? {
        cardKey,
        color: normOpt(r.china_option1) || EMPTY_OPT,
        size,
        imgUrl: r.img_url,
        setSeq: r.set_seq,
        arrived: 0,
        ordered: 0,
      };
      entry.arrived += arrivalMap.get(r.id) ?? 0;
      entry.ordered += r.order_qty ?? 0;
      externalByKey.set(key, entry);
    }
    const externals = Array.from(externalByKey.values()).sort(
      (a, b) => (a.setSeq ?? Infinity) - (b.setSeq ?? Infinity)
    );

    // ── 범례: 보드 카드 → 보드에 없는 색상 ──
    const boardCardKeys = new Set(board.cards.map((c) => c.key));
    const legendItems: LegendItem[] = board.cards.map((c) => ({
      key: c.key,
      color: c.color,
      imgUrl: c.imgUrl,
      setSeq: c.hasSet ? c.setSeq : null,
      setTotal: c.setTotal,
      external: false,
    }));
    for (const e of externals) {
      if (boardCardKeys.has(e.cardKey) || legendItems.some((l) => l.key === e.cardKey)) continue;
      legendItems.push({
        key: e.cardKey,
        color: e.color,
        imgUrl: e.imgUrl,
        setSeq: e.setSeq,
        setTotal: board.cards[0]?.setTotal ?? null,
        external: true,
      });
    }

    // ── 사이즈별 묶음: 각 사이즈 안에서 보드 카드 순(SET 1 → 2) → 없는 구성품 ──
    const sizes = new Set<string>();
    for (const c of board.cards) for (const o of c.options) sizes.add(o.key);
    for (const e of externals) sizes.add(e.size);

    const sizeGroups = Array.from(sizes)
      .sort(compareSize)
      .map((size) => {
        const lines: Line[] = [];
        for (const card of board.cards) {
          const opt = card.options.find((o) => o.key === size);
          if (opt) lines.push({ kind: 'option', key: optionIdOf(card.key, opt.key), card, opt });
        }
        for (const e of externals) {
          if (e.size !== size) continue;
          lines.push({
            kind: 'external',
            key: `ext::${e.cardKey}::${e.size}`,
            color: e.color,
            size: e.size,
            imgUrl: e.imgUrl,
            arrived: e.arrived,
            ordered: e.ordered,
          });
        }
        return { size, lines };
      });

    return { legend: legendItems, groups: sizeGroups };
  }, [board, externalParts, arrivalMap]);

  /** 색상이 하나뿐이면 줄마다 색상을 붙이지 않는다 (단품) */
  const showColor = legend.length > 1;

  // ── 옵션별 배분 합 ──
  const allocSumOf = useCallback(
    (opt: OptionGroup) => opt.rows.reduce((n, r) => n + (alloc.get(r.id) ?? 0), 0),
    [alloc]
  );

  // ── 범례에서 강조할 색상: 입력 중인 옵션의 색상 → 없으면 선택한 옵션의 색상 ──
  const cardKeyOfOption = useCallback(
    (optionId: string | null) => {
      if (!optionId) return null;
      for (const card of board.cards) {
        if (card.options.some((o) => optionIdOf(card.key, o.key) === optionId)) return card.key;
      }
      return null;
    },
    [board]
  );
  const focusCardKey = cardKeyOfOption(lockedOptionId) ?? cardKeyOfOption(selectedOptionId);

  // ── 잠금 안내 문구용 — 입력 중인 옵션 이름 ("화이트 120cm") ──
  const lockedOptionLabel = useMemo(() => {
    if (!lockedOptionId) return '';
    for (const card of board.cards) {
      const opt = card.options.find((o) => optionIdOf(card.key, o.key) === lockedOptionId);
      if (opt) return [card.color !== EMPTY_OPT ? card.color : '', sizeLabel(opt.size)].filter(Boolean).join(' ');
    }
    return '';
  }, [board, lockedOptionId]);


  const focusOption = useCallback(
    (optionId: string) => {
      onSelectOption(optionId);
      const el = inputRefs.current.get(optionId);
      if (el && !el.disabled) {
        el.focus();
        el.select();
      }
    },
    [onSelectOption]
  );

  // ── 확정 — 초안이 있을 때만 ──
  const commit = useCallback(
    (optionId: string) => {
      const draft = drafts[optionId];
      if (draft === undefined) return;
      const qty = draft.trim() === '' ? 0 : parseInt(draft, 10) || 0;
      const accepted = onCommitOption(optionId, qty);
      if (!accepted) setErrorId(optionId);
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[optionId];
        return next;
      });
    },
    [drafts, onCommitOption]
  );

  const clearDraft = (optionId: string) =>
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[optionId];
      return next;
    });

  // ── 썸네일 ──
  const thumb = (imgUrl: string | null, alt: string, className: string) =>
    imgUrl ? (
      <img
        className={className}
        src={`/api/image-proxy?url=${encodeURIComponent(imgUrl)}`}
        alt={alt}
        onError={(e) => {
          (e.target as HTMLImageElement).src = '/placeholder.svg';
        }}
      />
    ) : (
      <span className={`${className} v3-thumb-empty`}>-</span>
    );

  return (
    <div className="v3-option-list">
      {/* ============================================================ */}
      {/* 범례 — 구성품(색상)별 이미지                                   */}
      {/* ============================================================ */}
      <div className="v3-option-legend">
        {legend.map((item) => (
          <div
            key={item.key}
            className={[
              'v3-legend-item',
              item.external ? 'v3-legend-external' : '',
              focusCardKey === item.key ? 'v3-legend-active' : '',
            ].join(' ')}
          >
            {thumb(item.imgUrl, item.color, 'v3-legend-image')}
            <div className="v3-legend-info">
              {item.setSeq != null && (
                <span className="v3-option-set-badge">
                  {t('importProductV3.modal.setPart', {
                    seq: item.setSeq,
                    total: item.setTotal ?? legend.length,
                  })}
                </span>
              )}
              {item.external && (
                <span className="v3-option-external-badge">{t('importProductV3.modal.notInDelivery')}</span>
              )}
              <div className="v3-legend-color" title={item.color}>
                {colorLabel(item.color)}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ============================================================ */}
      {/* 사이즈별 묶음                                                 */}
      {/* ============================================================ */}
      <div className="v3-size-groups">
        {groups.map(({ size, lines }) => (
          <section key={size} className="v3-size-group">
            {showColor && <div className="v3-size-group-label">{sizeLabel(size)}</div>}

            {lines.map((line) => {
              // ── 이 배송에 없는 구성품 (표시만) ──
              if (line.kind === 'external') {
                return (
                  <div key={line.key} className="v3-option-row v3-option-closed v3-option-external-row">
                    {showColor && thumb(line.imgUrl, line.color, 'v3-option-thumb')}
                    {showColor && (
                      <span className="v3-option-color" title={line.color}>
                        {colorLabel(line.color)}
                      </span>
                    )}
                    <span className="v3-option-size">{sizeLabel(line.size)}</span>
                    <span className="v3-option-external-note">
                      {t('importProductV3.modal.notInDelivery')} ·{' '}
                      {t('importProductV3.modal.arrivedOf', { arrived: line.arrived, total: line.ordered })}
                    </span>
                  </div>
                );
              }

              // ── 입력 가능한 옵션 ──
              const { card, opt } = line;
              const id = line.key;
              const sum = allocSumOf(opt);
              const pending = status === 'editing' ? sum : 0;
              const st = viewStatus(opt, pending);
              const closed = opt.remainingTotal === 0;
              const locked = lockedOptionId !== null && lockedOptionId !== id;
              // 선택한 행만 또렷하게 — 나머지 행은 흐리게 (같은 색상이어도)
              const dim = selectedOptionId !== null && selectedOptionId !== id;
              const value = drafts[id] ?? (pending > 0 ? String(pending) : '');

              return (
                <div
                  key={id}
                  className={[
                    'v3-option-row',
                    `v3-status-${st}`,
                    selectedOptionId === id ? 'v3-option-selected' : '',
                    closed ? 'v3-option-closed' : '',
                    dim ? 'v3-option-dim' : '',
                  ].join(' ')}
                  title={locked ? t('importProductV3.modal.finishOptionFirst', { option: lockedOptionLabel }) : undefined}
                  onClick={() => (closed || locked ? onSelectOption(id) : focusOption(id))}
                >
                  {showColor && thumb(card.imgUrl, card.color, 'v3-option-thumb')}
                  {showColor && (
                    <span className="v3-option-color" title={card.color}>
                      {colorLabel(card.color)}
                    </span>
                  )}
                  <span className="v3-option-size">{sizeLabel(opt.size)}</span>
                  <input
                    ref={(el) => {
                      if (el) inputRefs.current.set(id, el);
                      else inputRefs.current.delete(id);
                    }}
                    className={`v3-option-input ${errorId === id ? 'v3-input-error' : ''}`}
                    type="text"
                    inputMode="numeric"
                    value={value}
                    placeholder={closed ? '' : String(opt.remainingTotal)}
                    disabled={disabled || closed || locked}
                    onFocus={() => onSelectOption(id)}
                    onChange={(e) => {
                      const cleaned = e.target.value.replace(/[^0-9]/g, '');
                      setDrafts((prev) => ({ ...prev, [id]: cleaned }));
                    }}
                    onBlur={() => commit(id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        // 확정만 한다 (blur → onBlur 에서 commit). 다음 칸으로 이동하지 않음
                        e.preventDefault();
                        (e.target as HTMLInputElement).blur();
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        clearDraft(id);
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                  />
                  <span className="v3-option-qty">
                    {closed
                      ? t('importProductV3.card.done')
                      : t('importProductV3.modal.remainingOf', { remaining: opt.remainingTotal, total: opt.orderTotal })}
                  </span>
                  {status === 'saved' && sum > 0 && <span className="v3-option-saved">✓ {sum}</span>}
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
};

export default OptionList;
