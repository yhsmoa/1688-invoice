'use client';

import React from 'react';
import './OrderHistoryStatusCard.css';

interface OrderHistoryStatusCardProps {
  label: string;
  count: number;
  isActive: boolean;
  onClick: () => void;
}

const OrderHistoryStatusCard: React.FC<OrderHistoryStatusCardProps> = ({ label, count, isActive, onClick }) => {
  return (
    <div className={`order-history-status-card ${isActive ? 'active' : ''}`} onClick={onClick}>
      <div className="order-history-status-content">
        <span className="order-history-status-text">{label}</span>
        <span className="order-history-status-count">{count}</span>
      </div>
    </div>
  );
};

export default OrderHistoryStatusCard;
