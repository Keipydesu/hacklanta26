import React, { useEffect, useRef, useState } from 'react';
import { AppState, SafeAreaView, ScrollView, View, Text, Button, TextInput, StyleSheet } from 'react-native';
import * as Crypto from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { connectLive, liveUrl } from './src/api/live';
import { locateOnce } from './src/location/foreground';
import { createSubmitGuard } from './src/reports/submit';
import { createReportQueue, freezeReport, Submission } from './src/reports/queue';
import { createHazardRefresh } from './src/api/hazardRefresh';
import { apiUrl, fixtureMode, getHazards, getHealth, getRoutes, submitFeedback, submitReport, HazardCollection, Health, Report } from './src/api/client';
import { createFeedback, FeedbackState } from './src/feedback/feedback';
import { HazardPanel, PanelHazard } from './src/feedback/HazardPanel';
import { createNearbyPrompter, Position } from './src/feedback/nearby';
import { createRouteComparison, presentRoutes, RouteState } from './src/routes/model';
import { DARK_ROUTE_COLORS, ROUTE_COLORS, RouteScreen, Target } from './src/routes/RouteScreen';
import { MapLibreView } from './src/map/MapLibreView';
import { buildOverlay } from './src/map/overlay';
import { bboxParam, boundsAround, Bounds, LngLat, MapTheme } from './src/map/protocol';

