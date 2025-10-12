'use client';

import React from 'react';
import './StatusCard.css';

interface StatusCardProps {
  label: string;
  count: number;
  isActive: boolean;
  onClick: () => void;
}

const StatusCard: React.FC<StatusCardProps> = ({ label, count, isActive, onClick }) => {
  return (
    <div className={`status-card ${isActive ? 'active' : ''}`} onClick={onClick}>
      <div className="status-content">
        <span className="status-text">{label}</span>
        <span className="status-count">{count}</span>
      </div>
    </div>
  );
};

export default StatusCard;
