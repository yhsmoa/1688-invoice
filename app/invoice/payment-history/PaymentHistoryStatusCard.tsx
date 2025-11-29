'use client';

import React from 'react';
import './PaymentHistoryStatusCard.css';

interface PaymentHistoryStatusCardProps {
  label: string;
  count: number;
  isActive: boolean;
  onClick: () => void;
}

const PaymentHistoryStatusCard: React.FC<PaymentHistoryStatusCardProps> = ({ label, count, isActive, onClick }) => {
  return (
    <div className={`payment-history-status-card ${isActive ? 'active' : ''}`} onClick={onClick}>
      <div className="payment-history-status-content">
        <span className="payment-history-status-text">{label}</span>
        <span className="payment-history-status-count">{count}</span>
      </div>
    </div>
  );
};

export default PaymentHistoryStatusCard;
