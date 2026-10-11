import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Keyboard, Linking, SafeAreaView, ScrollView, View, Text, TextInput, StyleSheet, Pressable, KeyboardAvoidingView, Platform, StatusBar } from 'react-native';
import { ActionButton as Button } from './src/ui/ActionButton';
import { collapsedScreen } from './src/ui/sheetSnap';
import { BottomSheet } from './src/ui/BottomSheet';
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
import { locateOnce, locatePosition, requestForegroundPermission } from './src/location/foreground';
import { createForegroundWatch, WatchStatus } from './src/location/foregroundWatch';
import { freshPosition, livePosition, LivePosition } from './src/location/livePosition';
import { createReportLocation, ReportLocationState } from './src/reports/location';
import { CATEGORIES, categoryLabel, hazardSourceLabel, hazardTitle } from './src/reports/categories';
import { canSubmit, locationAction, shouldLocateOnEnter, showSubmit } from './src/reports/reportFlow';
import { createSubmitGuard } from './src/reports/submit';
import { createReportQueue, Submission } from './src/reports/queue';
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
export default function App() {
  return <ThemeProvider><CampusApp /></ThemeProvider>;
}
function CampusApp() {
  const { scheme: colorScheme, toggle: toggleAppearance } = useAppearance();
  const theme = useTheme();
  const styles = createStyles(theme);

  const [screen, setScreen] = useState<'map'|'report'|'route'>('map');
  const [recenterTarget, setRecenterTarget] = useState<{ position: LngLat; request: number }>();
  const [recentering, setRecentering] = useState(false);
  const [locationError, setLocationError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [overlayHeight, setOverlayHeight] = useState(600);
  const [dockHeight, setDockHeight] = useState(220);
  const [pageHeight, setPageHeight] = useState(0);
  const [safeFrame, setSafeFrame] = useState({ y: 0, height: 0 });
  const bottomInset = Math.max(0, pageHeight - safeFrame.y - safeFrame.height);
  function openScreen(next: 'map' | 'report' | 'route') {
    if (next === 'route' && screenRef.current !== 'route') { setFollowing(true); setCameraRevision(value => value + 1); }
    screenRef.current = next;
    setScreen(next); setExpanded(next === 'report'); Keyboard.dismiss();
    if (next !== 'route') { setPicking(null); setEditing(null); }
    if (next === 'report' && shouldLocateOnEnter(reportLocationRef.current.status)) void reportLocator.request();
  }
  const mapTheme = colorScheme;
  const ROUTE_COLORS = { ...routeColors(theme), shortest: mapTheme === 'dark' ? palette.silver : palette.charcoal };
  // One object per settled viewport (moveend): the hazard refresh compares it by identity.
  const [region, setRegion] = useState<Bounds>(INITIAL_BOUNDS);
  const currentRegion = useRef<Bounds>(INITIAL_BOUNDS);
  function changeRegion(next: Bounds) {
    currentRegion.current = next;
    setRegion(next);
  }
  const [reportLocation, setReportLocation] = useState<ReportLocationState>({ status: 'idle' });
  const reportLocationRef = useRef<ReportLocationState>({ status: 'idle' });
  const [reportLocator] = useState(() => createReportLocation({
    requestPermission: () => requestForegroundPermission(Location, () => setPermissionRevision(value => value + 1)),
    locate: () => locatePosition(Location, Location.Accuracy.Balanced),
    enabled: !fixtureMode,
    setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
    now: Date.now, onChange: next => { reportLocationRef.current = next; setReportLocation(next); },
  }));
  const screenRef = useRef(screen);
  screenRef.current = screen;
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      reportLocator.onAppState(state);
      if (state === 'active' && screenRef.current === 'report' && shouldLocateOnEnter(reportLocationRef.current.status)) void reportLocator.request();
    });
    return () => { sub.remove(); reportLocator.clear(); };
  }, []);
  const [hazards, setHazards] = useState<HazardCollection['features']>([]);
  const [permissionRevision, setPermissionRevision] = useState(0);
  const [position, setPosition] = useState<LivePosition | null>(null);
  const [watchStatus, setWatchStatus] = useState<WatchStatus>('paused');
  const [following, setFollowing] = useState(true);
  const [cameraRevision, setCameraRevision] = useState(0);
  async function followLocation() {
    setFollowing(true); setCameraRevision(value => value + 1);
    if (watchStatus === 'denied') {
      try { await requestForegroundPermission(Location, () => setPermissionRevision(value => value + 1)); }
      catch { setWatchStatus('unavailable'); }
    } else if (!freshPosition(position, Date.now())) setPermissionRevision(value => value + 1);
  }

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
  function editEndpoint(which: Which | null) {
    if (which) setFollowing(false);
    setEditing(which); setPicking(null); placeSearch.reset();
    if (which === null) Keyboard.dismiss();
  }
  const searching = screen === 'route' && editing !== null;
  function collapsePanel() {
    editEndpoint(null); selection.clear(); setExpanded(false);
    if (collapsedScreen(screen, !!endpointPoint(trip.state().destination)) === 'map') openScreen('map');
  }
  function finishSearch() {
    editEndpoint(null);
    if (!endpointPoint(trip.state().destination)) openScreen('map');
  }
  function snapPanel(open: boolean) {
    if (!open) { collapsePanel(); return; }
    if (screen === 'map' && !selected) {
      openScreen('route');
      if (!endpointPoint(trip.state().destination)) editEndpoint('destination');
      void trip.start();
    }
    setExpanded(true);
  }
  const [server, setServer] = useState<Health>();
  const [kind, setKind] = useState<Report['kind'] | null>(null);
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
  useEffect(() => {
    if (routeState.status === 'idle' && canRequest(routeState)) void comparison.request();
  }, [routeState.origin, routeState.destination, routeState.status]);
  const presented = routeState.result ? presentRoutes(routeState.result) : null;
  function send() {
    return guardSubmit(async () => {
      setSubmitting(true); setError('');
      try {
        if (fixtureMode || kind === null) return;
        await queue.enqueue(reportLocator.freeze({ kind }, Crypto.randomUUID()));
        reportLocator.clear();
        setKind(null);
        // Persistence may finish after navigation or backgrounding; read the live context.
        if (screenRef.current === 'report' && AppState.currentState === 'active') void reportLocator.request();
        void queue.drain();
      } catch (e) { setError(`Report was not saved: ${String(e)}`); }
      finally { setSubmitting(false); }
    });
  }
  const currentPosition = freshPosition(position, now);
  async function recenter() {
    if (screen === 'route') { void followLocation(); return; }
    if (recentering) return;
    setRecentering(true); setLocationError('');
    try {
      const fix = await locateForAction();
      if (fix.ok) setRecenterTarget({ position: [fix.lon, fix.lat], request: Date.now() });
      else setLocationError(fix.reason === 'denied' ? 'Location permission is off. Enable it in Settings, then retry recenter.' : 'Could not find your location. Tap recenter to try again.');
    } finally { setRecentering(false); }
  }
  const visible = hazards.filter(h => h.properties.status === 'active' && Date.parse(h.properties.expires_at) > now);
  const overlay = buildOverlay({
    screen, hazards: visible, submissions, pin: reportLocation.status === 'ready' && reportLocator.ready() ? reportLocation : null,
    livePosition: currentPosition, routes: presented?.illustrative ? null : presented, origin: routeState.origin, destination: routeState.destination, routeColors: ROUTE_COLORS,
    selectedHazardId: selected?.id,
    originIsCurrent: tripState.origin.kind === 'current', destinationIsCurrent: tripState.destination.kind === 'current',
  });
  if (screen === 'map' && recenterTarget && now - recenterTarget.request < 20_000) overlay.markers.push({ id: 'you', position: recenterTarget.position, color: '#2b6cd4', icon: 'location', title: 'Your location · last recenter fix' });
  if (mapTheme === 'dark' && overlay.routes.some(line => line.id === 'lower-risk')) {
    const line = overlay.routes.find(line => line.id === 'lower-risk')!;
    overlay.routes.unshift({ ...line, id: 'lower-risk-casing', color: palette.silver, width: 10 });
  }
  const [nearby] = useState(() => createNearbyWatcher({
    load: getHazards, now: Date.now, busy: () => !!selection.state(),
    onPrompt: hazard => { void selection.select(hazard); },
  }));
  useEffect(() => { if (!selected) nearby.evaluate(); else setExpanded(true); }, [selected]);
  useEffect(() => {
    if (fixtureMode && screen !== 'route') return;
    const watcher = createForegroundWatch<Location.LocationObject>({
      permission: () => Location.getForegroundPermissionsAsync(),
      watch: (onPosition, onError) => Location.watchPositionAsync(
        screen === 'route'
          ? { accuracy: Location.Accuracy.High, distanceInterval: 0, timeInterval: 1000 }
          : { accuracy: Location.Accuracy.Balanced, distanceInterval: 10, timeInterval: 5000 }, onPosition, onError),
      onPosition: fix => {
        setPosition(previous => livePosition(fix, Date.now(), previous));
        if (!fixtureMode) void nearby.position({ lat: fix.coords.latitude, lon: fix.coords.longitude });
      },
      onStatus: status => { setWatchStatus(status); if (status !== 'watching') setPosition(null); },
      onActive: active => { if (!fixtureMode) void nearby.setActive(active); },
    });
    void watcher.setActive(AppState.currentState === 'active');
    const appState = AppState.addEventListener('change', state => {
      void watcher.setActive(state === 'active');
    });
    return () => { void watcher.setActive(false); appState.remove(); };
  }, [permissionRevision, screen]);
  function onSelectHazard(id: string) {
    const hazard = visible.find(h => h.properties.id === id);
    if (hazard) { setExpanded(true); void selection.select(hazard); }
  }
  function onMapPress(position: LngLat) {
    if (screen === 'route' && picking) { trip.pick(picking, { lat: position[1], lon: position[0] }); setPicking(null); setExpanded(true); }
    else collapsePanel();
  }
  function onMarkerDrag(id: string, position: LngLat) {
    if (id === 'origin' || id === 'destination') trip.pick(id, { lat: position[1], lon: position[0] });
  }
  const latestSubmission = submissions[submissions.length - 1];
  const pendingCount = submissions.filter(sub => sub.state !== 'submitted').length;
  const tripFields = <TripFields trip={tripState} editing={editing} picking={picking} search={searchState}
          hideOrigin={!expanded && !searching && !picking} onEdit={editEndpoint} onCancel={finishSearch}
          onType={text => { if (editing) trip.edit(editing); placeSearch.type(text); }}
          onChoose={place => { if (editing) trip.choose(editing, place); finishSearch(); }}
          onRetrySearch={() => void placeSearch.retry()}
          onUseCurrent={() => { editEndpoint(null); void trip.useCurrentLocation(); }}
          onRetryLocation={() => void trip.retryLocation()}
          onPickOnMap={which => { editEndpoint(null); setFollowing(false); setPicking(which); }} />;
  return <View style={styles.page} onLayout={e => setPageHeight(e.nativeEvent.layout.height)}>
    <StatusBar barStyle={colorScheme === 'dark' ? 'light-content' : 'dark-content'} translucent backgroundColor="transparent" />
    <View style={[styles.map, { bottom: dockHeight + bottomInset }]}><MapLibreView style={{ flex: 1 }} center={CENTER} zoom={INITIAL_ZOOM} theme={mapTheme} overlay={overlay} recenter={recenterTarget}
      camera={{ position: currentPosition ? [currentPosition.lon, currentPosition.lat] : null, follow: screen === 'route' && following, revision: cameraRevision }}
      onGesture={() => setFollowing(false)} onPress={onMapPress} onDragEnd={onMarkerDrag} onBounds={changeRegion} onSelect={onSelectHazard} /></View>
    <SafeAreaView pointerEvents="box-none" style={styles.safeControls}>
    <KeyboardAvoidingView pointerEvents="box-none" style={styles.canvas} behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      onLayout={e => { const { y, height } = e.nativeEvent.layout; setSafeFrame({ y, height }); }}>
    <View pointerEvents="box-none" style={styles.overlay} onLayout={event => setOverlayHeight(event.nativeEvent.layout.height)}>
      {!searching && <View style={styles.header}>
        <Pressable accessibilityRole="switch" accessibilityLabel="Dark mode" accessibilityState={{ checked: colorScheme === 'dark' }} onPress={toggleAppearance} style={styles.mapControl}>
          <Icon name={colorScheme === 'dark' ? 'moon' : 'sun'} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Recenter on your location" accessibilityState={{ busy: recentering, disabled: recentering }} disabled={recentering} onPress={() => void recenter()} style={styles.mapControl}>
          {recentering ? <ActivityIndicator color={theme.ink} /> : <Icon name="locate" />}
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Report a map hazard" accessibilityState={{ selected: screen === 'report' }} onPress={() => { selection.clear(); openScreen('report'); }} style={styles.mapControl}>
          <Icon name="report" />
        </Pressable>
      </View>}
      {server?.storage === 'memory' && <Text style={styles.notice}>Test server · reports reset on restart</Text>}
      {!searching && <View style={styles.space} pointerEvents="none" />}
      <BottomSheet style={styles.dock} open={expanded || searching}
        closedHeight={screen === 'route' ? 176 : 132} openHeight={searching ? Math.max(132, overlayHeight - 8) : Math.max(176, overlayHeight * 0.65)}
        onSnap={snapPanel} onHeight={height => { if (!searching) setDockHeight(height); }}
        header={
        (screen !== 'map' || selected) ? <View style={styles.sheetHeader}>
          <Text style={styles.sheetLabel}>{fixtureMode ? 'DEMO · ' : ''}{screen === 'map' ? `${visible.length} nearby reports` : screen === 'route' ? (searching ? 'Search places' : 'Your trip') : pendingCount ? `Report hazard · ${pendingCount} pending` : 'Report hazard'}</Text>
          {!searching && screen !== 'map' && <Pressable accessibilityRole="button" accessibilityLabel="Back to map" onPress={() => { editEndpoint(null); selection.clear(); openScreen('map'); }} style={styles.closeSearch}><Text style={styles.closeLabel}>Done</Text></Pressable>}
          {searching && <Pressable accessibilityRole="button" accessibilityLabel="Close place search" onPress={finishSearch} style={styles.closeSearch}>
            <Text style={styles.closeLabel}>Done</Text>
          </Pressable>}
        </View> : null}>
        {searching && tripFields}
        {!searching && <ScrollView key={screen} style={styles.content} contentContainerStyle={styles.contentInner} keyboardShouldPersistTaps="handled">
      {selected && <HazardPanel hazard={selected} available={selectionAvailable(selectionState, now)} state={feedbackStates[selected.id]} disabled={fixtureMode}
        availabilityError={selectionState?.error}
        onRespond={response => void feedback.respond(selected.id, response)} onRetry={() => void feedback.retry(selected.id)}
        onClose={() => selection.clear()} />}
      {screen === 'map' && <>
        <View style={styles.destinationField}>
          <Icon name="pin" />
          <TextInput accessibilityLabel="Search destination" placeholder="Where to?" placeholderTextColor={theme.muted} style={styles.destinationInput}
            onFocus={() => { selection.clear(); openScreen('route'); editEndpoint('destination'); void trip.start(); }} />
        </View>
        {fixtureMode && <Text style={styles.caption}>Demo · example map data</Text>}
        {pendingCount > 0 && <Text style={styles.caption}>{pendingCount} pending · not yet accepted</Text>}
        {expanded && <>
          {visible.length === 0 && <Text style={styles.caption}>No reports here. Unreported hazards may still exist.</Text>}
          {visible.map(h => <View key={h.properties.id} style={styles.card}>
            <Text style={styles.source}>{hazardSourceLabel(h.properties)}</Text>
            <Text style={styles.heading}>{hazardTitle(h.properties)}</Text>
            <Text style={styles.caption}>Expires {new Date(h.properties.expires_at).toLocaleString()}</Text>
          </View>)}
          <Button title="Refresh reports" onPress={() => void refresh()} />
        </>}
      </>}
      {screen === 'report' && <>
        {reportLocation.status === 'locating' && <Text accessibilityRole="alert" style={styles.caption}>Getting your current location…</Text>}
        {reportLocation.status === 'denied' && <Text accessibilityRole="alert" style={styles.error}>Location permission is required to report a hazard. Enable it in Settings, then retry.</Text>}
        {reportLocation.status === 'unavailable' && <Text accessibilityRole="alert" style={styles.error}>Current location is unavailable. Check location services and retry; location is required to submit.</Text>}
        {reportLocation.status === 'expired' && <Text accessibilityRole="alert" style={styles.error}>Your location has expired. Refresh it before submitting.</Text>}
        {locationAction(reportLocation.status, fixtureMode) && <Button icon="locate" title={locationAction(reportLocation.status, fixtureMode)!}
          disabled={fixtureMode || submitting} onPress={() => void reportLocator.request()} />}
        {reportLocation.status === 'denied' && <Button title="Open location settings" onPress={() => void Linking.openSettings().catch(() => setError('Open device Settings to enable location permission.'))} />}
        <View style={styles.categories} accessibilityRole="radiogroup" accessibilityLabel="Hazard category">{CATEGORIES.map(({ kind: k, label, hint }) => <Pressable key={k}
          accessibilityRole="radio" accessibilityLabel={`${label}. ${hint}`} accessibilityState={{ selected: k === kind }} onPress={() => setKind(k)}
          style={[styles.category, k === kind && styles.categorySelected]}>
          {k !== kind && <SilverTexture />}
          <Icon name={k} color={k === kind ? theme.inverse : theme.controlInk} /><Text style={[styles.categoryLabel, k === kind && styles.categoryLabelSelected]}>{label}</Text>
        </Pressable>)}</View>

        {showSubmit(kind) && <Button primary title={submitting ? 'Saving…' : 'Submit'}
          disabled={!canSubmit({ kind, locationReady: reportLocator.ready(), fixtureMode, submitting })} onPress={() => void send()} />}
        {!expanded && latestSubmission && <Text accessibilityLiveRegion="polite" style={latestSubmission.state === 'failed' ? styles.error : styles.caption}>
          {latestSubmission.state === 'submitted' ? 'Report submitted' : latestSubmission.state === 'sending' ? 'Sending report…' : latestSubmission.state === 'queued' ? 'Queued · not yet accepted' : 'Report failed · expand for details and retry'}
        </Text>}
        {expanded && submissions.map(sub => <View key={sub.id} style={styles.card}>
          <Text style={styles.heading}>{categoryLabel(sub.body.kind)} · {sub.state === 'queued' ? 'queued (pending, not accepted)' : sub.state}</Text>
          <Text style={styles.caption}>Observed {new Date(sub.body.observed_at).toLocaleString()}{sub.attempts ? ` · attempts ${sub.attempts}` : ''}</Text>
          {!!sub.error && <Text style={styles.error}>{sub.error}{sub.retryable ? '' : '\nThe server rejected this report; dismiss it and submit a corrected one.'}</Text>}
          {sub.state === 'failed' && sub.retryable && <Button title="Retry original report" onPress={() => void queue.retry(sub.id)} />}
          {(sub.state === 'submitted' || (sub.state === 'failed' && !sub.retryable)) && <Button title="Dismiss" onPress={() => void queue.dismiss(sub.id)} />}
        </View>)}
      </>}
      {screen === 'route' && (expanded || watchStatus === 'denied' || watchStatus === 'unavailable') && <View>
        <Text accessibilityLiveRegion="polite" style={styles.caption}>{watchStatus === 'denied' ? 'Location permission is off' :
          watchStatus === 'unavailable' ? 'Live location unavailable' : watchStatus === 'paused' ? 'Live location paused' :
          currentPosition ? (following ? 'Following your location' : 'Live location · map free to explore') : position ? 'GPS signal lost · waiting for a fresh location…' : 'Waiting for an accurate GPS location…'}</Text>
        <Button icon="locate" title={currentPosition ? (following ? 'Stop following' : 'Recenter') : 'Retry live location'}
          onPress={() => { if (currentPosition && following) setFollowing(false); else void followLocation(); }} />
        {watchStatus === 'denied' && <Button title="Open location settings" onPress={() => void Linking.openSettings().catch(() => setError('Open device Settings to enable location permission.'))} />}
        <Text style={styles.caption}>Live while the app is open · route does not reroute automatically</Text>
      </View>}
      {screen === 'route' && <RouteScreen colors={ROUTE_COLORS} expanded={expanded} state={routeState} offlinePreview={fixtureMode}
        fields={tripFields}
        canSwap={trip.canSwap()} onCompare={() => void comparison.request()}
        onSwap={() => trip.swap()} onClear={() => { void trip.clear(); editEndpoint('destination'); }} />}
      {!!locationError && <Text accessibilityRole="alert" style={styles.error}>{locationError}</Text>}
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      {!!hazardError && <Text accessibilityRole="alert" style={styles.error}>{hazards.length ? 'Offline or stale: showing the last successful results. ' : ''}{hazardError}</Text>}
        </ScrollView>}

      </BottomSheet>
    </View>
    </KeyboardAvoidingView>
    </SafeAreaView>
  </View>;
}
const createStyles = (theme: Theme) => StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.canvas }, canvas: { flex: 1 }, safeControls: { flex: 1 },
  map: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  overlay: { flex: 1, paddingTop: 8 },
  header: { alignSelf: 'flex-end', marginRight: 12, gap: 8 },
  mapControl: { width: 48, height: 48, borderRadius: 16, backgroundColor: theme.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.line },
  destinationField: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48 },
  destinationInput: { flex: 1, minHeight: 48, fontFamily: theme.fontBody, fontSize: 18, color: theme.ink },
  notice: { fontFamily: theme.fontBody, padding: 8, marginHorizontal: 12, backgroundColor: theme.surface, color: theme.warning },
  space: { flex: 1 },
  dock: { backgroundColor: theme.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22,
    borderWidth: 1, borderColor: theme.line, paddingHorizontal: 14, paddingBottom: 4 },
  closeSearch: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  closeLabel: { fontFamily: theme.fontBody, fontSize: 15, color: theme.ink },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  sheetLabel: { fontFamily: theme.fontBody, fontSize: 13, color: theme.muted },
  categories: { flexDirection: 'row', gap: 6, marginVertical: 6 },
  category: { overflow: 'hidden', backgroundColor: theme.quiet, flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 64, paddingVertical: 8, borderWidth: 1, borderColor: theme.line, borderRadius: theme.radius },
  categorySelected: { backgroundColor: theme.selected, borderColor: theme.selectedEdge },
  categoryLabel: { fontFamily: theme.fontBody, fontSize: 11, color: theme.controlInk, textAlign: 'center' },
  categoryLabelSelected: { color: theme.inverse },
  content: { flexShrink: 1 }, contentInner: { paddingBottom: 8 },
  caption: { fontFamily: theme.fontLight, fontSize: 12, lineHeight: 18, color: theme.muted },
  source: { fontFamily: theme.fontBody, color: theme.ink, fontSize: 12 },
  card: { paddingVertical: 10, borderBottomWidth: 1, borderColor: theme.line },
  heading: { fontFamily: theme.fontBody, fontSize: 16, color: theme.ink, marginVertical: 4 },
  input: { fontFamily: theme.fontBody, color: theme.ink, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line, borderRadius: theme.radius,
    padding: 12, marginVertical: 8, minHeight: theme.touch },
  error: { fontFamily: theme.fontBody, color: theme.danger, marginVertical: 8 },
});
