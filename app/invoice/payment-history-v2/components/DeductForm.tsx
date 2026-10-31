'use client';

import React from 'react';
import { deductAmounts, fmtYuan, todayKST, type DeductFormState } from '../utils/customerLedger';

// ============================================================
// DeductForm — 고객계좌(신) 수동 차감 입력 폼 (공용)
//
//   · 고객계좌(신) [추가] 모달의 '차감' 탭
//   · 주문 검사 [비용처리] → 고객기업 계좌 차감 모달
//   두 화면이 같은 폼을 쓴다. 스타일은 PaymentHistoryV2.css 의 phv2-* 클래스.
//   입력값만 다루고, 검증·기록은 utils/customerLedger.ts + 호출 측이 담당한다.
// ============================================================

/**
 * 차감 항목 프리셋 — 과거 수동 차감 기록(주문코드 차감 제외)에서 자주 쓰인 순.
 *   부자재(포장재·라벨)는 1688 주문번호 + 비고에 "규격-수량" 을 적는 패턴,
 *   공임비는 월말 적용일 + 주문번호 없이 기록하는 패턴이다.
 */
const DEDUCT_PRESETS: { group: string; items: string[] }[] = [
  { group: '포장재', items: ['속포장 비닐', '폴리백 지퍼 포장지', '택배박스', '겉포장 비닐'] },
  { group: '라벨', items: ['감열지 라벨', '케어라벨', '케어라벨 리본', '봉제 라벨', '브랜드 라벨', '로켓그로스 라벨 스티커'] },
  { group: '기타', items: ['공임비', '누락 운임비'] },
];

interface Props {
  form: DeductFormState;
  onChange: (next: DeductFormState) => void;
  /** 비용 상세(배송비·서비스비·기타) 펼침 — 수동 차감은 대부분 비용 분해가 없어 기본 접힘 */
  showFeeDetail: boolean;
  onToggleFeeDetail: () => void;
}

const DeductForm: React.FC<Props> = ({ form, onChange, showFeeDetail, onToggleFeeDetail }) => {
  const { amount: deductAmt, fees: deductFees, itemAmount: deductItemAmt } = deductAmounts(form);
  const isLaborItem = form.description.includes('공임비');

  return (
    <div className="phv2-form">
      {/* ── 항목 + 프리셋 ── */}
      <div className="phv2-form-item">
        <label>항목 <em>*</em></label>
        <input type="text" placeholder="아래에서 선택하거나 직접 입력" value={form.description} onChange={(e) => onChange({ ...form, description: e.target.value })} />
        <div className="phv2-presets">
          {DEDUCT_PRESETS.map(g => (
            <div className="phv2-preset-group" key={g.group}>
              <span className="phv2-preset-label">{g.group}</span>
              <div className="phv2-preset-chips">
                {g.items.map(label => (
                  <button
                    key={label}
                    type="button"
                    className={`phv2-chip ${form.description === label ? 'active' : ''}`}
                    onClick={() => onChange({ ...form, description: label })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── 금액 + 적용일 ── */}
      <div className="phv2-form-row">
        <div className="phv2-form-item">
          <label>전체금액 <em>*</em></label>
          <div className="phv2-input-affix">
            <span>¥</span>
            <input type="number" min="0" step="0.01" placeholder="0.00" value={form.amount} onChange={(e) => onChange({ ...form, amount: e.target.value })} />
          </div>
        </div>
        <div className="phv2-form-item">
          <label>적용일 <em>*</em></label>
          <input type="date" value={form.date} max={todayKST()} onChange={(e) => onChange({ ...form, date: e.target.value })} />
        </div>
      </div>

      {/* ── 1688 주문번호 + 관리자 비고 ── */}
      <div className="phv2-form-item">
        <label>1688 주문번호 <span className="phv2-form-optional">선택</span></label>
        <input
          type="text"
          placeholder={isLaborItem ? '공임비는 비워둡니다' : '부자재를 구매한 1688 주문번호'}
          value={form.order1688Id}
          onChange={(e) => onChange({ ...form, order1688Id: e.target.value })}
        />
      </div>
      <div className="phv2-form-item">
        <label>관리자 비고 <span className="phv2-form-optional">선택</span></label>
        <textarea
          placeholder={isLaborItem ? '예: 검수 24, 포장 22' : '규격-수량  예: 30*30-10000, 25*20-3000'}
          rows={2}
          value={form.adminNote}
          onChange={(e) => onChange({ ...form, adminNote: e.target.value })}
        />
      </div>

      {/* ── 비용 상세 — 수동 차감은 대부분 쓰지 않아 기본 접힘 ── */}
      <div className="phv2-fee-detail">
        <button type="button" className="phv2-fee-toggle" onClick={onToggleFeeDetail}>
          <span>{showFeeDetail ? '▾' : '▸'} 비용 상세 (배송비 · 서비스비 · 기타)</span>
          {deductFees > 0 && <span className="phv2-fee-sum">합계 {fmtYuan(deductFees)}</span>}
        </button>
        {showFeeDetail && (
          <>
            <div className="phv2-form-row">
              <div className="phv2-form-item">
                <label>배송비</label>
                <input type="number" min="0" step="0.01" placeholder="0" value={form.deliveryFee} onChange={(e) => onChange({ ...form, deliveryFee: e.target.value })} />
              </div>
              <div className="phv2-form-item">
                <label>서비스비</label>
                <input type="number" min="0" step="0.01" placeholder="0" value={form.serviceFee} onChange={(e) => onChange({ ...form, serviceFee: e.target.value })} />
              </div>
              <div className="phv2-form-item">
                <label>기타비용</label>
                <input type="number" min="0" step="0.01" placeholder="0" value={form.extraFee} onChange={(e) => onChange({ ...form, extraFee: e.target.value })} />
              </div>
            </div>
            <div className={`phv2-form-hint ${deductItemAmt < 0 ? 'is-error' : ''}`}>
              {deductItemAmt < 0
                ? '비용 합계가 전체금액을 초과합니다.'
                : `전체금액에 포함된 비용입니다. 지출금액 = ${fmtYuan(deductAmt)} − ${fmtYuan(deductFees)} = ${fmtYuan(deductItemAmt)}`}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default DeductForm;
