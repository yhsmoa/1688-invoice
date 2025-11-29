'use client';

import React from 'react';
import './InvoiceSaveStatusCard.css';

interface InvoiceSaveStatusCardProps {
  label: string;
  count: number;
  isActive: boolean;
  onClick: () => void;
}

const InvoiceSaveStatusCard: React.FC<InvoiceSaveStatusCardProps> = ({ label, count, isActive, onClick }) => {
  return (
    <div className={`invoice-save-status-card ${isActive ? 'active' : ''}`} onClick={onClick}>
      <div className="invoice-save-status-content">
        <span className="invoice-save-status-text">{label}</span>
        <span className="invoice-save-status-count">{count}</span>
      </div>
    </div>
  );
};

export default InvoiceSaveStatusCard;
