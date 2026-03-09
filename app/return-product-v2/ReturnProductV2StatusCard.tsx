'use client';

import React from 'react';
import './ReturnProductV2StatusCard.css';

interface ReturnProductV2StatusCardProps {
  label: string;
  count: number;
  isActive: boolean;
  onClick: () => void;
}

const ReturnProductV2StatusCard: React.FC<ReturnProductV2StatusCardProps> = ({ label, count, isActive, onClick }) => {
  return (
    <div className={`return-v2-status-card ${isActive ? 'active' : ''}`} onClick={onClick}>
      <div className="return-v2-status-content">
        <span className="return-v2-status-text">{label}</span>
        <span className="return-v2-status-count">{count}</span>
      </div>
    </div>
  );
};

export default ReturnProductV2StatusCard;
