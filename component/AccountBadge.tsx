'use client';

import React from 'react';
import './AccountBadge.css';

// ============================================================
// AccountBadge — 1688 구매 계정 배지 (N 초록 / Y 핑크 / 그 외 회색)
//
//   배지 글자는 서버에서 env BUYER_ACCOUNT_BADGES 로 정해진다 (lib/buyerAccountBadge).
//   색은 data-badge 속성으로 고른다 — 설정에 없는 계정은 계정 ID 가 그대로 와서 회색.
//
//   쓰는 곳: 주문상태 V2 상품명 칸 · 1688 판매자 문의 배송번호 칸 / 상세 주문ID
// ============================================================

interface AccountBadgeProps {
  /** 배지 글자 (N / Y / 계정 ID) */
  badge: string;
  /** 마우스 올렸을 때 보이는 설명 (예: 계정 ID) */
  title?: string;
  /** 화면별 추가 클래스 (배치용) */
  className?: string;
}

const AccountBadge: React.FC<AccountBadgeProps> = ({ badge, title, className }) => (
  <span
    className={className ? `account-badge ${className}` : 'account-badge'}
    data-badge={badge}
    title={title}
  >
    {badge}
  </span>
);

export default AccountBadge;
