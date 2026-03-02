'use client';

import React from 'react';
import './StatusCard.css';

/* V2 전용 StatusCard 컴포넌트 - 모든 className에 v2- 접두사 */

interface StatusCardProps {
  label: string;
  count: number;
  isActive: boolean;
  onClick: () => void;
}

const StatusCard: React.FC<StatusCardProps> = ({ label, count, isActive, onClick }) => {
  return (
    <div className={`v2-status-card ${isActive ? 'active' : ''}`} onClick={onClick}>
      <div className="v2-status-content">
        <span className="v2-status-text">{label}</span>
        <span className="v2-status-count">{count}</span>
      </div>
    </div>
  );
};

export default StatusCard;
