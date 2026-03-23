'use client';

import useSWR from 'swr';
import { api } from '@/lib/api';
import type { VoiceCorrection } from '@/lib/types';

const fetcher = (language: string) => api.listCorrections(language);

export function useCorrections(language: 'pt' | 'en') {
  const { data, error, mutate } = useSWR<{ corrections: VoiceCorrection[] }>(
    `/api/voice/corrections?language=${language}`,
    () => fetcher(language),
    { revalidateOnFocus: false }
  );

  const corrections = data?.corrections ?? [];

  const addCorrectionsBatch = async (pairs: { original: string; corrected: string }[]) => {
    if (pairs.length === 0) return;
    await api.addCorrectionsBatch(pairs, language);
    mutate();
  };

  const deleteCorrection = async (id: number) => {
    await api.deleteCorrection(id);
    mutate();
  };

  return {
    corrections,
    isLoading: !data && !error,
    error,
    addCorrectionsBatch,
    deleteCorrection,
    mutate,
  };
}
