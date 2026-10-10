import React, { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, SafeAreaView, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import type { components } from './src/api/schema';
import eventFixture from './src/events.json';
import pointFixture from './src/points.json';
import { automationUrl, collectorUiTest, createCollector } from './src/platform';
import { testControls } from './src/testing/harness';
import type { Batch, QueueStats } from './src/queue/store';
import type { Mode, RideSnapshot } from './src/ride/controller';

const FIXTURE_RIDE = 'e50b27da-d972-430e-b5f8-9c6b20fd4151';
const fixtureEvents = eventFixture as components['schemas']['EventBatch'];
const fixturePoints = pointFixture as components['schemas']['PointBatch'];
const DRAIN_EVERY_MS = 5000;

export default function App() {
  const [ride, setRide] = useState<RideSnapshot | null>(null);
  const [stats, setStats] = useState<QueueStats | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [mode, setMode] = useState<Mode>('device');
  const [consent, setConsent] = useState(false);
  const [record, setRecord] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [testRequests, setTestRequests] = useState(0);
  const [testRequestLog, setTestRequestLog] = useState('[]');
  const [testOutcome, setTestOutcome] = useState('accept');
  const collector = useRef<ReturnType<typeof createCollector> | null>(null);
  if (!collector.current) {
    collector.current = createCollector({
      onRide: setRide,
      onQueue: next => { setStats(next); setBatches(collector.current?.queue.snapshot() ?? []); },
    });
  }
  const { controller, queue } = collector.current;

  useEffect(() => {
    // Earlier rides may have left trimmed batches behind; sending them never restarts sensing.
    // Test readiness must not wait on a deliberately unresolved stub response.
    const initial = collectorUiTest ? queue.load() : controller.resumeUploads();
    initial.catch(e => setNote(String(e))).then(() => {
      const error = queue.loadError(); if (error) setNote(error);
      setReady(true);
      if (collectorUiTest) void queue.drain();
    });
    const timer = setInterval(() => { void queue.drain(); }, DRAIN_EVERY_MS);
    const subscription = AppState.addEventListener('change', state => {
      // No background tracking: leaving the foreground ends the ride.
      if (state === 'background') void controller.onBackground();
      if (state === 'active') void queue.drain();
    });
    return () => { clearInterval(timer); subscription.remove(); void controller.stopRide(); };
  }, [controller, queue]);

  const phase = ride?.phase ?? 'idle';
  // Consent is per ride: once a ride ends (or never started), require a fresh opt-in.
  useEffect(() => { if (phase === 'idle') setConsent(false); }, [phase]);
  const collecting = phase === 'collecting';
  const busy = phase === 'starting' || phase === 'stopping';
  const liveMode = collecting ? ride?.mode ?? mode : mode;
  const demo = liveMode === 'demo';

  async function sendFixture() {
    if (!automationUrl || collectorUiTest) return;
    try {
      let last = '';
      for (const [path, body] of [['/v1/events', fixtureEvents], [`/v1/rides/${FIXTURE_RIDE}/points`, fixturePoints]] as const) {
        const response = await fetch(`${automationUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
        last = JSON.stringify(await response.json());
      }
      setNote(`Observation API reachable. Fixture receipt: ${last}`);
    } catch (e) { setNote(`Observation API not reachable: ${String(e)}`); }
  }

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.content}>
        {ready && <Text testID="collector.ready" style={styles.hint}>Collector ready</Text>}
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">Collector</Text>
          {demo && <Text testID="collector.demoBadge" style={styles.badge} accessibilityLabel="Demo mode. Evidence is simulated.">DEMO</Text>}
        </View>
        <Text style={styles.body}>
          Separate opt-in test app. It detects hard braking and bumps on this phone and uploads only the detected
          events and trimmed location points to the observation API. It cannot publish hazards.
        </Text>

        <Text style={styles.section}>Mode</Text>
        <View style={styles.row}>
          <Choice id="collector.deviceMode" label="Device ride" selected={mode === 'device'} disabled={collecting || busy} onPress={() => setMode('device')} />
          <Choice id="collector.demoMode" label="Indoor demo" selected={mode === 'demo'} disabled={collecting || busy} onPress={() => setMode('demo')} />
        </View>
        <Text style={styles.hint}>
          {mode === 'device'
            ? 'Uses motion at 50 Hz and GPS at 1 Hz while this screen stays open. The first and last 100 m of the ride are discarded before anything is saved for upload.'
            : 'Synthetic demonstration. Uses fixed campus coordinates, skips the speed checks and trimming, and labels everything as simulated. Shake the phone firmly for half a second to produce one event.'}
        </Text>

        <View style={styles.toggle}>
          <Text style={styles.toggleLabel}>I agree to collect {mode === 'device' ? 'motion and location' : 'motion'} for this ride</Text>
          <Switch testID="collector.consent" value={consent} onValueChange={setConsent} disabled={collecting || busy} accessibilityLabel="Agree to collect for this ride" />
        </View>
        <View style={styles.toggle}>
          <Text style={styles.toggleLabel}>Also record raw sensors on this phone (diagnostic, never uploaded)</Text>
          <Switch testID="collector.record" value={record} onValueChange={setRecord} disabled={collecting || busy} accessibilityLabel="Record raw sensors locally" />
        </View>

        {collecting
          ? <Action id="collector.stop" label="Stop ride" tone="stop" onPress={() => void controller.stopRide()} />
          : <Action id="collector.start" label={busy ? 'Working…' : mode === 'demo' ? 'Start indoor demo' : 'Start ride'} disabled={busy || !consent}
              onPress={() => void controller.startRide({ mode, consent, record })} />}
        {!consent && !collecting && <Text style={styles.hint}>Turn on the agreement switch to start.</Text>}

        <Text style={styles.section}>Ride</Text>
        <Text testID="collector.status" style={styles.status} accessibilityLiveRegion="polite">
          {collecting ? `Collecting · ${demo ? 'simulated demo' : 'device'}${ride?.recording ? ' · recording locally' : ''}` : phase === 'idle' ? 'Not collecting' : phase}
        </Text>
        {ride?.message && <Text testID="collector.message" style={styles.message}>{ride.message}</Text>}
        {ride && (ride.motionSamples > 0 || collecting) && (
          <View style={styles.grid}>
            <Stat label="Motion rate" value={ride.motionHz === null ? '—' : `${ride.motionHz} Hz`} />
            <Stat label="GPS fixes" value={String(ride.fixes)} />
            {!demo && <Stat label="Distance" value={`${Math.round(ride.travelledM)} m`} />}
            <Stat id="collector.detected" label="Detected" value={String(ride.detected)} />
            <Stat label="Saved for upload" value={`${ride.queuedEvents} events · ${ride.queuedPoints} points`} />
            {!demo && <Stat label="Held (not yet 100 m past)" value={`${ride.heldEvents} events · ${ride.heldPoints} points`} />}
            {!demo && <Stat label="Trimmed for privacy" value={`${ride.trimmedEvents} events · ${ride.trimmedPoints} points`} />}
          </View>
        )}

        <Text style={styles.section}>Uploads</Text>
        {!automationUrl && <Text style={styles.message}>Set EXPO_PUBLIC_AUTOMATION_API_URL to upload. Until then observations stay queued on this phone.</Text>}
        <View style={styles.grid}>
          <Stat label="Waiting" value={`${stats?.pendingObservations ?? 0} observations in ${stats?.batches ?? 0} batches`} />
          <Stat label="Acknowledged" value={`${stats?.accepted ?? 0} accepted · ${stats?.duplicates ?? 0} duplicates`} />
        </View>
        {stats?.full && <Text style={styles.message}>The upload queue is full. Collection is paused until pending observations are delivered.</Text>}
        {batches.filter(b => b.state === 'failed').map(b => (
          <View key={b.id} style={styles.failed}>
            <Text style={styles.body}>
              {b.count} {b.kind} {b.retryable ? 'not delivered yet' : 'rejected by the server'}: {b.error}
            </Text>
            {b.retryable
              ? <Action label="Retry the same batch" onPress={() => void queue.retry(b.id)} />
              : <Action label="Discard rejected batch" tone="stop" onPress={() => void queue.discardRejected(b.id)} />}
          </View>
        ))}
        {!collectorUiTest && <Action label="Send fixture batch (connectivity check)" tone="quiet" disabled={!automationUrl} onPress={() => void sendFixture()} />}
        {collectorUiTest && <View style={styles.grid}>
          <Text testID="collector.testMode" style={styles.section}>ISOLATED UI TEST BUILD — SIMULATED</Text>
          <Action id="test.reset" label="Reset isolated test storage" onPress={() => void testControls.reset().then(() => queue.load()).then(() => { setTestOutcome('reset'); setTestRequests(0); setTestRequestLog('[]'); })} />
          <Action id="test.motionDenied" label="Mock motion denied" onPress={() => testControls.setMotionAllowed(false)} />
          <Action id="test.locationDenied" label="Mock location denied" onPress={() => testControls.setLocationAllowed(false)} />
          <Action id="test.noSensor" label="Mock sensor unavailable" onPress={() => testControls.setSensorAvailable(false)} />
          <Action id="test.demoJerk" label="Inject demo jerk" onPress={() => { testControls.demoJerk(); void controller.flush().then(() => queue.drain()); }} />
          <Action id="test.accept" label="Stub accepts" onPress={() => void testControls.setOutcome('accept').then(() => setTestOutcome('accept'))} />
          <Action id="test.unknown" label="Stub unknown outcome" onPress={() => void testControls.setOutcome('unknown').then(() => setTestOutcome('unknown'))} />
          <Action id="test.conflict" label="Stub 409" onPress={() => void testControls.setOutcome('409').then(() => setTestOutcome('409'))} />
          <Action id="test.invalid" label="Stub 422" onPress={() => void testControls.setOutcome('422').then(() => setTestOutcome('422'))} />
          <Action id="test.refresh" label="Refresh stub requests" onPress={() => void testControls.requests().then(requests => { setTestRequests(requests.length); setTestRequestLog(JSON.stringify(requests)); })} />
          <Text testID="test.outcome" style={styles.body}>Stub outcome: {testOutcome}</Text>
          <Text testID="test.requestCount" style={styles.body}>Stub requests: {testRequests}</Text>
          <Text testID="test.requestLog" style={styles.hint}>{testRequestLog}</Text>
        </View>}
        {note && <Text style={styles.hint}>{note}</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}

function Choice(props: { id?: string; label: string; selected: boolean; disabled?: boolean; onPress(): void }) {
  return (
    <Pressable testID={props.id} onPress={props.onPress} disabled={props.disabled} accessibilityRole="radio" accessibilityState={{ selected: props.selected, disabled: props.disabled }}
      style={[styles.choice, props.selected && styles.choiceSelected, props.disabled && styles.disabled]}>
      <Text style={[styles.choiceText, props.selected && styles.choiceTextSelected]}>{props.label}</Text>
    </Pressable>
  );
}

function Action(props: { id?: string; label: string; tone?: 'go' | 'stop' | 'quiet'; disabled?: boolean; onPress(): void }) {
  const tone = props.tone ?? 'go';
  return (
    <Pressable testID={props.id} onPress={props.onPress} disabled={props.disabled} accessibilityRole="button" accessibilityState={{ disabled: props.disabled }}
      style={[styles.action, tone === 'stop' && styles.actionStop, tone === 'quiet' && styles.actionQuiet, props.disabled && styles.disabled]}>
      <Text style={[styles.actionText, tone === 'quiet' && styles.actionTextQuiet]}>{props.label}</Text>
    </Pressable>
  );
}

function Stat(props: { id?: string; label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{props.label}</Text>
      <Text testID={props.id} style={styles.statValue}>{props.value}</Text>
    </View>
  );
}

const ink = '#1c1b18', muted = '#5c5a52', line = '#d9d6cb', accent = '#0b5d4b', warn = '#9a3412';
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f5f4ef' },
  content: { padding: 20, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { fontSize: 26, fontWeight: '700', color: ink },
  badge: { backgroundColor: warn, color: '#fff', fontWeight: '800', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, overflow: 'hidden', letterSpacing: 1 },
  body: { fontSize: 15, lineHeight: 21, color: ink },
  hint: { fontSize: 13, lineHeight: 19, color: muted },
  section: { fontSize: 13, fontWeight: '700', color: muted, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 10 },
  row: { flexDirection: 'row', gap: 10 },
  choice: { flex: 1, minHeight: 48, borderWidth: 1.5, borderColor: line, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  choiceSelected: { borderColor: accent, backgroundColor: '#e3f1ec' },
  choiceText: { fontSize: 15, color: ink },
  choiceTextSelected: { fontWeight: '700', color: accent },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  toggleLabel: { flex: 1, fontSize: 15, lineHeight: 20, color: ink },
  action: { minHeight: 50, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: accent, paddingHorizontal: 16 },
  actionStop: { backgroundColor: warn },
  actionQuiet: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: line },
  actionText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  actionTextQuiet: { color: ink, fontWeight: '600' },
  disabled: { opacity: 0.45 },
  status: { fontSize: 17, fontWeight: '600', color: ink },
  message: { fontSize: 14, lineHeight: 20, color: warn },
  grid: { borderWidth: 1, borderColor: line, borderRadius: 10, backgroundColor: '#fff' },
  stat: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: line },
  statLabel: { fontSize: 14, color: muted, flexShrink: 1 },
  statValue: { fontSize: 14, color: ink, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  failed: { gap: 8, padding: 12, borderWidth: 1, borderColor: warn, borderRadius: 10 },
});