const CENTER: LngLat = [-84.3853, 33.7531];
const INITIAL_ZOOM = 14.5;
// Same area the old initial region covered; replaced by the map's real bounds once it settles.
const INITIAL_BOUNDS = boundsAround(CENTER, 0.012, 0.012);
const center = { latitude: CENTER[1], longitude: CENTER[0] };
const toLatLng = ([longitude, latitude]: LngLat) => ({ latitude, longitude });
export default function App() {
  const [screen, setScreen] = useState<'map'|'report'|'route'>('map');
  const [mapTheme, setMapTheme] = useState<MapTheme>('light');
  // One object per settled viewport (moveend): the hazard refresh compares it by identity.
  const [region, setRegion] = useState<Bounds>(INITIAL_BOUNDS);
  const currentRegion = useRef<Bounds>(INITIAL_BOUNDS);
  function changeRegion(next: Bounds) {
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
  const [description, setDescription] = useState('');
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [error, setError] = useState('');
  const [hazardError, setHazardError] = useState('');
  const [now, setNow] = useState(Date.now());
  // A delayed submit keeps this same function, which reads the current viewport.
  const [refresh] = useState(() => createHazardRefresh(
    () => currentRegion.current,
    region => getHazards(bboxParam(region)),
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
  const [feedbackStates, setFeedbackStates] = useState<Readonly<Record<string, FeedbackState>>>({});
  const [selected, setSelected] = useState<PanelHazard | null>(null);
  const [feedback] = useState(() => createFeedback({
    send: submitFeedback, uuid: Crypto.randomUUID, onChange: setFeedbackStates, onAccepted: () => void refresh(),
  }));
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
  const routeColors = mapTheme === 'dark' ? DARK_ROUTE_COLORS : ROUTE_COLORS;
  function send() {
    return guardSubmit(async () => {
      setSubmitting(true); setError('');
      try {
        await queue.enqueue(freezeReport({ kind, lat: pin.latitude, lon: pin.longitude, description }, Date.now(), Crypto.randomUUID()));
        setDescription('');
        void queue.drain();
      } catch (e) { setError(`Report was not saved: ${String(e)}`); }
      finally { setSubmitting(false); }
    });
  }
  const visible = hazards.filter(h => h.properties.status === 'active' && Date.parse(h.properties.expires_at) > now);
  const overlay = buildOverlay({
    screen, hazards: visible, submissions, pin: { lat: pin.latitude, lon: pin.longitude },
    routes: presented, origin: routeState.origin, destination: routeState.destination, routeColors,
    selectedHazardId: selected?.id,
  });
  const selectedOnMap = visible.find(h => h.properties.id === selected?.id);
  useEffect(() => {
    if (selectedOnMap) setSelected(current => current && { ...current, ...selectedOnMap.properties });
  }, [selectedOnMap && JSON.stringify(selectedOnMap.properties)]);
  const [nearby] = useState(() => createNearbyPrompter());
  const nearbyContext = useRef({ visible, selected });
  nearbyContext.current = { visible, selected };
  useEffect(() => {
    if (fixtureMode) return;
    let subscription: { remove(): void } | null = null;
    let generation = 0;
    function onPosition(position: Position) {
      const { visible, selected } = nearbyContext.current;
      if (selected) return;
      const id = nearby.next(position, visible.map(h => ({ id: h.properties.id, ring: h.geometry.coordinates[0] })));
      const hazard = id && visible.find(h => h.properties.id === id);
      if (hazard) setSelected({ ...hazard.properties });
    }
    async function start() {
      const mine = ++generation;
      const { granted } = await Location.requestForegroundPermissionsAsync();
      if (!granted || mine !== generation) return;
      const watching = await Location.watchPositionAsync({ accuracy: Location.Accuracy.Balanced, distanceInterval: 10, timeInterval: 5000 },
        ({ coords }) => onPosition({ lat: coords.latitude, lon: coords.longitude }));
      if (mine !== generation) watching.remove(); else subscription = watching;
    }
    function stop() { generation++; subscription?.remove(); subscription = null; }
    void start();
    const appState = AppState.addEventListener('change', state => { if (state === 'active') { if (!subscription) void start(); } else stop(); });
    return () => { stop(); appState.remove(); };
  }, []);
  function onSelectHazard(id: string) {
    const hazard = visible.find(h => h.properties.id === id);
    if (hazard) setSelected({ ...hazard.properties });
  }
  function onMapPress(position: LngLat) {
    if (screen === 'report') setPin(toLatLng(position));
    else if (screen === 'route') placeRouteEndpoint(toLatLng(position));
  }
  function onMarkerDrag(id: string, position: LngLat) {
    if (id === 'pin') setPin(toLatLng(position));
    else if (id === 'origin' || id === 'destination') placeRouteEndpoint(toLatLng(position), id);
  }
  return <SafeAreaView style={styles.page}>
    <Text style={styles.title}>Campus hazards</Text>
    <Text style={styles.notice}>{fixtureMode ? 'DEMO · Offline fixture preview' : server?.storage === 'memory' ? 'Test server · reports are not kept when it restarts' : ''}</Text>
    <View style={styles.tabs}>{(['map','report','route'] as const).map(tab => <Button key={tab} title={tab} onPress={() => setScreen(tab)} />)}</View>
    <Button title={mapTheme === 'light' ? 'Map: Positron (switch to Dark Matter)' : 'Map: Dark Matter (switch to Positron)'}
      onPress={() => setMapTheme(mapTheme === 'light' ? 'dark' : 'light')} />
    <MapLibreView style={styles.map} center={CENTER} zoom={INITIAL_ZOOM} theme={mapTheme} overlay={overlay}
      onPress={onMapPress} onDragEnd={onMarkerDrag} onBounds={changeRegion} onSelect={onSelectHazard} />
    <ScrollView style={styles.content}>
      {selected && <HazardPanel hazard={selected} onMap={!!selectedOnMap} state={feedbackStates[selected.id]} disabled={fixtureMode}
        onRespond={response => void feedback.respond(selected.id, response)} onRetry={() => void feedback.retry(selected.id)}
        onClose={() => setSelected(null)} />}
      {screen === 'map' && <>
        <Button title="Refresh hazards" onPress={() => void refresh()} />
        {visible.length === 0 && <Text>No active reports in these bounds.</Text>}
        {visible.length > 0 && !selected && <Text>Tap a hazard pin to answer “Is it still there?”</Text>}
        {visible.map(h => <View key={h.properties.id} style={styles.card}>
          <Text style={styles.heading}>{h.properties.source === 'manual' ? 'Community report' : `Automatically detected · ${h.properties.evidence_source}`}</Text>
          <Text>{h.properties.label}</Text><Text>Expires {new Date(h.properties.expires_at).toLocaleString()}</Text>
        </View>)}
      </>}
      {screen === 'report' && <>
        <Text style={styles.heading}>Place a pin to report a hazard</Text>
        <Text>Tap the map or drag the pin. No location permission needed.</Text>
        <Text>{pin.latitude.toFixed(5)}, {pin.longitude.toFixed(5)}</Text>
        <Button title="Use my location (optional)" onPress={() => void useMyLocation()} />
        <View style={styles.tabs}>{(['pothole','obstruction','closure','other'] as const).map(k => <Button key={k} title={k === kind ? `✓ ${k}` : k} onPress={() => setKind(k)} />)}</View>
        <TextInput style={styles.input} value={description} onChangeText={setDescription} maxLength={280} placeholder="Description (optional)" />
        <Text>Reports are saved on this phone and retried with the same ID until the server answers. Pending reports are not yet accepted hazards.</Text>
        <Button title="Submit report" disabled={fixtureMode || submitting} onPress={() => void send()} />
        {submissions.map(sub => <View key={sub.id} style={styles.card}>
          <Text style={styles.heading}>{sub.body.kind} · {sub.state === 'queued' ? 'queued (pending, not accepted)' : sub.state}</Text>
          <Text>Observed {new Date(sub.body.observed_at).toLocaleString()}{sub.attempts ? ` · attempts ${sub.attempts}` : ''}</Text>
          {!!sub.error && <Text style={styles.error}>{sub.error}{sub.retryable ? '' : '\nThe server rejected this report; dismiss it and submit a corrected one.'}</Text>}
          {sub.state === 'failed' && sub.retryable && <Button title="Retry original report" onPress={() => void queue.retry(sub.id)} />}
          {(sub.state === 'submitted' || (sub.state === 'failed' && !sub.retryable)) && <Button title="Dismiss" onPress={() => void queue.dismiss(sub.id)} />}
        </View>)}
        {fixtureMode && <Text>Fixture preview only. Configure the product API URL to submit.</Text>}
      </>}
      {screen === 'route' && <RouteScreen state={routeState} target={routeTarget} offlinePreview={fixtureMode} routeColors={routeColors}
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
  heading: { fontSize: 17, fontWeight: '600', marginVertical: 6 }, input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#aaa', padding: 12, marginVertical: 12 }, error: { color: '#a00020', marginVertical: 8 },
});
