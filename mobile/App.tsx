import React, { useEffect, useRef, useState } from 'react';
import { AppState, Keyboard, SafeAreaView, ScrollView, View, Text, TextInput, StyleSheet, Pressable, KeyboardAvoidingView, Platform, StatusBar } from 'react-native';
import { ActionButton as Button } from './src/ui/ActionButton';
import { SilverTexture } from './src/ui/SilverTexture';
import { Icon } from './src/ui/Icon';
import { palette, useTheme, useAppearance, ThemeProvider, type Theme } from './src/ui/theme';
import { MapLibreView } from './src/map/MapLibreView';
import { buildOverlay } from './src/map/overlay';
import { bboxParam, boundsAround, Bounds, LngLat } from './src/map/protocol';
import * as Crypto from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { connectLive, liveUrl } from './src/api/live';
import { locateOnce } from './src/location/foreground';
import { createForegroundWatch } from './src/location/foregroundWatch';
import { createSubmitGuard } from './src/reports/submit';
import { createReportQueue, freezeReport, Submission } from './src/reports/queue';
import { createHazardRefresh } from './src/api/hazardRefresh';
import { apiUrl, fixtureMode, getHazards, getHealth, getRoutes, searchPlaces, submitFeedback, submitReport, HazardCollection, Health, Report } from './src/api/client';
import { createFeedback, FeedbackState } from './src/feedback/feedback';
import { HazardPanel } from './src/feedback/HazardPanel';
import { createNearbyWatcher } from './src/feedback/nearby';
import { createHazardSelection, HazardSelection, selectionAvailable } from './src/feedback/selection';
import { canRequest, createRouteComparison, presentRoutes, RouteState } from './src/routes/model';
import { routeColors, RouteScreen } from './src/routes/RouteScreen';
import { createPlaceSearch, SearchState } from './src/trip/placeSearch';
import { createTrip, endpointPoint, TripState, Which } from './src/trip/trip';
import { TripFields } from './src/trip/TripFields';

