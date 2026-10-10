import React, { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, SafeAreaView, ScrollView, View, Text, Button, StyleSheet } from 'react-native';
import MapView, { Marker, Polygon, Polyline, Region } from 'react-native-maps';
import * as Crypto from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { connectLive, liveUrl } from './src/api/live';
import { locateOnce } from './src/location/foreground';
import { createSubmitGuard } from './src/reports/submit';
import { CATEGORIES, categoryLabel, hazardTitle } from './src/reports/categories';
import { createReportQueue, freezeReport, Submission } from './src/reports/queue';
import { createHazardRefresh } from './src/api/hazardRefresh';
import { apiUrl, fixtureMode, getHazards, getHealth, getRoutes, submitReport, HazardCollection, Health, Report } from './src/api/client';
import { createRouteComparison, presentRoutes, RouteState } from './src/routes/model';
import { ROUTE_COLORS, RouteScreen, Target } from './src/routes/RouteScreen';

const center = { latitude: 33.7531, longitude: -84.3853, latitudeDelta: 0.012, longitudeDelta: 0.012 };
const toPoint = ([longitude, latitude]: number[]) => ({ latitude, longitude });
const clamp = (value: number, limit: number) => Math.min(limit, Math.max(-limit, value));
// The API rejects bounds outside WGS84, which a zoomed-out map easily produces.
const bounds = (r: Region) => {
  const wide = r.longitudeDelta >= 360;
  return [wide ? -180 : clamp(r.longitude-r.longitudeDelta/2, 180), clamp(r.latitude-r.latitudeDelta/2, 90),
    wide ? 180 : clamp(r.longitude+r.longitudeDelta/2, 180), clamp(r.latitude+r.latitudeDelta/2, 90)].join(',');
};
export default function App() {
  const [screen, setScreen] = useState<'map'|'report'|'route'>('map');
  const [region, setRegion] = useState(center);
  const currentRegion = useRef<Region>(center);
  function changeRegion(next: Region) {
    currentRegion.current = next;
    setRegion(next);
  }
  const [pin, setPin] = useState({ latitude: center.latitude, longitude: center.longitude });
  const [hazards, setHazards] = useState<HazardCollection['features']>([]);
  // Route endpoints and their comparison live apart from the report form and the hazard feed.
  const [routeState, setRouteState] = useState<RouteState>({ origin: null, destination: null, status: 'idle', result: null, error: null, outdated: false });
  const [comparison] = useState(() => createRouteComparison({ load: getRoutes, onChange: setRouteState }));
  const [routeTarget, setRouteTarget] = useState<Target>('origin');
  const [server, setServer] = useState<Health>();
  const [kind, setKind] = useState<Report['kind']>('pothole');
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [error, setError] = useState('');
  const [hazardError, setHazardError] = useState('');
  const [now, setNow] = useState(Date.now());
  // A delayed submit keeps this same function, which reads the current viewport.
  const [refresh] = useState(() => createHazardRefresh(
    () => currentRegion.current,
    region => getHazards(bounds(region)),
    result => { setHazards(result.features); setHazardError(''); },
    error => setHazardError(String(error)),
  ));
  useEffect(() => { void refresh(); }, [region]);
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);
  // Live hints drive refetches; polling is only the fallback while the socket is down.
  const [liveConnected, setLiveConnected] = useState(false);
  useEffect(() => {
    if (!apiUrl) return;
    return connectLive({
      url: liveUrl(apiUrl), createSocket: url => new WebSocket(url) as any,
      onChange: () => { void refresh(); comparison.hazardsChanged(); }, onStatus: setLiveConnected,
      setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: h => clearTimeout(h as any), random: Math.random,
    });
  }, []);
  useEffect(() => {
    if (!apiUrl || liveConnected) return;
    const tick = setInterval(() => void refresh(), 5000);
    return () => clearInterval(tick);
  }, [region, liveConnected]);
  // The queue persists each frozen report before any network I/O and resends the same body until resolved.
  const [queue] = useState(() => createReportQueue({
    storage: AsyncStorage,
    send: submitReport,
    now: Date.now,
    random: Math.random,
    onChange: setSubmissions,
    onReceipt: () => void refresh(),
  }));
  useEffect(() => {
    if (fixtureMode) return;
    void queue.load().then(() => { if (queue.loadError()) setError(queue.loadError()!); return queue.drain(); });
    // Only used to say honestly whether the server keeps reports; never blocks the app.
    const probe = () => getHealth().then(setServer).catch(() => undefined);
    void probe();
    const sub = AppState.addEventListener('change', state => { if (state === 'active') { setNow(Date.now()); void refresh(); void queue.drain(); void probe(); } });
    return () => sub.remove();
  }, []);
  // Wake when the earliest backoff expires; submissions also change on every drain.
  useEffect(() => {
    const due = queue.nextDueAt();
    if (due === undefined) return;
    const timer = setTimeout(() => void queue.drain(), Math.max(0, due - Date.now()));
    return () => clearTimeout(timer);
  }, [submissions]);
  const [submitting, setSubmitting] = useState(false);
  const [guardSubmit] = useState(createSubmitGuard);
  async function useMyLocation() {
    const result = await locateOnce(Location, Location.Accuracy.Balanced);
    if (result.ok) { setPin({ latitude: result.lat, longitude: result.lon }); setError(''); }
    else setError(result.reason === 'denied' ? 'Location permission denied. Tap the map to place the pin instead.' : 'Could not get your location. Tap the map to place the pin instead.');
  }
  function placeRouteEndpoint(point: { latitude: number; longitude: number }, which: Target = routeTarget) {
    const next = { lat: point.latitude, lon: point.longitude };
    if (which === 'origin') { comparison.setOrigin(next); if (!comparison.state().destination) setRouteTarget('destination'); }
    else comparison.setDestination(next);
  }
  async function useMyLocationAsStart() {
    const result = await locateOnce(Location, Location.Accuracy.Balanced);
    if (result.ok) { placeRouteEndpoint({ latitude: result.lat, longitude: result.lon }, 'origin'); setError(''); }
    else setError(result.reason === 'denied' ? 'Location permission denied. Tap the map to place the start pin instead.' : 'Could not get your location. Tap the map to place the start pin instead.');
  }
  const presented = routeState.result ? presentRoutes(routeState.result) : null;
  function send() {
    return guardSubmit(async () => {
      setSubmitting(true); setError('');
      try {
        await queue.enqueue(freezeReport({ kind, lat: pin.latitude, lon: pin.longitude }, Date.now(), Crypto.randomUUID()));
        void queue.drain();
      } catch (e) { setError(`Report was not saved: ${String(e)}`); }
      finally { setSubmitting(false); }
    });
  }
  const visible = hazards.filter(h => h.properties.status === 'active' && Date.parse(h.properties.expires_at) > now);
  return <SafeAreaView style={styles.page}>
    <Text style={styles.title}>Campus hazards</Text>
    <Text style={styles.notice}>{fixtureMode ? 'DEMO · Offline fixture preview' : server?.storage === 'memory' ? 'Test server · reports are not kept when it restarts' : ''}</Text>
    <View style={styles.tabs}>{(['map','report','route'] as const).map(tab => <Button key={tab} title={tab} onPress={() => setScreen(tab)} />)}</View>
    <MapView style={styles.map} initialRegion={center} onRegionChangeComplete={changeRegion}
      onPress={e => { if (screen === 'report') setPin(e.nativeEvent.coordinate); else if (screen === 'route') placeRouteEndpoint(e.nativeEvent.coordinate); }}>
      {visible.map(h => <Polygon key={h.properties.id} coordinates={h.geometry.coordinates[0].map(toPoint)}
        holes={h.geometry.coordinates.slice(1).map(r => r.map(toPoint))}
        strokeColor={h.properties.source === 'manual' ? '#af4d00' : '#5555bb'} fillColor={h.properties.source === 'manual' ? '#fa9f4266' : '#7777dd66'} />)}
      {visible.map(h => <Marker key={`marker-${h.properties.id}`} coordinate={toPoint(h.geometry.coordinates[0][0])}
        title={h.properties.source === 'manual' ? 'Community report' : `Automatically detected · ${h.properties.evidence_source}`}
        description={hazardTitle(h.properties)} />)}
      {submissions.filter(sub => sub.state !== 'submitted').map(sub => <Marker key={`pending-${sub.id}`} coordinate={{ latitude: sub.body.lat, longitude: sub.body.lon }}
        pinColor="blue" title="Pending report (not yet accepted)" description={categoryLabel(sub.body.kind)} />)}
      {screen === 'report' && <Marker coordinate={pin} draggable title="Report location"
        onDragEnd={e => setPin(e.nativeEvent.coordinate)} />}
      {screen === 'route' && presented?.lowerRisk && <Polyline coordinates={presented.lowerRisk.coordinates.map(toPoint)} strokeWidth={6} strokeColor={ROUTE_COLORS.safest} />}
      {screen === 'route' && presented && <Polyline coordinates={presented.shortest.coordinates.map(toPoint)} strokeWidth={4} strokeColor={ROUTE_COLORS.shortest} lineDashPattern={presented.lowerRisk ? [10, 8] : undefined} />}
      {screen === 'route' && routeState.origin && <Marker coordinate={{ latitude: routeState.origin.lat, longitude: routeState.origin.lon }} pinColor="green" draggable
        title="Start (A)" onDragEnd={e => placeRouteEndpoint(e.nativeEvent.coordinate, 'origin')} />}
      {screen === 'route' && routeState.destination && <Marker coordinate={{ latitude: routeState.destination.lat, longitude: routeState.destination.lon }} pinColor="purple" draggable
        title="Destination (B)" onDragEnd={e => placeRouteEndpoint(e.nativeEvent.coordinate, 'destination')} />}
    </MapView>
    <ScrollView style={styles.content}>
      {screen === 'map' && <>
        <Button title="Refresh hazards" onPress={() => void refresh()} />
        {visible.length === 0 && <Text>No active reports in these bounds.</Text>}
        {visible.map(h => <View key={h.properties.id} style={styles.card}>
          <Text style={styles.heading}>{h.properties.source === 'manual' ? 'Community report' : `Automatically detected · ${h.properties.evidence_source}`}</Text>
          <Text>{hazardTitle(h.properties)}</Text><Text>Expires {new Date(h.properties.expires_at).toLocaleString()}</Text>
        </View>)}
      </>}
      {screen === 'report' && <>
        <Text style={styles.heading}>Place a pin to report a hazard</Text>
        <Text>Tap the map or drag the pin. No location permission needed.</Text>
        <Text>{pin.latitude.toFixed(5)}, {pin.longitude.toFixed(5)}</Text>
        <Button title="Use my location (optional)" onPress={() => void useMyLocation()} />
        <Text style={styles.heading}>What kind of hazard?</Text>
        <View accessibilityRole="radiogroup" accessibilityLabel="Hazard category">
          {CATEGORIES.map(category => {
            const selected = category.kind === kind;
            return <Pressable key={category.kind} accessibilityRole="radio" accessibilityState={{ selected }}
              accessibilityLabel={`${category.label}. ${category.hint}`} onPress={() => setKind(category.kind)}
              style={[styles.category, selected && styles.categorySelected]}>
              <Text style={styles.categoryLabel}>{selected ? '● ' : '○ '}{category.label}</Text>
              <Text style={styles.categoryHint}>{category.hint}</Text>
            </Pressable>;
          })}
        </View>
        <Text>Reports are saved on this phone and retried with the same ID until the server answers. Pending reports are not yet accepted hazards.</Text>
        <Button title="Submit report" disabled={fixtureMode || submitting} onPress={() => void send()} />
        {submissions.map(sub => <View key={sub.id} style={styles.card}>
          <Text style={styles.heading}>{categoryLabel(sub.body.kind)} · {sub.state === 'queued' ? 'queued (pending, not accepted)' : sub.state}</Text>
          <Text>Observed {new Date(sub.body.observed_at).toLocaleString()}{sub.attempts ? ` · attempts ${sub.attempts}` : ''}</Text>
          {!!sub.error && <Text style={styles.error}>{sub.error}{sub.retryable ? '' : '\nThe server rejected this report; dismiss it and submit a corrected one.'}</Text>}
          {sub.state === 'failed' && sub.retryable && <Button title="Retry original report" onPress={() => void queue.retry(sub.id)} />}
          {(sub.state === 'submitted' || (sub.state === 'failed' && !sub.retryable)) && <Button title="Dismiss" onPress={() => void queue.dismiss(sub.id)} />}
        </View>)}
        {fixtureMode && <Text>Fixture preview only. Configure the product API URL to submit.</Text>}
      </>}
      {screen === 'route' && <RouteScreen state={routeState} target={routeTarget} offlinePreview={fixtureMode}
        onTarget={setRouteTarget} onUseLocation={() => void useMyLocationAsStart()} onCompare={() => void comparison.request()}
        onSwap={() => comparison.swap()} onClear={() => { comparison.clear(); setRouteTarget('origin'); }} />}
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      {!!hazardError && <Text accessibilityRole="alert" style={styles.error}>{hazards.length ? 'Offline or stale: showing the last successful results. ' : ''}{hazardError}</Text>}
    </ScrollView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f5f4ef' }, title: { fontSize: 26, fontWeight: '700', padding: 12 },
  notice: { paddingHorizontal: 12, color: '#765000' }, tabs: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-around' },
  map: { height: '43%' }, content: { padding: 16 }, card: { paddingVertical: 12, borderBottomWidth: 1, borderColor: '#ddd' },
  heading: { fontSize: 17, fontWeight: '600', marginVertical: 6 }, category: { borderWidth: 1, borderColor: '#aaa', borderRadius: 8, padding: 12, marginVertical: 4, backgroundColor: '#fff' }, categorySelected: { borderColor: '#0b5fff', backgroundColor: '#eaf1ff' }, categoryLabel: { fontSize: 16, fontWeight: '600' }, categoryHint: { color: '#555', marginTop: 2 }, error: { color: '#a00020', marginVertical: 8 },
});
