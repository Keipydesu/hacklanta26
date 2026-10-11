import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ActionButton as Button } from '../ui/ActionButton';
import { useTheme, type Theme } from '../ui/theme';
import { hazardKindLabel, hazardSourceLabel, hazardTitle } from '../reports/categories';
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
  const styles = createStyles(useTheme());
  const category = hazardKindLabel(hazard.kind);
  const title = hazardTitle(hazard);
  return <View style={styles.panel} accessibilityLabel="Selected hazard">
    <View style={styles.header}>
      <Text style={styles.source}>{hazardSourceLabel(hazard)}</Text>
      <Button title="Close" onPress={props.onClose} />
    </View>
    <Text style={styles.heading}>{title}</Text>
    {category !== title && <Text style={styles.fine}>{category}</Text>}
    <Text style={styles.fine}>{props.available ? `Expires ${new Date(hazard.expires_at).toLocaleString()}` : 'No longer available for new answers.'}</Text>
    {props.availabilityError && <Text accessibilityRole="alert" style={styles.error}>{props.availabilityError}</Text>}
    {(props.available || props.state) && <FeedbackRow kind={hazard.kind} state={props.state} disabled={props.disabled || !props.available}
      onRespond={props.onRespond} onRetry={props.onRetry} />}
    {props.disabled && <Text style={styles.fine}>Connect to the product API to answer.</Text>}
  </View>;
}

const createStyles = (theme: Theme) => StyleSheet.create({
  panel: { padding: 12, marginBottom: 8, borderRadius: theme.radius, borderLeftWidth: 3, borderLeftColor: theme.selectedEdge,
    backgroundColor: theme.surface, gap: 4 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  source: { fontFamily: theme.fontLight, color: theme.muted, fontSize: 12, flexShrink: 1 },
  heading: { fontFamily: theme.fontBody, color: theme.ink, fontSize: 17 },
  fine: { fontFamily: theme.fontLight, color: theme.muted, fontSize: 13 },
  error: { fontFamily: theme.fontBody, color: theme.danger, fontSize: 13 },
});
