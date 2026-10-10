import { createContext, createElement, useContext, useState, type ReactNode } from 'react';
import { useFonts } from 'expo-font';
import { useColorScheme } from 'react-native';

/** Operator palette: coolors.co/palette/353535-3c6e71-ffffff-d9d9d9-284b63 */
export const palette = {
  nearBlack: '#101114', charcoal: '#353535', cyan: '#3c6e71', white: '#ffffff', silver: '#d9d9d9', blue: '#284b63',
} as const;

const light = {
  ink: palette.charcoal as string, muted: palette.charcoal as string,
  surface: palette.white as string, canvas: palette.white as string,
  quiet: palette.silver as string, controlInk: palette.charcoal as string, line: palette.silver as string,
  selected: palette.cyan as string, selectedEdge: palette.cyan as string,
  primary: palette.blue as string, primaryEdge: palette.blue as string,
  inverse: palette.white as string, warning: palette.blue as string, danger: '#a00020',
  routeShortest: palette.charcoal as string, routeLowerRisk: palette.cyan as string,
  fontBody: undefined as string | undefined, fontLight: undefined as string | undefined,
  radius: 14, touch: 48,
};
export type Theme = typeof light;
const dark: Theme = {
  ...light, ink: palette.white, muted: palette.silver, surface: palette.nearBlack,
  canvas: palette.nearBlack, quiet: palette.silver, line: 'transparent',
  selectedEdge: palette.cyan, primaryEdge: palette.blue,
  warning: palette.silver, danger: '#ffb4ab', routeShortest: palette.silver,
};
type Appearance = 'light' | 'dark';
const AppearanceContext = createContext<{ scheme: Appearance; fontsReady: boolean; toggle(): void } | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [fontsReady] = useFonts({
    'Satoshi-Italic': require('../../assets/fonts/Satoshi-Italic.otf'),
    'Satoshi-LightItalic': require('../../assets/fonts/Satoshi-LightItalic.otf'),
  });
  const system = useColorScheme();
  const [override, setOverride] = useState<Appearance | null>(null);
  const scheme = override ?? (system === 'dark' ? 'dark' : 'light');
  return createElement(AppearanceContext.Provider, {
    value: { scheme, fontsReady, toggle: () => setOverride(scheme === 'dark' ? 'light' : 'dark') },
  }, children);
}
export function useAppearance() {
  const appearance = useContext(AppearanceContext);
  if (!appearance) throw new Error('ThemeProvider is required');
  return appearance;
}
export function useTheme(): Theme {
  const { scheme, fontsReady } = useAppearance();
  return { ...(scheme === 'dark' ? dark : light),
    fontBody: fontsReady ? 'Satoshi-Italic' : undefined,
    fontLight: fontsReady ? 'Satoshi-LightItalic' : undefined,
  };
}
