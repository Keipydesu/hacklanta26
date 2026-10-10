import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ActionButton as Button } from '../ui/ActionButton';
import { canRequest, presentRoutes, type Point, type RouteLine, type RouteState } from './model';

export type Target = 'origin' | 'destination';
export const ROUTE_COLORS = { shortest: '#5f5f5f', safest: '#005f73' } as const;
export const DARK_ROUTE_COLORS = { shortest: '#ffe083', safest: '#69f0d1' } as const;

const where = (p: Point | null) => (p ? `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}` : 'not set');

function RouteCard({ line, routeColors }: { line: RouteLine; routeColors: { shortest: string; safest: string } }) {
  return (
    <View style={styles.card} accessible accessibilityLabel={`${line.label} route: ${line.distance}, ${line.duration}, ${line.risk}, crosses ${line.hazardCount} reported hazards`}>
      <View style={styles.legend}>
        <View style={[styles.swatch, { backgroundColor: routeColors[line.kind] }, line.kind === 'shortest' && styles.swatchDashed]} />
        <Text style={styles.heading}>{line.label}</Text>
      </View>
      <Text style={styles.metrics}>{line.duration} <Text style={styles.distance}>· {line.distance}</Text></Text>
      <Text>{line.hazardCount === 0 ? 'Crosses no reported hazards' : `Crosses ${line.hazardCount} reported hazard${line.hazardCount === 1 ? '' : 's'}`}</Text>
      <Text style={styles.fine}>{line.risk}</Text>
    </View>
  );
}

export function RouteScreen(props: {
  state: RouteState;
  target: Target;
  offlinePreview: boolean;
  routeColors: { shortest: string; safest: string };
  onTarget(target: Target): void;
  onUseLocation(): void;
  onCompare(): void;
  onSwap(): void;
  onClear(): void;
}) {
  const { state, target } = props;
  const presented = state.result ? presentRoutes(state.result) : null;
  const ready = canRequest(state);
  const loading = state.status === 'loading';
  return (
    <>
      <Text style={styles.title}>A better way across campus.</Text>
      <Text style={styles.heading}>Plan your trip</Text>
      <Text>Tap the map to place the {target === 'origin' ? 'start' : 'destination'} pin, or drag a pin to move it. No location permission needed.</Text>
      <View style={styles.row}>
        <Button selected={target === 'origin'} title="Set start" onPress={() => props.onTarget('origin')} />
        <Button selected={target === 'destination'} title="Set destination" onPress={() => props.onTarget('destination')} />
      </View>
      <Text>Start (A): {where(state.origin)}</Text>
      <Text>Destination (B): {where(state.destination)}</Text>
      <View style={styles.row}>
        <Button title="Use my location as start (optional)" onPress={props.onUseLocation} />
      </View>
      <View style={styles.row}>
        <Button title="Swap" disabled={!state.origin && !state.destination} onPress={props.onSwap} />
        <Button title="Clear" disabled={!state.origin && !state.destination} onPress={props.onClear} />
      </View>
      <Button primary title={loading ? 'Comparing…' : presented ? 'Refresh comparison' : 'Compare routes'} disabled={!ready || loading} onPress={props.onCompare} />
      {!ready && <Text>Place both pins to compare routes.</Text>}

      {!!state.error && <Text accessibilityRole="alert" style={styles.error}>{state.error}</Text>}
      {state.outdated && presented && (
        <Text accessibilityRole="alert" style={styles.notice}>
          Hazards changed after this comparison, so it may be out of date. Refresh to compare again.
        </Text>
      )}
      {presented && (
        <>
          {presented.illustrative && (
            <Text style={styles.notice}>
              {props.offlinePreview ? 'Offline preview.' : 'Example routes only.'} These are fixed example lines: they do not follow your pins or respond to reports.
            </Text>
          )}
          <Text style={styles.summary}>{presented.summary}</Text>
          <RouteCard line={presented.shortest} routeColors={props.routeColors} />
          {presented.lowerRisk && <RouteCard line={presented.lowerRisk} routeColors={props.routeColors} />}
          <Text style={styles.fine}>
            A comparison, not turn-by-turn navigation. “Lower-risk” avoids currently reported hazards where it can; the risk number is a 0–1 routing heuristic, not a probability or a guarantee.
          </Text>
        </>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 26, fontWeight: '700', color: '#173f35', marginBottom: 8 },
  heading: { fontSize: 17, fontWeight: '600', color: '#173f35', marginVertical: 6 },
  metrics: { fontSize: 24, fontWeight: '700', color: '#173f35', marginVertical: 8 },
  distance: { fontSize: 16, fontWeight: '400' },
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-around', marginVertical: 4 },
  card: { padding: 18, borderRadius: 18, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e0e6d8', marginVertical: 6 },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  swatch: { width: 28, height: 5, borderRadius: 2 },
  swatchDashed: { width: 28, height: 5, opacity: 0.85 },
  summary: { fontSize: 15, fontWeight: '600', marginTop: 10 },
  notice: { color: '#765000', marginVertical: 8 },
  error: { color: '#a00020', marginVertical: 8 },
  fine: { color: '#555', fontSize: 13, marginTop: 10 },
});
