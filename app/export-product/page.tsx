'use client';

import ExportProduct from './ExportProduct';
import { SaveProvider } from '../../contexts/SaveContext';

export default function ExportProductPage() {
  return (
    <SaveProvider>
      <ExportProduct />
    </SaveProvider>
  );
}