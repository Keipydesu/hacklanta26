import { createContext, createElement, useContext, useState, type ReactNode } from 'react';
import { useFonts } from 'expo-font';
import { useColorScheme } from 'react-native';
import { hazardColors, mapRouteColors, palette } from './mapColors';

/** Bypass film palette and type (decision 026): night surfaces, amber actions, hazard red, mint lower-risk route. */
export { palette } from './mapColors';

const dark = {
  ink: palette.mist as string, muted: palette.slate as string,
  surface: palette.panel as string, canvas: palette.night as string,
  quiet: palette.raise as string, controlInk: palette.mist as string, line: palette.rule as string,
  selected: palette.mist as string, selectedEdge: palette.mist as string, onSelected: palette.ink as string,
  primary: palette.amber as string, primaryEdge: palette.amber as string, onPrimary: palette.ink as string,
  accent: palette.amber as string, warning: palette.amber as string, danger: '#ffb4ab',
  hazard: hazardColors.dark as string,
  routeShortest: mapRouteColors.dark.shortest as string, routeLowerRisk: mapRouteColors.dark.lowerRisk as string,
  routeCasing: mapRouteColors.dark.casing as string,
  /** Overpass SemiBold: controls' values, inputs, errors. */
  fontBody: undefined as string | undefined,
  /** Overpass Regular: captions and supporting text. */
  fontLight: undefined as string | undefined,
  /** Barlow Condensed ExtraBold: headings and route metrics, set in capitals. */
  fontDisplay: undefined as string | undefined,
  /** Barlow Condensed Bold: button labels, set in capitals. */
  fontLabel: undefined as string | undefined,
  /** Overpass Mono SemiBold: kickers, source labels and facts. */
  fontMono: undefined as string | undefined,
  radius: 14, touch: 48,
};
export type Theme = typeof dark;
const light: Theme = {
  ...dark, ink: palette.ink, muted: palette.graphite, surface: palette.card, canvas: palette.paper,
  quiet: palette.white, controlInk: palette.ink, line: palette.hairline,
  selected: palette.ink, selectedEdge: palette.ink, onSelected: palette.card,
  primary: palette.amberDay, primaryEdge: palette.amberDay, onPrimary: palette.ink,
  accent: palette.amberInk, warning: palette.amberInk, danger: '#a00020',
  // Darker than the map's day hazard red so the small source label clears 4.5:1 on white.
  hazard: '#C23A28',
  routeShortest: mapRouteColors.light.shortest, routeLowerRisk: mapRouteColors.light.lowerRisk,
  routeCasing: mapRouteColors.light.casing,
};
type Appearance = 'light' | 'dark';
const AppearanceContext = createContext<{ scheme: Appearance; fontsReady: boolean; toggle(): void } | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [fontsReady] = useFonts({
    'BarlowCondensed-ExtraBold': require('../../assets/fonts/BarlowCondensed-ExtraBold.ttf'),
    'BarlowCondensed-Bold': require('../../assets/fonts/BarlowCondensed-Bold.ttf'),
    'Overpass-Regular': require('../../assets/fonts/Overpass-Regular.ttf'),
    'Overpass-SemiBold': require('../../assets/fonts/Overpass-SemiBold.ttf'),
    'OverpassMono-SemiBold': require('../../assets/fonts/OverpassMono-SemiBold.ttf'),
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
/** Each face is selected by its own file; never synthesize weight or italics on top of these. */
export function useTheme(): Theme {
  const { scheme, fontsReady } = useAppearance();
  return { ...(scheme === 'dark' ? dark : light),
    fontBody: fontsReady ? 'Overpass-SemiBold' : undefined,
    fontLight: fontsReady ? 'Overpass-Regular' : undefined,
    fontDisplay: fontsReady ? 'BarlowCondensed-ExtraBold' : undefined,
    fontLabel: fontsReady ? 'BarlowCondensed-Bold' : undefined,
    fontMono: fontsReady ? 'OverpassMono-SemiBold' : undefined,
  };
}
