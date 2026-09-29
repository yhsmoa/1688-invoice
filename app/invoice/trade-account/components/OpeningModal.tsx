'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { fmtYuan } from '../../../../lib/tradeLedger';
import { tradeFetch } from '../hooks/useTradeApi';

// ============================================================
// OpeningModal — 이월 (1회): 현재 통장잔고 + 미러링할 고객 그룹
//   통장잔고 = 회사자산 + 고객 충전금 → 회사자산은 서버가 고객 원장 스냅샷으로 계산
// ============================================================

interface FtUser {
  id: string;
  user_code: string | null;
  username: string | null;
  vender_name: string | null;
  balance_id: string | null;
}

interface GroupOption {
  balanceId: string;
  label: string;
}

interface Props {
  onClose: () => void;
  onOpened: () => void;
}

const OpeningModal: React.FC<Props> = ({ onClose, onOpened }) => {
  const [users, setUsers] = useState<FtUser[]>([]);
  const [balanceId, setBalanceId] = useState('');
  const [bank, setBank] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/ft/users');
        const json = await res.json();
        if (json.success) setUsers(json.data as FtUser[]);
      } catch (e) {
        console.error('이월 모달 사용자 조회 오류:', e);
      }
    })();
  }, []);

  const groups: GroupOption[] = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const u of users) {
      if (!u.balance_id) continue;
      const codes = map.get(u.balance_id) ?? [];
      codes.push(`${u.vender_name || u.username || ''} ${u.user_code || ''}`.trim());
      map.set(u.balance_id, codes);
    }
    return Array.from(map.entries()).map(([id, codes]) => ({ balanceId: id, label: codes.join(', ') }));
  }, [users]);

  const bankNum = Number(bank);
  const valid = !!balanceId && bank !== '' && Number.isFinite(bankNum);

  const handleSave = async () => {
    if (!valid || saving) return;
    const group = groups.find((g) => g.balanceId === balanceId);
    const ok = window.confirm(
      `이월을 설정합니다. 한 번 설정하면 되돌릴 수 없습니다.\n\n통장잔고: ${fmtYuan(bankNum)}\n고객 그룹: ${group?.label ?? balanceId}\n\n이 시각 이후의 고객 거래부터 무역계좌에 기록됩니다. 진행할까요?`,
    );
    if (!ok) return;
    setSaving(true);
    try {
      const json = await tradeFetch<{ result: { bank_balance: number; customer_balance: number; asset_balance: number } }>('open', {
        method: 'POST',
        body: JSON.stringify({ bank_balance: bankNum, balance_id: balanceId }),
      });
      alert(`이월 완료\n\n통장잔고 ${fmtYuan(json.result.bank_balance)}\n고객 충전금 ${fmtYuan(json.result.customer_balance)}\n회사자산 ${fmtYuan(json.result.asset_balance)}`);
      onOpened();
    } catch (e) {
      alert(e instanceof Error ? e.message : '이월 설정 실패');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ta-modal-overlay" onClick={() => !saving && onClose()}>
      <div className="ta-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="ta-modal-title">이월 설정</h3>
        <p className="ta-modal-desc">
          현재 통장잔고를 입력하면 그 시각의 고객 충전금(고객 원장 스냅샷)을 빼서 회사자산을 정합니다.
          이후 고객 원장에 기록되는 모든 거래가 자동으로 이 장부에 반영됩니다.
        </p>
        <div className="ta-field">
          <label>고객 그룹 (충전금 기준)</label>
          <select value={balanceId} onChange={(e) => setBalanceId(e.target.value)} disabled={saving}>
            <option value="">선택</option>
            {groups.map((g) => <option key={g.balanceId} value={g.balanceId}>{g.label}</option>)}
          </select>
        </div>
        <div className="ta-field">
          <label>현재 통장잔고 (위안)</label>
          <input type="number" step="0.01" value={bank} onChange={(e) => setBank(e.target.value)} placeholder="예: 393507.83" disabled={saving} />
        </div>
        <div className="ta-modal-actions">
          <button className="ta-btn" onClick={onClose} disabled={saving}>취소</button>
          <button className="ta-btn ta-btn--primary" onClick={handleSave} disabled={!valid || saving}>
            {saving ? '설정 중...' : '이월 설정'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default OpeningModal;