const CENTER: LngLat = [-84.3853, 33.7531];
const INITIAL_ZOOM = 14.5;
// Same area the old initial region covered; replaced by the map's real bounds once it settles.
const INITIAL_BOUNDS = boundsAround(CENTER, 0.012, 0.012);
const center = { latitude: CENTER[1], longitude: CENTER[0] };
const toLatLng = ([longitude, latitude]: LngLat) => ({ latitude, longitude });
export default function App() {
  return <ThemeProvider><CampusApp /></ThemeProvider>;
}
function CampusApp() {
  const { scheme: colorScheme, toggle: toggleAppearance } = useAppearance();
  const theme = useTheme();
  const styles = createStyles(theme);

  const [screen, setScreen] = useState<'map'|'report'|'route'>('map');
  const [expanded, setExpanded] = useState(false);
  const [dockHeight, setDockHeight] = useState(220);
  const [pageHeight, setPageHeight] = useState(0);
  const [safeFrame, setSafeFrame] = useState({ y: 0, height: 0 });
  const bottomInset = Math.max(0, pageHeight - safeFrame.y - safeFrame.height);
  function openScreen(next: 'map' | 'report' | 'route') { setScreen(next); setExpanded(false); if (next !== 'route') { setPicking(null); setEditing(null); } }
  const mapTheme = colorScheme;
  const ROUTE_COLORS = { ...routeColors(theme), shortest: mapTheme === 'dark' ? palette.silver : palette.charcoal };
  // One object per settled viewport (moveend): the hazard refresh compares it by identity.
  const [region, setRegion] = useState<Bounds>(INITIAL_BOUNDS);
  const currentRegion = useRef<Bounds>(INITIAL_BOUNDS);
  function changeRegion(next: Bounds) {
    currentRegion.current = next;
    setRegion(next);
  }
  const [pin, setPin] = useState({ latitude: center.latitude, longitude: center.longitude });
  const [hazards, setHazards] = useState<HazardCollection['features']>([]);
  const [permissionRevision, setPermissionRevision] = useState(0);
  const locateForAction = () => locateOnce(Location, Location.Accuracy.Balanced,
    () => setPermissionRevision(value => value + 1));
  // Route endpoints and their comparison live apart from the report form and the hazard feed.
  const [routeState, setRouteState] = useState<RouteState>({ origin: null, destination: null, status: 'idle', result: null, error: null, outdated: false });
  const [comparison] = useState(() => createRouteComparison({ load: getRoutes, onChange: setRouteState }));
  const [tripState, setTripState] = useState<TripState>({ origin: { kind: 'current', status: 'idle', point: null }, destination: { kind: 'none' } });
  const [trip] = useState(() => createTrip({
    locate: locateForAction,
    setOrigin: comparison.setOrigin, setDestination: comparison.setDestination, onChange: setTripState,
  }));
  const [editing, setEditing] = useState<Which | null>(null);
  const [picking, setPicking] = useState<Which | null>(null);
  const [searchState, setSearchState] = useState<SearchState>({ query: '', status: 'idle', places: [] });
  const [placeSearch] = useState(() => createPlaceSearch({
    // Ranking bias only: the chosen origin when known, otherwise the visible map centre.
    search: query => searchPlaces(query, endpointPoint(trip.state().origin) ?? {
      lat: (currentRegion.current.south + currentRegion.current.north) / 2, lon: (currentRegion.current.west + currentRegion.current.east) / 2 }),
    onChange: setSearchState, schedule: (run, ms) => setTimeout(run, ms), cancel: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
  }));
  function editEndpoint(which: Which | null) { setEditing(which); setPicking(null); placeSearch.reset(); }
  function planTrip() { openScreen('route'); editEndpoint(trip.state().destination.kind === 'none' ? 'destination' : null); void trip.start(); }
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
      onChange: () => { void refresh(); comparison.hazardsChanged(); void nearby.invalidate(); void selection.refresh(); }, onStatus: setLiveConnected,
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
  const [selectionState, setSelectionState] = useState<HazardSelection<HazardCollection['features'][number]> | null>(null);
  const [selection] = useState(() => createHazardSelection({ load: getHazards, onChange: setSelectionState }));
  const selected = selectionState?.feature.properties ?? null;
  const [feedback] = useState(() => createFeedback({
    send: submitFeedback, uuid: Crypto.randomUUID, onChange: setFeedbackStates,
    onAccepted: () => { void refresh(); void selection.refresh(); void nearby.invalidate(); comparison.hazardsChanged(); },
  }));
  useEffect(() => {
    void selection.setActive(AppState.currentState === 'active');
    const subscription = AppState.addEventListener('change', state => { void selection.setActive(state === 'active'); });
    const timer = setInterval(() => { if (AppState.currentState === 'active') void selection.refresh(); }, 5000);
    return () => { clearInterval(timer); subscription.remove(); void selection.setActive(false); };
  }, []);
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
    const result = await locateForAction();
    if (result.ok) { setPin({ latitude: result.lat, longitude: result.lon }); setError(''); }
    else setError(result.reason === 'denied' ? 'Location permission denied. Tap the map to place the pin instead.' : 'Could not get your location. Tap the map to place the pin instead.');
  }
  useEffect(() => {
    if (routeState.status === 'idle' && canRequest(routeState)) void comparison.request();
  }, [routeState.origin, routeState.destination, routeState.status]);
  const presented = routeState.result ? presentRoutes(routeState.result) : null;
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
    routes: presented, origin: routeState.origin, destination: routeState.destination, routeColors: ROUTE_COLORS,
    selectedHazardId: selected?.id,
  });
  if (mapTheme === 'dark' && overlay.routes.some(line => line.id === 'lower-risk')) {
    const line = overlay.routes.find(line => line.id === 'lower-risk')!;
    overlay.routes.unshift({ ...line, id: 'lower-risk-casing', color: palette.silver, width: 10 });
  }
  const [nearby] = useState(() => createNearbyWatcher({
    load: getHazards, now: Date.now, busy: () => !!selection.state(),
    onPrompt: hazard => { void selection.select(hazard); },
  }));
  useEffect(() => { if (!selected) nearby.evaluate(); }, [selected]);
  useEffect(() => {
    if (fixtureMode) return;
    const watcher = createForegroundWatch<Location.LocationObject>({
      permission: () => Location.getForegroundPermissionsAsync(),
      watch: onPosition => Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 10, timeInterval: 5000 }, onPosition),
      onPosition: ({ coords }) => void nearby.position({ lat: coords.latitude, lon: coords.longitude }),
      onActive: active => { void nearby.setActive(active); },
    });
    void watcher.setActive(AppState.currentState === 'active');
    const appState = AppState.addEventListener('change', state => {
      void watcher.setActive(state === 'active');
    });
    return () => { void watcher.setActive(false); appState.remove(); };
  }, [permissionRevision]);
  function onSelectHazard(id: string) {
    const hazard = visible.find(h => h.properties.id === id);
    if (hazard) void selection.select(hazard);
  }
  function onMapPress(position: LngLat) {
    if (screen === 'report') setPin(toLatLng(position));
    else if (screen === 'route' && picking) { trip.pick(picking, { lat: position[1], lon: position[0] }); setPicking(null); }
  }
  function onMarkerDrag(id: string, position: LngLat) {
    if (id === 'pin') setPin(toLatLng(position));
    else if (id === 'origin' || id === 'destination') trip.pick(id, { lat: position[1], lon: position[0] });
  }
  const latestSubmission = submissions[submissions.length - 1];
  const pendingCount = submissions.filter(sub => sub.state !== 'submitted').length;
  return <View style={styles.page} onLayout={e => setPageHeight(e.nativeEvent.layout.height)}>
    <StatusBar barStyle={colorScheme === 'dark' ? 'light-content' : 'dark-content'} translucent backgroundColor="transparent" />
    <View style={[styles.map, { bottom: dockHeight + bottomInset }]}><MapLibreView style={{ flex: 1 }} center={CENTER} zoom={INITIAL_ZOOM} theme={mapTheme} overlay={overlay}
      onPress={onMapPress} onDragEnd={onMarkerDrag} onBounds={changeRegion} onSelect={onSelectHazard} /></View>
    <SafeAreaView pointerEvents="box-none" style={styles.safeControls}>
    <KeyboardAvoidingView pointerEvents="box-none" style={styles.canvas} behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      onLayout={e => { const { y, height } = e.nativeEvent.layout; setSafeFrame({ y, height }); }}>
    <View pointerEvents="box-none" style={styles.overlay}>
      <View style={styles.header}>
        <Pressable accessibilityRole="switch" accessibilityLabel="Dark mode" accessibilityState={{ checked: colorScheme === 'dark' }} onPress={toggleAppearance} style={styles.iconButton}>
          <Icon name={colorScheme === 'dark' ? 'moon' : 'sun'} />
        </Pressable>
      </View>
      {server?.storage === 'memory' && <Text style={styles.notice}>Test server · reports reset on restart</Text>}
      <View style={styles.space} pointerEvents="none" />
      <View style={[styles.dock, expanded && styles.dockExpanded]} onLayout={e => setDockHeight(e.nativeEvent.layout.height)}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetLabel}>{fixtureMode ? 'DEMO · ' : ''}{screen === 'map' ? `${visible.length} nearby reports` : screen === 'route' ? 'Your trip' : pendingCount ? `Report hazard · ${pendingCount} pending` : 'Report hazard'}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={expanded ? 'Collapse details' : 'Expand details'}
            accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)} style={styles.iconButton}>
            <Icon name={expanded ? 'collapse' : 'expand'} />
          </Pressable>
        </View>
        <ScrollView key={screen} style={styles.content} contentContainerStyle={styles.contentInner} keyboardShouldPersistTaps="handled">
      {selected && <HazardPanel hazard={selected} available={selectionAvailable(selectionState, now)} state={feedbackStates[selected.id]} disabled={fixtureMode}
        availabilityError={selectionState?.error}
        onRespond={response => void feedback.respond(selected.id, response)} onRetry={() => void feedback.retry(selected.id)}
        onClose={() => selection.clear()} />}
      {screen === 'map' && <>
        <Button primary icon="route" title={routeState.origin || routeState.destination ? 'Continue trip' : 'Where to?'}
          onPress={planTrip} />
        {pendingCount > 0 && <Text style={styles.caption}>{pendingCount} pending · not yet accepted</Text>}
        {expanded && <>
          {visible.length === 0 && <Text style={styles.caption}>No reports here. Unreported hazards may still exist.</Text>}
          {visible.map(h => <View key={h.properties.id} style={styles.card}>
            <Text style={styles.source}>{h.properties.source === 'manual' ? 'Community report' : `Automatically detected · ${h.properties.evidence_source}`}</Text>
            <Text style={styles.heading}>{h.properties.label}</Text>
            <Text style={styles.caption}>Expires {new Date(h.properties.expires_at).toLocaleString()}</Text>
          </View>)}
          <Button title="Refresh reports" onPress={() => void refresh()} />
        </>}
      </>}
      {screen === 'report' && <>
        <Text style={styles.caption}>Tap to place · drag to adjust</Text>
        {expanded && <Button icon="locate" title="Use my location" onPress={() => void useMyLocation()} />}
        <View style={styles.categories}>{(['pothole','obstruction','closure','other'] as const).map(k => <Pressable key={k}
          accessibilityRole="button" accessibilityLabel={k} accessibilityState={{ selected: k === kind }} onPress={() => setKind(k)}
          style={[styles.category, k === kind && styles.categorySelected]}>
          {k !== kind && <SilverTexture />}
          <Icon name={k} color={k === kind ? theme.inverse : theme.controlInk} /><Text style={[styles.categoryLabel, k === kind && styles.categoryLabelSelected]}>{k[0].toUpperCase() + k.slice(1)}</Text>
        </Pressable>)}</View>
        {expanded && <TextInput accessibilityLabel="Optional report description" style={styles.input} value={description} onChangeText={setDescription} maxLength={280} placeholderTextColor={theme.muted} placeholder="Description (optional)" />}

        <Button primary title={submitting ? 'Saving report…' : 'Submit report'} disabled={fixtureMode || submitting} onPress={() => void send()} />
        {!expanded && latestSubmission && <Text accessibilityLiveRegion="polite" style={latestSubmission.state === 'failed' ? styles.error : styles.caption}>
          {latestSubmission.state === 'submitted' ? 'Report submitted' : latestSubmission.state === 'sending' ? 'Sending report…' : latestSubmission.state === 'queued' ? 'Queued · not yet accepted' : 'Report failed · expand for details and retry'}
        </Text>}
        {expanded && submissions.map(sub => <View key={sub.id} style={styles.card}>
          <Text style={styles.heading}>{sub.body.kind} · {sub.state === 'queued' ? 'queued (pending, not accepted)' : sub.state}</Text>
          <Text style={styles.caption}>Observed {new Date(sub.body.observed_at).toLocaleString()}{sub.attempts ? ` · attempts ${sub.attempts}` : ''}</Text>
          {!!sub.error && <Text style={styles.error}>{sub.error}{sub.retryable ? '' : '\nThe server rejected this report; dismiss it and submit a corrected one.'}</Text>}
          {sub.state === 'failed' && sub.retryable && <Button title="Retry original report" onPress={() => void queue.retry(sub.id)} />}
          {(sub.state === 'submitted' || (sub.state === 'failed' && !sub.retryable)) && <Button title="Dismiss" onPress={() => void queue.dismiss(sub.id)} />}
        </View>)}
        {fixtureMode && <Text style={styles.caption}>Demo · submitting is unavailable</Text>}
      </>}
      {screen === 'route' && <RouteScreen colors={ROUTE_COLORS} expanded={expanded} state={routeState} offlinePreview={fixtureMode}
        fields={<TripFields trip={tripState} editing={editing} picking={picking} search={searchState}
          onEdit={editEndpoint} onCancel={() => editEndpoint(null)}
          onType={text => { if (editing) trip.edit(editing); placeSearch.type(text); }}
          onChoose={place => { if (editing) trip.choose(editing, place); editEndpoint(null); Keyboard.dismiss(); }}
          onRetrySearch={() => void placeSearch.retry()}
          onUseCurrent={() => { editEndpoint(null); void trip.useCurrentLocation(); }}
          onRetryLocation={() => void trip.retryLocation()}
          onPickOnMap={which => { editEndpoint(null); setPicking(which); Keyboard.dismiss(); }} />}
        canSwap={trip.canSwap()} onCompare={() => void comparison.request()}
        onSwap={() => trip.swap()} onClear={() => { void trip.clear(); editEndpoint('destination'); }} />}
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      {!!hazardError && <Text accessibilityRole="alert" style={styles.error}>{hazards.length ? 'Offline or stale: showing the last successful results. ' : ''}{hazardError}</Text>}
        </ScrollView>
        <View style={styles.tabs}>{(['map','route','report'] as const).map(tab => <Button key={tab}
          icon={tab} selected={screen === tab} title={tab === 'map' ? 'Map' : tab === 'route' ? 'Trip' : 'Report'} onPress={() => tab === 'route' ? planTrip() : openScreen(tab)} />)}</View>
      </View>
    </View>
    </KeyboardAvoidingView>
    </SafeAreaView>
  </View>;
}
const createStyles = (theme: Theme) => StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.canvas }, canvas: { flex: 1 }, safeControls: { flex: 1 },
  map: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  overlay: { flex: 1, paddingTop: 8 },
  header: { alignSelf: 'flex-end', marginRight: 12 },
  notice: { fontFamily: theme.fontBody, padding: 8, marginHorizontal: 12, backgroundColor: theme.surface, color: theme.warning },
  space: { flex: 1 },
  dock: { maxHeight: '36%', backgroundColor: theme.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22,
    borderWidth: 1, borderColor: theme.line, paddingHorizontal: 14, paddingBottom: 4 },
  dockExpanded: { maxHeight: '65%' },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  sheetLabel: { fontFamily: theme.fontBody, fontSize: 13, color: theme.muted },
  iconButton: { width: 48, height: 44, alignItems: 'center', justifyContent: 'center' },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-around', gap: 6 },
  categories: { flexDirection: 'row', gap: 6, marginVertical: 6 },
  category: { overflow: 'hidden', backgroundColor: theme.quiet, flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 64, paddingVertical: 8, borderWidth: 1, borderColor: theme.line, borderRadius: theme.radius },
  categorySelected: { backgroundColor: theme.selected, borderColor: theme.selectedEdge },
  categoryLabel: { fontFamily: theme.fontBody, fontSize: 11, color: theme.controlInk, textAlign: 'center' },
  categoryLabelSelected: { color: theme.inverse },
  content: { flexShrink: 1 }, contentInner: { paddingBottom: 8 },
  caption: { fontFamily: theme.fontLight, fontSize: 12, lineHeight: 18, color: theme.muted },
  source: { fontFamily: theme.fontBody, color: theme.ink, fontSize: 12, fontWeight: '600' },
  card: { paddingVertical: 10, borderBottomWidth: 1, borderColor: theme.line },
  heading: { fontFamily: theme.fontBody, fontSize: 16, color: theme.ink, marginVertical: 4 },
  input: { fontFamily: theme.fontBody, color: theme.ink, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line, borderRadius: theme.radius,
    padding: 12, marginVertical: 8, minHeight: theme.touch },
  error: { fontFamily: theme.fontBody, color: theme.danger, marginVertical: 8 },
});
