// Auto-detect the property that holds a feature's display name.

// Tried in order; first one present (with mostly string values) wins.
const PREFERRED_KEYS = [
  'name',
  'NAME',
  'Name',
  'name_en',
  'NAME_EN',
  'province',
  'PROVINCE',
  'ADM1_EN',
  'ADM2_EN',
  'NAME_1',
  'NAME_2',
  'shapeName',
  'admin',
  'ADMIN',
  'NAME_LATN',
  'NL_NAME_1',
  'state',
  'STATE',
  'region',
  'REGION',
  'label',
  'title',
];

/** Collect property keys that look like usable text labels across features. */
export function nameFieldCandidates(features: GeoJSON.Feature[]): string[] {
  const stringKeyCounts = new Map<string, number>();
  const totalKeyCounts = new Map<string, number>();
  const sample = features.slice(0, 200);
  for (const f of sample) {
    const props = (f.properties ?? {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(props)) {
      if (k.startsWith('__')) continue;
      totalKeyCounts.set(k, (totalKeyCounts.get(k) ?? 0) + 1);
      if (typeof v === 'string' && v.trim() !== '') {
        stringKeyCounts.set(k, (stringKeyCounts.get(k) ?? 0) + 1);
      }
    }
  }
  // Keep keys that are strings in a majority of the features that have them.
  const candidates = [...totalKeyCounts.keys()].filter((k) => {
    const s = stringKeyCounts.get(k) ?? 0;
    const t = totalKeyCounts.get(k) ?? 1;
    return s / t >= 0.5;
  });
  // Sort preferred keys first (in preference order), then the rest alphabetically.
  candidates.sort((a, b) => {
    const ia = PREFERRED_KEYS.indexOf(a);
    const ib = PREFERRED_KEYS.indexOf(b);
    if (ia !== -1 || ib !== -1) {
      return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
    }
    return a.localeCompare(b);
  });
  return candidates;
}

export function detectNameField(features: GeoJSON.Feature[]): {
  best: string | null;
  candidates: string[];
} {
  const candidates = nameFieldCandidates(features);
  return { best: candidates[0] ?? null, candidates };
}
