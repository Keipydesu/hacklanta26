import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ActionButton as Button } from '../ui/ActionButton';
import { useTheme, type Theme } from '../ui/theme';
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

/** Selected-hazard callout: source kicker in the hazard colour, capital title, mono facts. */
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
  const theme = useTheme();
  const styles = createStyles(theme);
  const { hazard } = props;
  return <View style={styles.panel} accessibilityLabel="Selected hazard">
    <View style={styles.header}>
      <View style={styles.titles}>
        <Text style={styles.source}>{hazard.source === 'manual' ? 'Community report' : `Automatically detected · ${hazard.evidence_source}`}</Text>
        <Text style={styles.heading}>{hazard.kind}</Text>
      </View>
      <Button title="Close" onPress={props.onClose} />
    </View>
    {hazard.label !== hazard.kind && <Text style={styles.body}>{hazard.label}</Text>}
    <Text style={styles.fact}>{props.available ? `Expires ${new Date(hazard.expires_at).toLocaleString()}` : 'No longer available for new answers.'}</Text>
    {props.availabilityError && <Text style={styles.fact}>{props.availabilityError}</Text>}
    {(props.available || props.state) && <FeedbackRow kind={hazard.kind} state={props.state} disabled={props.disabled || !props.available}
      onRespond={props.onRespond} onRetry={props.onRetry} />}
    {props.disabled && <Text style={styles.fine}>Connect to the product API to answer.</Text>}
  </View>;
}

const createStyles = (theme: Theme) => StyleSheet.create({
  panel: { padding: 12, marginBottom: 8, borderRadius: 12, borderWidth: 1, borderColor: theme.hazard, backgroundColor: theme.quiet, gap: 4 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  titles: { flex: 1 },
  source: { fontFamily: theme.fontMono, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color: theme.hazard },
  heading: { fontFamily: theme.fontDisplay, fontSize: 26, letterSpacing: 0.4, textTransform: 'uppercase', color: theme.ink, marginTop: 2 },
  body: { fontFamily: theme.fontBody, fontSize: 15, color: theme.ink },
  fact: { fontFamily: theme.fontMono, fontSize: 12, color: theme.muted },
  fine: { fontFamily: theme.fontLight, color: theme.muted, fontSize: 13 },
});
