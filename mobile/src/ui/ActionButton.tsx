import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

/** Shared concept control; uses native primitives and adds no runtime dependency. */
export function ActionButton({ title, onPress, disabled = false, primary = false, selected = false }: {
  title: string;
  onPress(): void;
  disabled?: boolean;
  primary?: boolean;
  selected?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={title}
    accessibilityState={{ disabled, selected }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.button, primary && styles.primary,
      selected && styles.selected, disabled && styles.disabled, pressed && styles.pressed]}>
    <Text style={[styles.label, primary && styles.primaryLabel]}>{title}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  button: { minHeight: 48, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 16,
    paddingVertical: 12, borderRadius: 16, backgroundColor: '#edf0e9', marginVertical: 4, flexShrink: 1 },
  primary: { backgroundColor: '#173f35' },
  selected: { backgroundColor: '#d8efac', borderWidth: 1, borderColor: '#476328' },
  label: { color: '#173f35', fontSize: 15, fontWeight: '600', textAlign: 'center' },
  primaryLabel: { color: '#fff' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.75 },
});
