import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { Icon, IconName } from './Icon';
import { useTheme, type Theme } from './theme';

/** Shared control: amber primary, light pill when selected, raised panel otherwise. No runtime dependency. */
export function ActionButton({ title, onPress, disabled = false, primary = false, selected = false, icon }: {
  title: string;
  onPress(): void;
  disabled?: boolean;
  primary?: boolean;
  selected?: boolean;
  icon?: IconName;
}) {
  const theme = useTheme();
  const styles = createStyles(theme);
  const ink = primary ? theme.onPrimary : selected ? theme.onSelected : theme.controlInk;
  return <Pressable accessibilityRole="button" accessibilityLabel={title}
    accessibilityState={{ disabled, selected }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.button, primary && styles.primary,
      selected && styles.selected, disabled && styles.disabled, pressed && styles.pressed]}>
    {icon && <Icon name={icon} color={ink} />}
    <Text style={[styles.label, { color: ink }]}>{title}</Text>
  </Pressable>;
}

const createStyles = (theme: Theme) => StyleSheet.create({
  button: { overflow: 'hidden', minHeight: theme.touch, flexDirection: 'row', gap: 8, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 14,
    paddingVertical: 10, borderRadius: theme.radius, backgroundColor: theme.quiet, marginVertical: 4, flexShrink: 1, borderWidth: 1, borderColor: theme.line },
  primary: { backgroundColor: theme.primary, borderColor: theme.primaryEdge },
  selected: { backgroundColor: theme.selected, borderColor: theme.selectedEdge },
  label: { fontFamily: theme.fontLabel, fontSize: 17, letterSpacing: 0.6, textTransform: 'uppercase', textAlign: 'center' },
  disabled: { opacity: 0.5, borderStyle: 'dashed' },
  pressed: { opacity: 0.75 },
});
