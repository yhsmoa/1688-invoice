'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import TypeBadge from '../../../component/TypeBadge';
import type { FtOrderItem } from '../hooks/useFtData';
import {
  distributeQty,
  findSetMismatches,
  remainingQtyOf,
  type GroupBoard,
  type SetMismatch,
} from '../utils/groupBoards';
import './GroupInputModal.css';

// ============================================================
// GroupInputModal — [그룹입력] 모달 (상품입고 V2)
//
// 현재 검색 결과를 그룹(보드) 단위로 보여 주고, 그룹마다 수량 하나를 받아
// 글번호 순서대로 잔여 한도(order_qty − 입고 − 취소)까지 작업 수량을 나눠 넣는다.
//   · 단품 그룹 : [타입 배지] [이미지] [옵션1 / 옵션2] [입력] / 작업 가능 합계
//   · 세트 그룹 : 세트끼리 한 카드 — 구성품(set_seq)마다 입력 한 칸씩
//
// [입력] 을 누르면 테이블 작업 열(modifiedImportQty)에 그대로 들어간다. 저장은 [입고] 에서.
//   · 입력값이 작업 가능 합계를 넘으면 빨갛게 표시하고 [입력] 을 막는다
//   · 세트 구성품의 (입고 + 작업) 이 서로 다른 주문이 있으면 [입력] 왼쪽에 경고를 띄우고,
//     [입력] 클릭 시 어떤 주문인지 보여 준 뒤 그대로 진행할지 묻는다
//   · 모달을 열 때 입력칸은 지금 테이블에 들어 있는 작업 수량의 그룹 합으로 채운다
//     (비우고 [입력] 하면 그 그룹의 작업 수량이 지워진다)
//
// 렌더 비용 — 그룹이 수백 개라 키 입력마다 전부 다시 그리면 타이핑이 밀린다.
//   입력 단위 한 줄은 React.memo 된 GroupInputUnitRow 이고, 값·합계·초과 여부를 원시값으로만
//   받는다 → 글자를 친 그 줄만 다시 그린다. 핸들러 참조는 고정(useCallback, deps 없음).
// ============================================================

interface GroupInputModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 현재 검색 결과(전체 페이지)를 그룹으로 묶은 보드 */
  boards: GroupBoard[];
  /** 테이블 작업 열 현재값 (item.id → qty) */
  modifiedImportQty: Map<string, number>;
  arrivalMap: Map<string, number>;
  cancelMap: Map<string, number>;
  /** [입력] 확정 — 새 작업 수량 Map 전체 */
  onApply: (next: Map<string, number>) => void;
}

// ── 입력 단위 — 단품 보드 1개 또는 세트 구성품 1개 ──
interface InputUnit {
  id: string;
  boardKey: string;
  rows: FtOrderItem[];
  option1: string;
  option2: string;
  imgUrl: string | null;
  itemName: string;
  /** 세트 구성품 순번 (단품이면 null) */
  seq: number | null;
}

const ICON = {
  close: 'M6 6l12 12M18 6L6 18',
  warn: 'M12 3l9.5 17h-19zM12 10v4M12 17h.01',
  check: 'M5 12l5 5L19 7',
} as const;

