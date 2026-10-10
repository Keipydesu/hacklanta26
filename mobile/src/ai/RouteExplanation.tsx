import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { ActionButton as Button } from '../ui/ActionButton';
import { useTheme } from '../ui/theme';
import { explainRoute, type RouteResponse } from '../api/client';
import { createLatest } from './latest';

export function RouteExplanation({ response, outdated, disabled }: {
  response: RouteResponse; outdated: boolean; disabled: boolean;
}) {
  const theme = useTheme();
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [latest] = useState(() => createLatest<string>(setText,
    () => setError('Explanation unavailable. The route comparison still works.'), setBusy));
  useEffect(() => {
    latest.clear(); setText(''); setError('');
    return () => latest.clear();
  }, [response, outdated, disabled]);
  return <View>
    <Button title={busy ? 'Explaining…' : 'Explain route choice'} disabled={disabled || outdated || busy}
      onPress={() => { setText(''); setError(''); void latest.run(() => explainRoute({
        safest_available: response.safest_available,
        routes: response.routes.map(r => ({ kind: r.kind, duration_s: r.duration_s,
          distance_m: r.distance_m, hazard_count: new Set(r.hazard_ids).size })),
      })); }} />
    {!!text && !outdated && <Text style={{ color: theme.ink, fontFamily: theme.fontBody, fontSize: 12, lineHeight: 18, marginVertical: 6 }}>{text}</Text>}
    {!!error && <Text accessibilityRole="alert" style={{ color: theme.danger, fontSize: 12 }}>{error}</Text>}
  </View>;
}
