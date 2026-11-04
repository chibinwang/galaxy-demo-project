import { useCallback, useEffect, useState } from 'react';
import type { Drawing, DrawingRevision, EngState, Inspection, QcPlan } from '../../shared/eng';
import { useFetch } from '../state';

export interface EngPayload extends EngState {
  connectors: { id: string; name: string; status: 'available' | 'demo' | 'planned'; description: string }[];
  workOrders: { id: string; label: string }[];
}

/** One fetch of the whole Engineering & QC state; re-fetches after any app data change. */
export function useEng() {
  return useFetch<EngPayload>('/api/eng');
}

export const fileUrl = (id: string, download = false) => `/api/eng/files/${id}${download ? '?download=1' : ''}`;

export function drawingOf(s: EngState, rev: DrawingRevision): Drawing | undefined {
  return s.drawings.find((d) => d.id === rev.drawingId);
}

export function revisionsOf(s: EngState, drawingId: string): DrawingRevision[] {
  return s.revisions.filter((r) => r.drawingId === drawingId).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

/** The revision shown for a drawing in the library: newest received. */
export function latestRevision(s: EngState, drawingId: string): DrawingRevision | undefined {
  return revisionsOf(s, drawingId)[0];
}

export function plansOf(s: EngState, revisionId: string): QcPlan[] {
  return s.plans.filter((p) => p.revisionId === revisionId);
}

export function inspectionsOfPlan(s: EngState, planId: string): Inspection[] {
  return s.inspections.filter((i) => i.planId === planId);
}

export const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
export const fmtDateTime = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// ---------- acting identity (demo has no login) ----------

export const PERSONAS = ['Neha Gupta (Quality Engineer, demo)', 'Arjun Mehta (QA Manager, demo)', 'Ravi Verma (QC Inspector, demo)'];
const KEY = 'everyse.eng.persona';
const listeners = new Set<(p: string) => void>();

function read() {
  try {
    return localStorage.getItem(KEY) || PERSONAS[0];
  } catch {
    return PERSONAS[0];
  }
}

/** Who the user is acting as for reviews, approvals and inspections. Shared across Engineering pages. */
export function usePersona(): [string, (p: string) => void] {
  const [p, setP] = useState(read);
  useEffect(() => {
    listeners.add(setP);
    return () => {
      listeners.delete(setP);
    };
  }, []);
  const set = useCallback((v: string) => {
    try {
      localStorage.setItem(KEY, v);
    } catch {
      /* per-session only */
    }
    listeners.forEach((l) => l(v));
  }, []);
  return [p, set];
}
