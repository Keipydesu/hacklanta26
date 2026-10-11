import React, { type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ActionButton as Button } from '../ui/ActionButton';
import { useTheme, type Theme } from '../ui/theme';
import { canRequest, presentRoutes, type RouteLine, type RouteState } from './model';

export const routeColors = (theme: Theme) => ({ shortest: theme.routeShortest, safest: theme.routeLowerRisk });

function RouteCard({ line, expanded, colors }: { line: RouteLine; expanded: boolean; colors: { shortest: string; safest: string } }) {
  const theme = useTheme();
  const styles = createStyles(theme);
  return <View style={styles.card} accessible accessibilityLabel={`${line.label}: ${line.duration}, ${line.distance}, ${line.hazardCount} reported hazards, ${line.risk}`}>
    <View style={styles.legend}><View style={[styles.swatch, { backgroundColor: colors[line.kind] }]} /><Text style={styles.label}>{line.label}</Text></View>
    <Text style={styles.metrics}>{line.duration}</Text>
    <Text style={styles.fine}>{line.distance} · {line.hazardCount} reports</Text>
    {expanded && <Text style={styles.fine}>{line.risk}</Text>}
  </View>;
}

export function RouteScreen(props: {
  colors: { shortest: string; safest: string }; state: RouteState; offlinePreview: boolean; expanded: boolean;
  fields: ReactNode; canSwap: boolean; onCompare(): void; onSwap(): void; onClear(): void;
}) {
  const theme = useTheme();
  const styles = createStyles(theme);
  const { state, expanded } = props;
  const presented = state.result ? presentRoutes(state.result) : null;
  const ready = canRequest(state);
  const loading = state.status === 'loading';
  return <>
    {props.fields}
    {expanded && <View style={styles.row}>
      <Button title="Swap" disabled={!props.canSwap} onPress={props.onSwap} />
      <Button title="Clear" onPress={props.onClear} />
    </View>}
    {props.offlinePreview && <Text style={styles.notice}>Offline preview · connect to routing for directions</Text>}
    {ready && (loading || !presented || expanded) && <Button primary busy={loading}
      title={loading ? 'Comparing routes…' : presented ? 'Refresh routes' : 'Compare routes'} onPress={props.onCompare} />}
    {!!state.error && <Text accessibilityRole="alert" style={styles.error}>{state.error}</Text>}
    {state.error && presented && !expanded && <Button title="Retry comparison" onPress={props.onCompare} disabled={loading} />}
    {state.outdated && presented && <View>
      <Text accessibilityRole="alert" style={styles.notice}>Reports changed · routes may be outdated</Text>
      {!expanded && <Button title="Refresh routes" onPress={props.onCompare} disabled={loading} />}
    </View>}
    {presented && !presented.illustrative && <>
      <View style={styles.row}>
        <RouteCard colors={props.colors} line={presented.shortest} expanded={expanded} />
        {presented.lowerRisk && <RouteCard colors={props.colors} line={presented.lowerRisk} expanded={expanded} />}
      </View>
      {!presented.lowerRisk && <Text style={styles.fine}>No distinct lower-risk alternative</Text>}
      {expanded && <>
        <Text style={styles.fine}>{presented.summary}</Text>
        <Text style={styles.fine}>Routes do not reroute automatically. Risk is a routing heuristic, not a safety guarantee.</Text>
      </>}
    </>}
  </>;
}

const createStyles = (theme: Theme) => StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' },
  card: { flex: 1, minWidth: 120, padding: 10, borderRadius: theme.radius, borderWidth: 1, borderColor: theme.line, marginVertical: 4 },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  swatch: { width: 15, height: 3, borderRadius: 1 },
  label: { fontFamily: theme.fontBody, fontSize: 13, color: theme.ink, flexShrink: 1 },
  metrics: { fontFamily: theme.fontBody, fontSize: 24, color: theme.ink, marginVertical: 4 },
  fine: { fontFamily: theme.fontLight, color: theme.muted, fontSize: 12, lineHeight: 18, marginVertical: 2 },
  notice: { color: theme.warning, fontSize: 12, marginVertical: 4 },
  error: { fontFamily: theme.fontBody, color: theme.danger, marginVertical: 6 },
});