const Icon: React.FC<{ name: keyof typeof ICON; size?: number }> = ({ name, size = 16 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
    <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d={ICON[name]} />
  </svg>
);

const sumBy = (rows: FtOrderItem[], pick: (row: FtOrderItem) => number) =>
  rows.reduce((acc, row) => acc + pick(row), 0);

// ============================================================
// 입력 단위 한 줄 — [순번] [이미지] [옵션 · 상품명 · 주문 n건] [입력 / 합계]  (memo)
// ============================================================
interface GroupInputUnitRowProps {
  unit: InputUnit;
  value: string;
  total: number;
  isOver: boolean;
  onChange: (id: string, raw: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

const GroupInputUnitRow = React.memo<GroupInputUnitRowProps>(({ unit, value, total, isOver, onChange, onKeyDown }) => {
  const { t } = useTranslation();
  const isDone = total <= 0;
  return (
    <div className={`v2-gi-unit ${isDone ? 'is-done' : ''} ${isOver ? 'is-over' : ''}`}>
      {unit.seq != null && <span className="v2-gi-unit-seq">{unit.seq}</span>}
      <div className="v2-gi-unit-image">
        {unit.imgUrl ? (
          <img
            src={`/api/image-proxy?url=${encodeURIComponent(unit.imgUrl)}`}
            alt=""
            loading="lazy"
            onError={(e) => { (e.target as HTMLImageElement).src = '/placeholder.svg'; }}
          />
        ) : (
          <div className="v2-gi-no-image">-</div>
        )}
      </div>
      <div className="v2-gi-unit-info">
        <div className="v2-gi-unit-options">
          <span className="v2-gi-option1">{unit.option1 || '-'}</span>
          {unit.option2 && <span className="v2-gi-option2">{unit.option2}</span>}
        </div>
        {unit.seq == null && (
          <div className="v2-gi-unit-name" title={unit.itemName}>{unit.itemName}</div>
        )}
        <div className="v2-gi-unit-meta">
          {t('importProductV2.groupInput.orders', { count: unit.rows.length })}
        </div>
      </div>
      <div className="v2-gi-unit-qty">
        <input
          type="text"
          inputMode="numeric"
          className="v2-gi-input"
          value={value}
          placeholder="0"
          disabled={isDone}
          aria-invalid={isOver || undefined}
          onChange={(e) => onChange(unit.id, e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={(e) => e.currentTarget.select()}
        />
        <span className="v2-gi-sep">/</span>
        <span className="v2-gi-total" title={t('importProductV2.groupInput.available')}>
          {isDone ? t('importProductV2.groupInput.done') : total}
        </span>
      </div>
    </div>
  );
});
GroupInputUnitRow.displayName = 'GroupInputUnitRow';

// ============================================================
// 그룹 카드 — 단품은 단위 한 줄, 세트는 헤더 + 구성품 줄  (memo)
//   비교 규칙: 보드·단위·합계 참조가 같고, 이 카드 단위들의 입력값·초과 여부가 같으면 건너뛴다.
//   inputs / overLimitIds 는 키 입력마다 새 객체지만 "이 카드 몫" 만 비교하므로
//   글자를 친 카드만 다시 그린다 (그룹이 수백 개라도 입력이 밀리지 않도록).
// ============================================================
interface GroupInputCardProps {
  board: GroupBoard;
  units: InputUnit[];
  inputs: Record<string, string>;
  totals: Map<string, number>;
  overLimitIds: Set<string>;
  onChange: (id: string, raw: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

const GroupInputCard = React.memo<GroupInputCardProps>(
  ({ board, units, inputs, totals, overLimitIds, onChange, onKeyDown }) => {
    const { t } = useTranslation();
    return (
      <div className={`v2-gi-card ${board.isSet ? 'is-set' : ''}`}>
        <div className="v2-gi-card-head">
          {board.badge && <TypeBadge info={board.badge} />}
          {board.isSet && (
            <span className="v2-set-badge">
              {t('importProductV2.set.label')} {board.setTotal}中
            </span>
          )}
          {board.isSet && (
            <span className="v2-gi-card-name" title={board.itemName}>{board.itemName}</span>
          )}
          {board.isSet && (
            <span className="v2-gi-card-meta">
              {t('importProductV2.groupInput.orders', { count: board.setInstanceCount })}
            </span>
          )}
        </div>
        {units.map((unit) => (
          <GroupInputUnitRow
            key={unit.id}
            unit={unit}
            value={inputs[unit.id] ?? ''}
            total={totals.get(unit.id) ?? 0}
            isOver={overLimitIds.has(unit.id)}
            onChange={onChange}
            onKeyDown={onKeyDown}
          />
        ))}
      </div>
    );
  },
  (prev, next) =>
    prev.board === next.board
    && prev.units === next.units
    && prev.totals === next.totals
    && prev.onChange === next.onChange
    && prev.onKeyDown === next.onKeyDown
    && prev.units.every(
      (u) =>
        (prev.inputs[u.id] ?? '') === (next.inputs[u.id] ?? '')
        && prev.overLimitIds.has(u.id) === next.overLimitIds.has(u.id)
    )
);
GroupInputCard.displayName = 'GroupInputCard';

const GroupInputModal: React.FC<GroupInputModalProps> = ({
  isOpen,
  onClose,
  boards,
  modifiedImportQty,
  arrivalMap,
  cancelMap,
  onApply,
}) => {
  const { t } = useTranslation();

  // ============================================================
  // 입력 단위 목록 — 보드 순서 그대로 (세트는 구성품 순)
  // ============================================================
  const units: InputUnit[] = useMemo(() => {
    const out: InputUnit[] = [];
    for (const board of boards) {
      if (board.isSet) {
        for (const comp of board.components) {
          out.push({
            id: `${board.key}#${comp.seq}`,
            boardKey: board.key,
            rows: comp.rows,
            option1: comp.option1,
            option2: comp.option2,
            imgUrl: comp.imgUrl,
            itemName: comp.itemName,
            seq: comp.seq,
          });
        }
      } else {
        out.push({
          id: board.key,
          boardKey: board.key,
          rows: board.rows,
          option1: board.option1,
          option2: board.option2,
          imgUrl: board.imgUrl,
          itemName: board.itemName,
          seq: null,
        });
      }
    }
    return out;
  }, [boards]);

  /** 보드 키 → 그 보드의 입력 단위들 (세트 카드 렌더용, 매 렌더 filter 방지) */
  const unitsByBoard = useMemo(() => {
    const map = new Map<string, InputUnit[]>();
    for (const u of units) {
      const list = map.get(u.boardKey) ?? [];
      list.push(u);
      map.set(u.boardKey, list);
    }
    return map;
  }, [units]);

  /** 단위별 작업 가능 합계 (잔여 = order − 입고 − 취소) — 입고 맵이 바뀔 때만 다시 계산 */
  const totals = useMemo(() => {
    const map = new Map<string, number>();
    for (const u of units) map.set(u.id, sumBy(u.rows, (row) => remainingQtyOf(row, arrivalMap, cancelMap)));
    return map;
  }, [units, arrivalMap, cancelMap]);
  const totalOf = useCallback((unit: InputUnit) => totals.get(unit.id) ?? 0, [totals]);

  // ============================================================
  // 입력값 — 모달을 열 때 테이블 작업 수량의 그룹 합으로 채운다
  // ============================================================
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [confirmList, setConfirmList] = useState<SetMismatch[] | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const next: Record<string, string> = {};
    for (const unit of units) {
      const current = sumBy(unit.rows, (row) => modifiedImportQty.get(row.id) ?? 0);
      next[unit.id] = current > 0 ? String(current) : '';
    }
    setInputs(next);
    setConfirmList(null);
    // units 는 boards 에서 파생 — 모달이 열려 있는 동안 검색 결과가 바뀌면 다시 채운다
  }, [isOpen, units, modifiedImportQty]);

  const handleChange = useCallback((id: string, raw: string) => {
    const cleaned = raw.replace(/[^0-9]/g, '');
    setInputs((prev) => ({ ...prev, [id]: cleaned }));
  }, []);

  // Enter → 다음 입력칸으로 (스캔·키보드 작업 흐름)
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const all = Array.from(
      (e.currentTarget.closest('.v2-gi-modal') ?? document).querySelectorAll<HTMLInputElement>('input.v2-gi-input:not(:disabled)')
    );
    const idx = all.indexOf(e.currentTarget);
    if (idx >= 0 && idx < all.length - 1) {
      all[idx + 1].focus();
      all[idx + 1].select();
    }
  }, []);

  // ============================================================
  // 배분 결과 — 입력값으로 만든 새 작업 수량 Map (테이블에 그대로 들어갈 값)
  //   모달에 보이는 단위의 행은 전부 지운 뒤 입력값을 글번호 순으로 다시 배분한다.
  //   보이지 않는 행(검색 밖)의 작업 수량은 건드리지 않는다.
  // ============================================================
  const { workMap, overLimitIds } = useMemo(() => {
    const next = new Map(modifiedImportQty);
    const over = new Set<string>();
    for (const unit of units) {
      unit.rows.forEach((row) => next.delete(row.id));
      const qty = parseInt(inputs[unit.id] || '0', 10) || 0;
      if (qty <= 0) continue;
      if (qty > totalOf(unit)) over.add(unit.id);
      distributeQty(unit.rows, qty, arrivalMap, cancelMap).forEach((v, id) => next.set(id, v));
    }
    return { workMap: next, overLimitIds: over };
  }, [units, inputs, modifiedImportQty, arrivalMap, cancelMap, totalOf]);

  const mismatches = useMemo(
    () => findSetMismatches(boards, workMap, arrivalMap),
    [boards, workMap, arrivalMap]
  );

  const hasInput = useMemo(
    () => units.some((u) => (parseInt(inputs[u.id] || '0', 10) || 0) > 0),
    [units, inputs]
  );

  // ============================================================
  // [입력] — 한도 초과면 막고, 세트 불일치면 확인 후 적용
  // ============================================================
  const apply = useCallback(() => {
    onApply(workMap);
    setConfirmList(null);
    onClose();
  }, [onApply, workMap, onClose]);

  const handleSubmit = useCallback(() => {
    if (overLimitIds.size > 0) {
      alert(t('importProductV2.groupInput.overLimit'));
      return;
    }
    if (mismatches.length > 0) {
      setConfirmList(mismatches);
      return;
    }
    apply();
  }, [overLimitIds, mismatches, apply, t]);

  return (
    <>
      {isOpen && <div className="v2-gi-overlay" onClick={onClose} />}

      <div className={`v2-gi-modal ${isOpen ? 'open' : ''}`} role="dialog" aria-modal="true">
        {/* ── 헤더 ── */}
        <div className="v2-gi-header">
          <div className="v2-gi-title-wrap">
            <h2>{t('importProductV2.groupInput.title')}</h2>
            <span className="v2-gi-count">{t('importProductV2.groupInput.groups', { count: boards.length })}</span>
          </div>
          <button className="v2-gi-close" onClick={onClose} type="button" aria-label="close">
            <Icon name="close" size={20} />
          </button>
        </div>

        {/* ── 그룹 목록 — 닫혀 있을 때는 그리지 않는다 (수백 카드가 페이지 렌더마다 따라 그려지는 것 방지) ── */}
        <div className="v2-gi-content">
          {!isOpen ? null : boards.length === 0 ? (
            <div className="v2-gi-empty">{t('importProductV2.groupInput.empty')}</div>
          ) : (
            <>
              <p className="v2-gi-hint">{t('importProductV2.groupInput.hint')}</p>
              <div className="v2-gi-list">
                {boards.map((board) => (
                  <GroupInputCard
                    key={board.key}
                    board={board}
                    units={unitsByBoard.get(board.key) ?? []}
                    inputs={inputs}
                    totals={totals}
                    overLimitIds={overLimitIds}
                    onChange={handleChange}
                    onKeyDown={handleKeyDown}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {/* ── 푸터 — [세트 불일치 경고] … [취소] [입력] ── */}
        <div className="v2-gi-footer">
          {mismatches.length > 0 ? (
            <button
              type="button"
              className="v2-gi-mismatch"
              onClick={() => setConfirmList(mismatches)}
              title={t('importProductV2.groupInput.mismatchTitle')}
            >
              <Icon name="warn" size={15} />
              {t('importProductV2.groupInput.mismatch', { count: mismatches.length })}
            </button>
          ) : (
            <span className="v2-gi-footer-spacer" />
          )}
          <div className="v2-gi-footer-actions">
            <button type="button" className="v2-gi-btn-cancel" onClick={onClose}>
              {t('importProductV2.groupInput.cancel')}
            </button>
            <button
              type="button"
              className="v2-gi-btn-submit"
              disabled={boards.length === 0 || overLimitIds.size > 0}
              onClick={handleSubmit}
            >
              <Icon name="check" size={16} />
              {t('importProductV2.groupInput.submit')}
            </button>
          </div>
        </div>

        {/* ── 세트 불일치 확인 — 어떤 주문의 구성품 수량이 다른지 보여 주고 진행 여부를 묻는다 ── */}
        {confirmList && (
          <div className="v2-gi-confirm" role="alertdialog" aria-modal="true">
            <div className="v2-gi-confirm-box">
              <h3><Icon name="warn" size={18} />{t('importProductV2.groupInput.mismatchTitle')}</h3>
              <p>{t('importProductV2.groupInput.mismatchBody')}</p>
              <ul className="v2-gi-confirm-list">
                {confirmList.map((m) => (
                  <li key={m.productId}>
                    <div className="v2-gi-confirm-order">
                      <span className="v2-gi-confirm-no">{m.productNo || m.productId}</span>
                      {m.orderNo && <span className="v2-gi-confirm-orderno">{m.orderNo}</span>}
                    </div>
                    <ul className="v2-gi-confirm-parts">
                      {m.parts.map((p) => (
                        <li key={`${m.productId}-${p.seq}`} className="v2-gi-confirm-part">
                          <span className="v2-gi-unit-seq">{p.seq}</span>
                          <span className="v2-gi-confirm-part-opt">
                            {p.option1 || '-'}{p.option2 ? ` ${p.option2}` : ''}
                          </span>
                          <span className="v2-gi-confirm-part-qty">
                            {t('importProductV2.groupInput.arrivalPlusWork', { arrival: p.arrival, work: p.work })}
                            <b> = {p.arrival + p.work}</b>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
              <div className="v2-gi-confirm-actions">
                <button type="button" className="v2-gi-btn-cancel" onClick={() => setConfirmList(null)}>
                  {t('importProductV2.groupInput.back')}
                </button>
                <button type="button" className="v2-gi-btn-proceed" onClick={apply} disabled={!hasInput && mismatches.length === 0}>
                  {t('importProductV2.groupInput.proceed')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export default GroupInputModal;
