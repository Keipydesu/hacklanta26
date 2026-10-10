import React, { useState } from 'react';
import { SafeAreaView, Text, Button, StyleSheet } from 'react-native';
import type { components } from './src/api/schema';
import eventFixture from './src/events.json';
import pointFixture from './src/points.json';
const url = process.env.EXPO_PUBLIC_AUTOMATION_API_URL?.replace(/\/$/, '');
const ride = 'e50b27da-d972-430e-b5f8-9c6b20fd4151';
// Fixed bodies intentionally preserved across retries. These historical fixtures remain valid.
const events = eventFixture as components['schemas']['EventBatch'];
const points = pointFixture as components['schemas']['PointBatch'];
export default function App() {
  const [result, setResult] = useState('Ready');
  async function send() {
    try {
      for (const [path, body] of [['/v1/events', events], [`/v1/rides/${ride}/points`, points]] as const) {
        const response = await fetch(`${url}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
        setResult(JSON.stringify(await response.json()));
      }
    } catch (e) { setResult(String(e)); }
  }
  return <SafeAreaView style={styles.page}>
    <Text style={styles.title}>Collector · DEMO STUB</Text>
    <Text>No sensors or recording. Sends only simulated, already-trimmed GSU fixture observations to the separate observation API.</Text>
    <Text>Repeated sends preserve UUIDs and payloads. No offline queue or automatic publication is implemented.</Text>
    <Button title="Send simulated fixture batches" disabled={!url} onPress={() => void send()} />
    {!url && <Text>Set EXPO_PUBLIC_AUTOMATION_API_URL to enable sending.</Text>}
    <Text>{result}</Text>
  </SafeAreaView>;
}
const styles = StyleSheet.create({page:{flex:1,padding:24,gap:18,backgroundColor:'#f5f4ef'},title:{fontSize:24,fontWeight:'bold'}});
