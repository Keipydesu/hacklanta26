import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ActionButton as Button } from '../ui/ActionButton';
import { theme } from '../ui/theme';
import { canRequest, presentRoutes, type Point, type RouteLine, type RouteState } from './model';

export type Target = 'origin' | 'destination';
export const ROUTE_COLORS = { shortest: '#5f5f5f', safest: '#005f73' } as const;
const where = (p: Point | null) => (p ? `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}` : 'not set');

function RouteCard({ line, expanded }: { line: RouteLine; expanded: boolean }) {
  return <View style={styles.card} accessible accessibilityLabel={`${line.label}: ${line.duration}, ${line.distance}, ${line.hazardCount} reported hazards, ${line.risk}`}>
    <View style={styles.legend}><View style={[styles.swatch, { backgroundColor: ROUTE_COLORS[line.kind] }]} /><Text style={styles.label}>{line.label}</Text></View>
    <Text style={styles.metrics}>{line.duration}</Text>
    <Text style={styles.fine}>{line.distance} · {line.hazardCount} reports</Text>
    {expanded && <Text style={styles.fine}>{line.risk}</Text>}
  </View>;
}

export function RouteScreen(props: {
  state: RouteState; target: Target; offlinePreview: boolean; expanded: boolean;
  onTarget(target: Target): void; onUseLocation(): void; onCompare(): void;
  onSwap(): void; onClear(): void;
}) {
  const { state, target, expanded } = props;
  const presented = state.result ? presentRoutes(state.result) : null;
  const ready = canRequest(state);
  const loading = state.status === 'loading';
  return <>
    {(!presented || expanded) && <>
      <View style={styles.row}>
        <Button icon="pin" selected={target === 'origin'} title={state.origin ? 'Start set' : 'Set start'} onPress={() => props.onTarget('origin')} />
        <Button icon="route" selected={target === 'destination'} title={state.destination ? 'Destination set' : 'Set destination'} onPress={() => props.onTarget('destination')} />
      </View>
      <Text style={styles.fine}>Tap map to set {target === 'origin' ? 'start' : 'destination'}</Text>
      {expanded && <>
        <Text style={styles.fine}>A · {where(state.origin)}   B · {where(state.destination)}</Text>
        <Button icon="locate" title="Use my location as start" onPress={props.onUseLocation} />
        <View style={styles.row}>
          <Button title="Swap" disabled={!state.origin && !state.destination} onPress={props.onSwap} />
          <Button title="Clear" disabled={!state.origin && !state.destination} onPress={props.onClear} />
        </View>
      </>}
      <Button primary title={loading ? 'Comparing…' : presented ? 'Refresh routes' : 'Compare routes'} disabled={!ready || loading} onPress={props.onCompare} />
      {!ready && <Text style={styles.fine}>Set two different points to compare</Text>}
    </>}
    {!!state.error && <Text accessibilityRole="alert" style={styles.error}>{state.error}</Text>}
    {state.error && presented && !expanded && <Button title="Retry comparison" onPress={props.onCompare} disabled={loading} />}
    {state.outdated && presented && <View>
      <Text accessibilityRole="alert" style={styles.notice}>Reports changed · routes may be outdated</Text>
      {!expanded && <Button title="Refresh routes" onPress={props.onCompare} disabled={loading} />}
    </View>}
    {presented && <>
      {presented.illustrative && <Text style={styles.notice}>Example routes · do not follow your pins</Text>}
      <View style={styles.row}>
        <RouteCard line={presented.shortest} expanded={expanded} />
        {presented.lowerRisk && <RouteCard line={presented.lowerRisk} expanded={expanded} />}
      </View>
      {!presented.lowerRisk && <Text style={styles.fine}>No distinct lower-risk alternative</Text>}
      {expanded && <>
        <Text style={styles.fine}>{presented.summary}</Text>
        <Text style={styles.fine}>Comparison only, not navigation. Risk is a routing heuristic, not a safety guarantee.</Text>
      </>}
    </>}
  </>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' },
  card: { flex: 1, minWidth: 120, padding: 10, borderRadius: theme.radius, borderWidth: 1, borderColor: theme.line, marginVertical: 4 },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  swatch: { width: 15, height: 3, borderRadius: 1 },
  label: { fontSize: 13, fontWeight: '600', color: theme.ink, flexShrink: 1 },
  metrics: { fontSize: 24, fontWeight: '700', color: theme.ink, marginVertical: 4 },
  fine: { color: theme.muted, fontSize: 12, lineHeight: 18, marginVertical: 2 },
  notice: { color: theme.warning, fontSize: 12, marginVertical: 4 },
  error: { color: theme.danger, marginVertical: 6 },
});
