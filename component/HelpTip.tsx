'use client';

import React from 'react';
import './HelpTip.css';

// ============================================================
// HelpTip — 작은 ? (또는 임의 라벨) 칩에 마우스를 올리면 설명이 뜬다
//
//   · 설명을 본문에 길게 쓰지 않고 칩 하나로 접어 둘 때 쓴다 (처리준비 모달의 템플릿 설명,
//     [모두] 버튼 동작, 한국어 상품명 'kr' 칩 등)
//   · 키보드 접근: tabIndex=0 이라 포커스로도 열린다
//   · label 미지정 시 '?' — 'kr' 처럼 글자 칩으로도 쓴다
// ============================================================

interface HelpTipProps {
  /** 설명 본문 (줄바꿈은 \n) */
  text: string;
  /** 칩에 보일 글자 — 기본 '?' */
  label?: React.ReactNode;
  /** 칩 모양 변형 — 'text' 는 글자 칩(kr 등), 기본은 둥근 ? */
  variant?: 'icon' | 'text';
  /** 말풍선 위치 — 기본 위(top) */
  placement?: 'top' | 'bottom';
  className?: string;
}

const HelpTip: React.FC<HelpTipProps> = ({ text, label = '?', variant = 'icon', placement = 'top', className = '' }) => (
  <span className={`help-tip is-${variant} is-${placement} ${className}`} tabIndex={0} aria-label={text}>
    <span className="help-tip-chip">{label}</span>
    <span className="help-tip-bubble" role="tooltip">{text}</span>
  </span>
);

export default HelpTip;
