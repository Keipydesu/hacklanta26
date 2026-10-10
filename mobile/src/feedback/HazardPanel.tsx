import React from 'react';
import { Button, StyleSheet, Text, View } from 'react-native';
import { FeedbackRow } from './FeedbackRow';
import type { FeedbackResponse, FeedbackState } from './feedback';

export type PanelHazard = {
  id: string;
  kind: string;
  source: 'manual' | 'automatic';
  evidence_source?: string | null;
  label: string;
  expires_at: string;
};

export function HazardPanel(props: {
  hazard: PanelHazard;
  available: boolean;
  availabilityError?: string;
  state?: FeedbackState;
  disabled?: boolean;
  onRespond(response: FeedbackResponse): void;
  onRetry(): void;
  onClose(): void;
}) {
  const { hazard } = props;
  return <View style={styles.panel} accessibilityLabel="Selected hazard">
    <View style={styles.header}>
      <Text style={styles.heading}>{hazard.source === 'manual' ? 'Community report' : `Automatically detected · ${hazard.evidence_source}`}</Text>
      <Button title="Close" onPress={props.onClose} />
    </View>
    <Text>{hazard.kind} · {hazard.label}</Text>
    <Text>{props.available ? `Expires ${new Date(hazard.expires_at).toLocaleString()}` : 'No longer available for new answers.'}</Text>
    {props.availabilityError && <Text>{props.availabilityError}</Text>}
    {(props.available || props.state) && <FeedbackRow kind={hazard.kind} state={props.state} disabled={props.disabled || !props.available}
      onRespond={props.onRespond} onRetry={props.onRetry} />}
    {props.disabled && <Text style={styles.fine}>Connect to the product API to answer.</Text>}
  </View>;
}

const styles = StyleSheet.create({
  panel: { padding: 12, marginBottom: 8, borderRadius: 8, borderWidth: 1, borderColor: '#c9c3b3', backgroundColor: '#fffdf7', gap: 4 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heading: { fontSize: 17, fontWeight: '600', flexShrink: 1 },
  fine: { color: '#555', fontSize: 13 },
});
