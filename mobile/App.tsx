import React, { useEffect, useRef, useState } from 'react';
import { AppState, SafeAreaView, ScrollView, View, Text, Button, TextInput, StyleSheet } from 'react-native';
import MapView, { Marker, Polygon, Polyline, Region } from 'react-native-maps';
import * as Crypto from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createSubmitGuard } from './src/reports/submit';
import { createReportQueue, freezeReport, Submission } from './src/reports/queue';
import { createHazardRefresh } from './src/api/hazardRefresh';
import { ApiError, apiUrl, fixtureMode, getHazards, getRoutes, submitReport, HazardCollection, Report, RouteResponse } from './src/api/client';

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
  const [routes, setRoutes] = useState<RouteResponse>();
  const [kind, setKind] = useState<Report['kind']>('pothole');
  const [description, setDescription] = useState('');
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
  // Polling is intentionally simple in the skeleton. Lane A adds reconnecting live updates.
  useEffect(() => {
    if (!apiUrl) return;
    const tick = setInterval(() => void refresh(), 5000);
    return () => clearInterval(tick);
  }, [region]);
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
    const sub = AppState.addEventListener('change', state => { if (state === 'active') { void refresh(); void queue.drain(); } });
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
  return <SafeAreaView style={styles.page}>
    <Text style={styles.title}>Campus hazards</Text>
    <Text style={styles.notice}>{fixtureMode ? 'DEMO · Offline fixture preview' : 'STAGE 0 · Nonpersistent API'}</Text>
    <View style={styles.tabs}>{(['map','report','route'] as const).map(tab => <Button key={tab} title={tab} onPress={() => setScreen(tab)} />)}</View>
    <MapView style={styles.map} initialRegion={center} onRegionChangeComplete={changeRegion}
      onPress={e => { if (screen === 'report') setPin(e.nativeEvent.coordinate); }}>
      {visible.map(h => <Polygon key={h.properties.id} coordinates={h.geometry.coordinates[0].map(toPoint)}
        holes={h.geometry.coordinates.slice(1).map(r => r.map(toPoint))}
        strokeColor={h.properties.source === 'manual' ? '#af4d00' : '#5555bb'} fillColor={h.properties.source === 'manual' ? '#fa9f4266' : '#7777dd66'} />)}
      {visible.map(h => <Marker key={`marker-${h.properties.id}`} coordinate={toPoint(h.geometry.coordinates[0][0])}
        title={h.properties.source === 'manual' ? 'Community report' : `Automatically detected · ${h.properties.evidence_source}`}
        description={h.properties.label} />)}
      {submissions.filter(sub => sub.state !== 'submitted').map(sub => <Marker key={`pending-${sub.id}`} coordinate={{ latitude: sub.body.lat, longitude: sub.body.lon }}
        pinColor="blue" title="Pending report (not yet accepted)" description={sub.body.kind} />)}
      {screen === 'report' && <Marker coordinate={pin} draggable title="Report location"
        onDragEnd={e => setPin(e.nativeEvent.coordinate)} />}
      {screen === 'route' && routes?.routes.map(r => <Polyline key={r.kind} coordinates={r.geometry.coordinates.map(toPoint)} strokeWidth={4} strokeColor={r.kind === 'shortest' ? '#666666' : '#005f73'} />)}
    </MapView>
    <ScrollView style={styles.content}>
      {screen === 'map' && <>
        <Button title="Refresh hazards" onPress={() => void refresh()} />
        {visible.length === 0 && <Text>No active reports in these bounds.</Text>}
        {visible.map(h => <View key={h.properties.id} style={styles.card}>
          <Text style={styles.heading}>{h.properties.source === 'manual' ? 'Community report' : `Automatically detected · ${h.properties.evidence_source}`}</Text>
          <Text>{h.properties.label}</Text><Text>Expires {new Date(h.properties.expires_at).toLocaleString()}</Text>
        </View>)}
      </>}
      {screen === 'report' && <>
        <Text style={styles.heading}>Place a pin to report a hazard</Text>
        <Text>Tap the map or drag the pin. No location permission needed.</Text>
        <Text>{pin.latitude.toFixed(5)}, {pin.longitude.toFixed(5)}</Text>
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
      {screen === 'route' && <>
        <Text style={styles.heading}>GSU route comparison preview</Text>
        <Text>Fixed illustrative routes only. Not navigation; these do not respond to reports yet.</Text>
        <Button title="Compare example routes" onPress={async () => { try { setRoutes(await getRoutes()); setError(''); } catch (e) { setError(String(e)); } }} />
        {routes?.routes.map(r => <Text key={r.kind}>{r.kind === 'shortest' ? 'Shortest' : 'Lower-risk'}: {r.distance_m} m · {Math.round(r.duration_s/60)} min · risk {r.risk_score}</Text>)}
        {routes && !routes.safest_available && <Text>No lower-risk alternative available.</Text>}
      </>}
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      {!!hazardError && <Text accessibilityRole="alert" style={styles.error}>{hazardError}</Text>}
    </ScrollView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f5f4ef' }, title: { fontSize: 26, fontWeight: '700', padding: 12 },
  notice: { paddingHorizontal: 12, color: '#765000' }, tabs: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-around' },
  map: { height: '43%' }, content: { padding: 16 }, card: { paddingVertical: 12, borderBottomWidth: 1, borderColor: '#ddd' },
  heading: { fontSize: 17, fontWeight: '600', marginVertical: 6 }, input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#aaa', padding: 12, marginVertical: 12 }, error: { color: '#a00020', marginVertical: 8 },
});
