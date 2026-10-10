import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { palette } from './theme';

const metal = require('../../assets/silver-texture.png');

/** Full-control tonal sweep plus a second grain layer at its native scale. */
export function SilverTexture() {
  return <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={styles.layer}>
    <Image source={metal} resizeMode="stretch" accessible={false} style={[styles.fill, styles.gradient]} />
    <Image source={metal} resizeMode="repeat" accessible={false} style={[styles.fill, styles.grain]} />
  </View>;
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: palette.white, overflow: 'hidden' },
  fill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, width: '100%', height: '100%' },
  gradient: { opacity: 0.32 },
  grain: { width: 417, height: 740, opacity: 0.22 },
});
