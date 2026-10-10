import { useColorScheme } from 'react-native';

/** Operator palette: coolors.co/palette/353535-3c6e71-ffffff-d9d9d9-284b63 */
export const palette = {
  charcoal: '#353535', cyan: '#3c6e71', white: '#ffffff', silver: '#d9d9d9', blue: '#284b63',
} as const;

const light = {
  ink: palette.charcoal as string, muted: palette.charcoal as string,
  surface: palette.white as string, canvas: palette.white as string,
  quiet: palette.white as string, line: palette.silver as string,
  selected: palette.cyan as string, selectedEdge: palette.cyan as string,
  primary: palette.blue as string, primaryEdge: palette.blue as string,
  inverse: palette.white as string, warning: palette.blue as string, danger: '#a00020',
  routeShortest: palette.charcoal as string, routeLowerRisk: palette.cyan as string,
  radius: 14, touch: 48,
};
export type Theme = typeof light;
const dark: Theme = {
  ...light, ink: palette.white, muted: palette.silver, surface: palette.charcoal,
  canvas: palette.charcoal, quiet: palette.charcoal, line: palette.silver,
  selectedEdge: palette.silver, primaryEdge: palette.silver,
  warning: palette.silver, danger: '#ffb4ab', routeShortest: palette.silver,
};
export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}
