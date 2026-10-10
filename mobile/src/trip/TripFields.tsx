import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ActionButton as Button } from '../ui/ActionButton';
import { Icon } from '../ui/Icon';
import { useTheme, type Theme } from '../ui/theme';
import type { PlaceResult, SearchState } from './placeSearch';
import { endpointLabel, type Endpoint, type TripState, type Which } from './trip';

const FIELD = { origin: 'From', destination: 'To' } as const;

function shown(endpoint: Endpoint, which: Which): string {
  if (endpoint.kind === 'current' && endpoint.status === 'locating') return 'Current location · locating';
  if (endpoint.kind === 'current' && (endpoint.status === 'denied' || endpoint.status === 'unavailable')) return 'Current location unavailable';
  return endpointLabel(endpoint) || (which === 'destination' ? 'Where to?' : 'Choose a start');
}

export function TripFields(props: {
  trip: TripState;
  editing: Which | null;
  picking: Which | null;
  search: SearchState;
  onEdit(which: Which): void;
  onType(text: string): void;
  onChoose(place: PlaceResult): void;
  onCancel(): void;
  onRetrySearch(): void;
  onUseCurrent(): void;
  onRetryLocation(): void;
  onPickOnMap(which: Which): void;
}) {
  const theme = useTheme();
  const styles = createStyles(theme);
  const { trip, editing, search } = props;
  const origin = trip.origin;
  const locationProblem = origin.kind === 'current' && (origin.status === 'denied' || origin.status === 'unavailable') ? origin.status : null;

  const field = (which: Which) => editing === which
    ? <View key={which}>
      <Text style={styles.fieldName}>{FIELD[which]}</Text>
      <TextInput autoFocus accessibilityLabel={`${FIELD[which]}: search for a place or address`} style={styles.input}
        value={search.query} onChangeText={props.onType} placeholder="Search for a place or address" placeholderTextColor={theme.muted}
        returnKeyType="search" onSubmitEditing={props.onRetrySearch} autoCorrect={false} />
      {search.status === 'loading' && <Text style={styles.status}>Searching…</Text>}
      {search.status === 'empty' && <Text style={styles.status}>No matches</Text>}
      {search.status === 'failed' && <View style={styles.row}>
        <Text accessibilityRole="alert" style={styles.error}>Search failed. {search.error}</Text>
        <Button title="Retry search" onPress={props.onRetrySearch} />
      </View>}
      {search.places.map(place => <Pressable key={place.id} accessibilityRole="button" accessibilityLabel={`${place.name}, ${place.address}`}
        onPress={() => props.onChoose(place)} style={({ pressed }) => [styles.result, pressed && styles.pressed]}>
        <Text style={styles.resultName}>{place.name}</Text>
        {!!place.address && <Text style={styles.resultAddress}>{place.address}</Text>}
      </Pressable>)}
      {search.places.length > 0 && <Text style={styles.credit}>Search: Photon · © OpenStreetMap contributors</Text>}
      <View style={styles.row}>
        {which === 'origin' && <Button icon="locate" title="Current location" onPress={props.onUseCurrent} />}
        <Button icon="pin" title="Choose on map" onPress={() => props.onPickOnMap(which)} />
        <Button title="Cancel" onPress={props.onCancel} />
      </View>
    </View>
    : <Pressable key={which} accessibilityRole="button" accessibilityLabel={`${FIELD[which]}: ${shown(trip[which], which)}. Edit`}
      onPress={() => props.onEdit(which)} style={({ pressed }) => [styles.field, props.picking === which && styles.picking, pressed && styles.pressed]}>
      <Icon name={trip[which].kind === 'current' ? 'locate' : 'pin'} color={theme.controlInk} />
      <View style={styles.fieldText}>
        <Text style={styles.fieldName}>{FIELD[which]}</Text>
        <Text numberOfLines={1} style={[styles.value, trip[which].kind === 'none' && styles.placeholder]}>
          {props.picking === which ? 'Tap the map' : shown(trip[which], which)}
        </Text>
      </View>
    </Pressable>;

  return <View>
    {field('origin')}
    {locationProblem && editing !== 'origin' && <View style={styles.row}>
      <Text accessibilityRole="alert" style={styles.error}>
        {locationProblem === 'denied' ? 'Location permission is off.' : 'Could not get your location.'}
      </Text>
      <Button icon="locate" title="Try again" onPress={props.onRetryLocation} />
      <Button title="Search for a start" onPress={() => props.onEdit('origin')} />
    </View>}
    {field('destination')}
  </View>;
}

const createStyles = (theme: Theme) => StyleSheet.create({
  field: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: theme.touch, paddingHorizontal: 12, paddingVertical: 6,
    marginVertical: 4, borderRadius: theme.radius, borderWidth: 1, borderColor: theme.line, backgroundColor: theme.surface },
  picking: { borderColor: theme.selectedEdge, borderWidth: 2 },
  pressed: { opacity: 0.7 },
  fieldText: { flex: 1 },
  fieldName: { fontFamily: theme.fontLight, fontSize: 12, color: theme.muted },
  value: { fontFamily: theme.fontBody, fontSize: 16, color: theme.ink },
  placeholder: { color: theme.muted },
  input: { fontFamily: theme.fontBody, color: theme.ink, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.selectedEdge,
    borderRadius: theme.radius, padding: 12, marginVertical: 6, minHeight: theme.touch },
  status: { fontFamily: theme.fontLight, fontSize: 13, color: theme.muted, marginVertical: 4 },
  error: { fontFamily: theme.fontBody, color: theme.danger, flexShrink: 1 },
  result: { paddingVertical: 10, paddingHorizontal: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.quiet },
  resultName: { fontFamily: theme.fontBody, fontSize: 15, color: theme.ink },
  resultAddress: { fontFamily: theme.fontLight, fontSize: 13, color: theme.muted },
  credit: { fontFamily: theme.fontLight, fontSize: 11, color: theme.muted, marginTop: 4 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginVertical: 4 },
});
