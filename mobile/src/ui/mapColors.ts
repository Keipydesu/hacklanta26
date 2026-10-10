export const palette = {
  nearBlack: '#101114', charcoal: '#353535', cyan: '#3c6e71', white: '#ffffff', silver: '#d9d9d9', blue: '#284b63',
} as const;

export const mapRouteColors = {
  light: { shortest: palette.charcoal, lowerRisk: palette.cyan },
  dark: { shortest: palette.silver, lowerRisk: palette.cyan },
} as const;

export const bikeLaneColors = { light: '#6f9a52', dark: '#8fbf74' } as const;
