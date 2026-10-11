import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ActionButton as Button } from '../ui/ActionButton';
import { useTheme, type Theme } from '../ui/theme';
import { feedbackQuestion, type FeedbackResponse, type FeedbackState } from './feedback';

const STATUS: Record<FeedbackState['status'], (s: FeedbackState) => string> = {
  sending: s => `Sending "${s.body.response === 'gone' ? 'No longer there' : 'Still there'}"… not yet received`,
  accepted: s => `Thanks. "${s.body.response === 'gone' ? 'No longer there' : 'Still there'}" was received.`,
  failed: s => `Not sent: ${s.error}`,
};

export function FeedbackRow(props: {
  kind: string;
  state?: FeedbackState;
  disabled?: boolean;
  onRespond(response: FeedbackResponse): void;
  onRetry(): void;
}) {
  const { state } = props;
  const styles = createStyles(useTheme());
  const canAnswer = !props.disabled && (!state || (state.status === 'failed' && !state.retryable));
  return <View style={styles.row}>
    <Text style={styles.question}>{feedbackQuestion(props.kind)}</Text>
    {canAnswer && <View style={styles.buttons}>
      <Button title="Still there" onPress={() => props.onRespond('still_there')} />
      <Button title="No longer there" onPress={() => props.onRespond('gone')} />
    </View>}
    {state && <Text accessibilityLiveRegion="polite" style={state.status === 'failed' ? styles.error : styles.status}>{STATUS[state.status](state)}</Text>}
    {state?.status === 'failed' && state.retryable && <Button title="Retry answer" onPress={props.onRetry} />}
  </View>;
}

const createStyles = (theme: Theme) => StyleSheet.create({
  row: { marginTop: 6, gap: 4 },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  question: { fontFamily: theme.fontBody, color: theme.ink, fontSize: 14 },
  status: { fontFamily: theme.fontLight, color: theme.muted, fontSize: 13 },
  error: { fontFamily: theme.fontBody, color: theme.danger, fontSize: 13 },
});
