import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, PanResponder, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { sheetSnap } from './sheetSnap';
import { useTheme } from './theme';

/** Slide a fixed surface; never relayout the sheet and WebView on each animation frame. */
export function BottomSheet({ open, closedHeight, openHeight, frameHeight, onSnap, onHeight, style, header, children }: {
  open: boolean; closedHeight: number; openHeight: number; frameHeight: number;
  onSnap(open: boolean): void; onHeight(height: number): void;
  style?: StyleProp<ViewStyle>; header?: React.ReactNode; children: React.ReactNode;
}) {
  const theme = useTheme();
  const translateY = useRef(new Animated.Value(-closedHeight)).current;
  const current = useRef(closedHeight);
  const start = useRef(closedHeight);
  const target = useRef<number | null>(null);
  const [viewportHeight, setViewportHeight] = useState(closedHeight);
  const [headerHeight, setHeaderHeight] = useState(28);
  const latest = useRef({ open, closedHeight, openHeight, onSnap, onHeight });
  latest.current = { open, closedHeight, openHeight, onSnap, onHeight };
  const animate = useCallback((next: number, velocity = 0) => {
    if (target.current === next) return;
    target.current = next;
    setViewportHeight(next);
    // Reveal map space before sliding down so a previously smaller map leaves no gap.
    if (next < current.current) latest.current.onHeight(next);
    Animated.spring(translateY, {
      toValue: -next, stiffness: 280, damping: 30, mass: 1, velocity,
      overshootClamping: true, useNativeDriver: true,
    }).start(({ finished }) => {
      // One map resize after settling, rather than a WebView resize on every frame.
      if (finished) latest.current.onHeight(next);
    });
  }, [translateY]);
  useEffect(() => {
    const id = translateY.addListener(({ value }) => { current.current = -value; });
    return () => { translateY.removeListener(id); translateY.stopAnimation(); };
  }, [translateY]);
  useEffect(() => { animate(open ? openHeight : closedHeight); }, [open, openHeight, closedHeight, animate]);
  const responder = useRef(PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_, g) => Math.abs(g.dy) > 5 && Math.abs(g.dy) > Math.abs(g.dx),
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 5 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderGrant: () => {
      target.current = null;
      latest.current.onHeight(latest.current.closedHeight);
      start.current = current.current;
      translateY.stopAnimation(value => { start.current = -value; });
    },
    onPanResponderMove: (_, g) => {
      const p = latest.current;
      current.current = Math.max(p.closedHeight, Math.min(p.openHeight, start.current - g.dy));
      translateY.setValue(-current.current);
    },
    onPanResponderRelease: (_, g) => {
      const p = latest.current;
      const next = sheetSnap(current.current, g.vy, p.closedHeight, p.openHeight) === 'open';
      animate(next ? p.openHeight : p.closedHeight, g.vy * 1000);
      p.onSnap(next);
    },
    onPanResponderTerminate: () => {
      const p = latest.current;
      animate(p.open ? p.openHeight : p.closedHeight);
    },
  })).current;
  return <Animated.View style={[style, styles.surface, { height: frameHeight, bottom: -frameHeight, transform: [{ translateY }] }]}>
    <View {...responder.panHandlers} onLayout={event => setHeaderHeight(event.nativeEvent.layout.height)}>
      <View {...responder.panHandlers} onStartShouldSetResponder={() => true} accessible accessibilityRole="adjustable" accessibilityLabel="Panel size"
        accessibilityValue={{ text: open ? 'Expanded' : 'Collapsed' }}
        accessibilityActions={[{ name: 'increment', label: 'Expand panel' }, { name: 'decrement', label: 'Collapse panel' }]}
        onAccessibilityAction={event => latest.current.onSnap(event.nativeEvent.actionName === 'increment')}
        style={styles.handleTarget}>
        <View style={[styles.handle, { backgroundColor: theme.muted }]} />
      </View>
      {header}
    </View>
    <View style={{ height: Math.max(0, viewportHeight - headerHeight - 6) }}>{children}</View>
  </Animated.View>;
}
const styles = StyleSheet.create({
  surface: { position: 'absolute', left: 0, right: 0 },
  handleTarget: { height: 28, alignItems: 'center', justifyContent: 'center' },
  handle: { width: 40, height: 5, borderRadius: 3, opacity: 0.45 },
});
