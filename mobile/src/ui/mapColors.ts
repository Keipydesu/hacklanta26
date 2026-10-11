/** Bypass film palette (decision 026). Pure values so the map page and Node tests can share them. */
export const palette = {
  night: '#0B0D14', panel: '#171A26', raise: '#1E2231', rule: '#2C3146', mist: '#EDEFF7', slate: '#9AA1BB',
  paper: '#ECEEF2', card: '#F8F9FB', white: '#FFFFFF', hairline: '#CDD2DE', ink: '#151829', graphite: '#555C75',
  amber: '#FFC533', amberDay: '#F2A900', amberInk: '#7D5200',
  hazard: '#FF6A55', hazardDay: '#D64532', mint: '#69F0D1', teal: '#005F73', straw: '#FFE083', steel: '#3A4160',
} as const;

/** Lower-risk is solid over a casing in the map's ground colour; shortest is dashed beside it. */
export const mapRouteColors = {
  light: { shortest: palette.steel, lowerRisk: palette.teal, casing: palette.white },
  dark: { shortest: palette.straw, lowerRisk: palette.mint, casing: palette.night },
} as const;

/** One hazard hue for both sources; the marker glyph and the label carry the source. */
export const hazardColors = { light: palette.hazardDay, dark: palette.hazard } as const;

/** Ground behind the map before a style loads, and for the offline blank style. */
export const mapGroundColors = { light: '#E3E6EC', dark: palette.night } as const;

export const bikeLaneColors = { light: '#6f9a52', dark: '#8fbf74' } as const;
