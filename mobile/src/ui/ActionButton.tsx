import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { SilverTexture } from './SilverTexture';
import { Icon, IconName } from './Icon';
import { useTheme, type Theme } from './theme';

/** Shared concept control; uses native primitives and adds no runtime dependency. */
export function ActionButton({ title, onPress, disabled = false, busy = false, primary = false, selected = false, icon }: {
  title: string;
  onPress(): void;
  disabled?: boolean;
  busy?: boolean;
  primary?: boolean;
  selected?: boolean;
  icon?: IconName;
}) {
  const theme = useTheme();
  const styles = createStyles(theme);
  return <Pressable accessibilityRole="button" accessibilityLabel={title}
    accessibilityState={{ disabled: disabled || busy, selected, busy }} disabled={disabled || busy} onPress={onPress}
    style={({ pressed }) => [styles.button, primary && styles.primary,
      selected && styles.selected, disabled && styles.disabled, pressed && styles.pressed]}>
    {!primary && !selected && <SilverTexture />}
    {busy ? <ActivityIndicator accessible={false} size="small" color={primary || selected ? theme.inverse : theme.controlInk} />
      : icon && <Icon name={icon} color={primary || selected ? theme.inverse : theme.controlInk} />}
    <Text style={[styles.label, (primary || selected) && styles.primaryLabel]}>{title}</Text>
  </Pressable>;
}

const createStyles = (theme: Theme) => StyleSheet.create({
  button: { overflow: 'hidden', minHeight: theme.touch, flexDirection: 'row', gap: 8, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 12,
    paddingVertical: 10, borderRadius: theme.radius, backgroundColor: theme.quiet, marginVertical: 4, flexShrink: 1, borderWidth: 1, borderColor: theme.line },
  primary: { backgroundColor: theme.primary, borderColor: theme.primaryEdge },
  selected: { backgroundColor: theme.selected, borderColor: theme.selectedEdge },
  label: { fontFamily: theme.fontBody, color: theme.controlInk, fontSize: 14, textAlign: 'center', flexShrink: 1 },
  primaryLabel: { color: theme.inverse },
  disabled: { opacity: 0.6, borderStyle: 'dashed' },
  pressed: { opacity: 0.75 },
});
