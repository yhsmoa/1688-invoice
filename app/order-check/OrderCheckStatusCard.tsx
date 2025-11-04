'use client';

import React from 'react';
import './OrderCheckStatusCard.css';

interface OrderCheckStatusCardProps {
  label: string;
  count: number;
  isActive: boolean;
  onClick: () => void;
}

const OrderCheckStatusCard: React.FC<OrderCheckStatusCardProps> = ({ label, count, isActive, onClick }) => {
  return (
    <div className={`order-check-status-card ${isActive ? 'active' : ''}`} onClick={onClick}>
      <div className="order-check-status-content">
        <span className="order-check-status-text">{label}</span>
        <span className="order-check-status-count">{count}</span>
      </div>
    </div>
  );
};

export default OrderCheckStatusCard;
