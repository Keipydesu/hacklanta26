import React, { useEffect, useRef, useState } from 'react';
import { SafeAreaView, ScrollView, View, Text, Button, TextInput, StyleSheet } from 'react-native';
import MapView, { Marker, Polygon, Polyline, Region } from 'react-native-maps';
import * as Crypto from 'expo-crypto';
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
  const [draft, setDraft] = useState<Report>();
  const [status, setStatus] = useState<'draft'|'sending'|'submitted'|'failed'>('draft');
  const [retryable, setRetryable] = useState(true);
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
  async function send() {
    const body = draft ?? { id: Crypto.randomUUID(), kind, lat: pin.latitude, lon: pin.longitude, description, observed_at: new Date().toISOString() };
    setDraft(body); setStatus('sending'); setError('');
    try { await submitReport(body); setStatus('submitted'); await refresh(); }
    catch (e) {
      const permanent = e instanceof ApiError && e.permanent;
      setStatus('failed'); setRetryable(!permanent);
      setError(permanent ? `${String(e)}\nThe server rejected this report; start a new draft.` : String(e));
    }
  }
  function reset() { setDraft(undefined); setStatus('draft'); setRetryable(true); setError(''); }
  const visible = hazards.filter(h => h.properties.status === 'active' && Date.parse(h.properties.expires_at) > now);
  return <SafeAreaView style={styles.page}>
    <Text style={styles.title}>Campus hazards</Text>
    <Text style={styles.notice}>{fixtureMode ? 'DEMO · Offline fixture preview' : 'STAGE 0 · Nonpersistent API'}</Text>
    <View style={styles.tabs}>{(['map','report','route'] as const).map(tab => <Button key={tab} title={tab} onPress={() => setScreen(tab)} />)}</View>
    <MapView style={styles.map} initialRegion={center} onRegionChangeComplete={changeRegion}
      onPress={e => { if (screen === 'report' && status === 'draft') setPin(e.nativeEvent.coordinate); }}>
      {visible.map(h => <Polygon key={h.properties.id} coordinates={h.geometry.coordinates[0].map(toPoint)}
        holes={h.geometry.coordinates.slice(1).map(r => r.map(toPoint))}
        strokeColor={h.properties.source === 'manual' ? '#af4d00' : '#5555bb'} fillColor={h.properties.source === 'manual' ? '#fa9f4266' : '#7777dd66'} />)}
      {visible.map(h => <Marker key={`marker-${h.properties.id}`} coordinate={toPoint(h.geometry.coordinates[0][0])}
        title={h.properties.source === 'manual' ? 'Community report' : `Automatically detected · ${h.properties.evidence_source}`}
        description={h.properties.label} />)}
      {screen === 'report' && <Marker coordinate={pin} draggable={status === 'draft'} title="Report location"
        onDragEnd={e => { if (status === 'draft') setPin(e.nativeEvent.coordinate); }} />}
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
        <View style={styles.tabs}>{(['pothole','obstruction','closure','other'] as const).map(k => <Button key={k} title={k === kind ? `✓ ${k}` : k} disabled={status !== 'draft'} onPress={() => setKind(k)} />)}</View>
        <TextInput style={styles.input} value={description} editable={status === 'draft'} onChangeText={setDescription} maxLength={280} placeholder="Description (optional)" />
        <Text>Report status: {status}</Text>
        <Text>Stage 0 has no persistent offline queue. A retry in this session keeps the original ID and body.</Text>
        <Button title={status === 'failed' ? 'Retry original report' : 'Submit report'} disabled={fixtureMode || status === 'sending' || status === 'submitted' || !retryable} onPress={() => void send()} />
        <Button title="New draft" disabled={status === 'sending'} onPress={reset} />
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
