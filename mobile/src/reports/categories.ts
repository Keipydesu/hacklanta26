import type { components } from '../api/schema';

export type ReportKind = components['schemas']['ManualReport']['kind'];

export interface Category { kind: ReportKind; label: string; hint: string }

/**
 * What a rider can report. These are exactly the kinds the product API accepts; adding a category
 * means a coordinated contract change, not an app-only edit. "Other" needs no explanation.
 */
export const CATEGORIES: readonly Category[] = [
  { kind: 'pothole', label: 'Pothole or rough surface', hint: 'Hole, crack, bump or broken pavement' },
  { kind: 'obstruction', label: 'Obstruction', hint: 'Something blocking or narrowing the path' },
  { kind: 'closure', label: 'Closed path or road', hint: 'Construction, fencing or a blocked route' },
  { kind: 'other', label: 'Other hazard', hint: 'Anything else that is unsafe' },
];

export function categoryLabel(kind: string): string {
  return CATEGORIES.find(category => category.kind === kind)?.label ?? 'Hazard';
}

const AUTOMATIC_CATEGORIES: Record<string, string> = {
  braking: 'Hard braking', surface: 'Rough surface', abandoned: 'Abandoned path',
};

export function hazardKindLabel(kind: string): string {
  return AUTOMATIC_CATEGORIES[kind] ?? categoryLabel(kind);
}

/** Manual hazards without a description carry the raw kind as their label; show the category name instead. */
export function hazardTitle(properties: { kind: string; label: string; source: string }): string {
  return properties.source === 'manual' && properties.label === properties.kind ? categoryLabel(properties.kind) : properties.label;
}

const EVIDENCE_LABELS: Record<string, string> = {
  device: 'device data', simulated: 'simulated data', replay: 'replayed data',
  mixed: 'mixed device, simulated or replayed data',
};

export function hazardSourceLabel(properties: { source: string; evidence_source?: string | null }): string {
  if (properties.source === 'manual') return 'Community report';
  const evidence = properties.evidence_source && EVIDENCE_LABELS[properties.evidence_source];
  return evidence ? `Automatically detected · ${evidence}` : 'Automatically detected';
}
