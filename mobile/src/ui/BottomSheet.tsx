import React, { useEffect, useRef } from 'react';
import { Animated, PanResponder, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { sheetSnap } from './sheetSnap';
import { useTheme } from './theme';

/** Two magnetic detents. The handle owns gestures; inner lists retain native scrolling. */
export function BottomSheet({ open, closedHeight, openHeight, onSnap, onHeight, style, header, children }: {
  open: boolean; closedHeight: number; openHeight: number;
  onSnap(open: boolean): void; onHeight(height: number): void;
  style?: StyleProp<ViewStyle>; header?: React.ReactNode; children: React.ReactNode;
}) {
  const theme = useTheme();
  const height = useRef(new Animated.Value(closedHeight)).current;
  const current = useRef(closedHeight);
  const start = useRef(closedHeight);
  const latest = useRef({ open, closedHeight, openHeight, onSnap });
  latest.current = { open, closedHeight, openHeight, onSnap };
  const animate = (target: number, velocity = 0) => Animated.spring(height, {
    toValue: target, stiffness: 280, damping: 30, mass: 1, velocity,
    overshootClamping: true, useNativeDriver: false,
  }).start();
  useEffect(() => {
    const id = height.addListener(({ value }) => { current.current = value; });
    return () => { height.removeListener(id); height.stopAnimation(); };
  }, [height]);
  useEffect(() => { animate(open ? openHeight : closedHeight); }, [open, openHeight, closedHeight]);
  const responder = useRef(PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_, g) => Math.abs(g.dy) > 5 && Math.abs(g.dy) > Math.abs(g.dx),
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 5 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderGrant: () => { height.stopAnimation(); start.current = current.current; },
    onPanResponderMove: (_, g) => {
      const p = latest.current;
      current.current = Math.max(p.closedHeight, Math.min(p.openHeight, start.current - g.dy));
      height.setValue(current.current);
    },
    onPanResponderRelease: (_, g) => {
      const p = latest.current;
      const next = sheetSnap(current.current, g.vy, p.closedHeight, p.openHeight) === 'open';
      p.onSnap(next);
      animate(next ? p.openHeight : p.closedHeight, -g.vy * 1000);
    },
    onPanResponderTerminate: () => {
      const p = latest.current;
      animate(p.open ? p.openHeight : p.closedHeight);
    },
  })).current;
  return <Animated.View style={[style, { height }]} onLayout={event => onHeight(event.nativeEvent.layout.height)}>
    <View {...responder.panHandlers}>
      <View {...responder.panHandlers} onStartShouldSetResponder={() => true} accessible accessibilityRole="adjustable" accessibilityLabel="Panel size"
        accessibilityValue={{ text: open ? 'Expanded' : 'Collapsed' }}
        accessibilityActions={[{ name: 'increment', label: 'Expand panel' }, { name: 'decrement', label: 'Collapse panel' }]}
        onAccessibilityAction={event => latest.current.onSnap(event.nativeEvent.actionName === 'increment')}
        style={styles.handleTarget}>
        <View style={[styles.handle, { backgroundColor: theme.muted }]} />
      </View>
      {header}
    </View>
    {children}
  </Animated.View>;
}
const styles = StyleSheet.create({
  handleTarget: { height: 28, alignItems: 'center', justifyContent: 'center' },
  handle: { width: 40, height: 5, borderRadius: 3, opacity: 0.45 },
});
