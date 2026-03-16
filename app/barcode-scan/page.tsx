'use client';

import BarcodeScan from './BarcodeScan';
import { SaveProvider } from '../../contexts/SaveContext';

export default function BarcodeScanPage() {
  return (
    <SaveProvider>
      <BarcodeScan />
    </SaveProvider>
  );
}
