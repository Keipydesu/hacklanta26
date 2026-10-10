import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { Icon, IconName } from './Icon';
import { theme } from './theme';

/** Shared concept control; uses native primitives and adds no runtime dependency. */
export function ActionButton({ title, onPress, disabled = false, primary = false, selected = false, icon }: {
  title: string;
  onPress(): void;
  disabled?: boolean;
  primary?: boolean;
  selected?: boolean;
  icon?: IconName;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={title}
    accessibilityState={{ disabled, selected }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.button, primary && styles.primary,
      selected && styles.selected, disabled && styles.disabled, pressed && styles.pressed]}>
    {icon && <Icon name={icon} color={primary ? theme.inverse : theme.ink} />}
    <Text style={[styles.label, primary && styles.primaryLabel]}>{title}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  button: { minHeight: theme.touch, flexDirection: 'row', gap: 8, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 12,
    paddingVertical: 10, borderRadius: theme.radius, backgroundColor: theme.quiet, marginVertical: 4, flexShrink: 1, borderWidth: 1, borderColor: theme.line },
  primary: { backgroundColor: theme.primary, borderColor: theme.primary },
  selected: { backgroundColor: theme.selected, borderColor: theme.selectedEdge },
  label: { color: theme.ink, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  primaryLabel: { color: theme.inverse },
  disabled: { opacity: 0.6, borderStyle: 'dashed' },
  pressed: { opacity: 0.75 },
});
