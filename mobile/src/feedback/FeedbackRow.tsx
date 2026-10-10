import React from 'react';
import { Button, StyleSheet, Text, View } from 'react-native';
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
  const canAnswer = !props.disabled && (!state || (state.status === 'failed' && !state.retryable));
  return <View style={styles.row}>
    <Text>{feedbackQuestion(props.kind)}</Text>
    {canAnswer && <View style={styles.buttons}>
      <Button title="Still there" onPress={() => props.onRespond('still_there')} />
      <Button title="No longer there" onPress={() => props.onRespond('gone')} />
    </View>}
    {state && <Text accessibilityLiveRegion="polite" style={state.status === 'failed' ? styles.error : undefined}>{STATUS[state.status](state)}</Text>}
    {state?.status === 'failed' && state.retryable && <Button title="Retry answer" onPress={props.onRetry} />}
  </View>;
}

const styles = StyleSheet.create({
  row: { marginTop: 6, gap: 4 },
  buttons: { flexDirection: 'row', gap: 8 },
  error: { color: '#a00020' },
});
