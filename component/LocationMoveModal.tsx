'use client';

import React, { useState, useRef, useEffect } from 'react';
import './LocationMoveModal.css';

interface LocationMoveModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentLocation: string;
  availableLocations: string[];
  onMove: (newLocation: string) => void;
}

const LocationMoveModal: React.FC<LocationMoveModalProps> = ({
  isOpen,
  onClose,
  currentLocation,
  availableLocations,
  onMove,
}) => {
  const [selectedLocation, setSelectedLocation] = useState<string>('');
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      // 모달이 열릴 때 화면 중앙에 배치
      setPosition({
        x: window.innerWidth / 2 - 200,
        y: window.innerHeight / 2 - 150
      });
      setSelectedLocation('');
    }
  }, [isOpen]);

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.location-move-modal-header')) {
      setIsDragging(true);
      setDragOffset({
        x: e.clientX - position.x,
        y: e.clientY - position.y
      });
    }
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (isDragging) {
      setPosition({
        x: e.clientX - dragOffset.x,
        y: e.clientY - dragOffset.y
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, dragOffset]);

  const handleMove = () => {
    if (!selectedLocation) {
      alert('이동할 위치를 선택해주세요.');
      return;
    }
    if (selectedLocation === currentLocation) {
      alert('현재 위치와 동일한 위치입니다.');
      return;
    }
    onMove(selectedLocation);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="location-move-modal-overlay">
      <div
        ref={modalRef}
        className="location-move-modal"
        style={{
          left: `${position.x}px`,
          top: `${position.y}px`,
          cursor: isDragging ? 'grabbing' : 'default'
        }}
        onMouseDown={handleMouseDown}
      >
        <div className="location-move-modal-header" style={{ cursor: 'grab' }}>
          <h3>위치 이동</h3>
          <button className="location-move-modal-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="location-move-modal-content">
          <div className="location-move-current">
            <label>현재 위치:</label>
            <span className="location-move-current-value">{currentLocation}</span>
          </div>
          <div className="location-move-arrow">→</div>
          <div className="location-move-target">
            <label>이동할 위치:</label>
            <select
              value={selectedLocation}
              onChange={(e) => setSelectedLocation(e.target.value)}
              className="location-move-select"
            >
              <option value="">선택하세요</option>
              {availableLocations
                .filter(loc => loc !== currentLocation)
                .map(location => (
                  <option key={location} value={location}>
                    {location}
                  </option>
                ))}
            </select>
          </div>
        </div>
        <div className="location-move-modal-footer">
          <button className="location-move-cancel-btn" onClick={onClose}>
            취소
          </button>
          <button className="location-move-confirm-btn" onClick={handleMove}>
            이동
          </button>
        </div>
      </div>
    </div>
  );
};

export default LocationMoveModal;
