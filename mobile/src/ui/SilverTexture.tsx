import React from 'react';
import { Image, StyleSheet, View } from 'react-native';

/** Operator-supplied metal grain, restrained over a silver base. Never intercepts input. */
export function SilverTexture() {
  return <View pointerEvents="none" style={styles.layer}><Image source={require('../../assets/silver-texture.png')} resizeMode="stretch"
    accessible={false} importantForAccessibility="no-hide-descendants"
    style={styles.texture} /></View>;
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  texture: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
    width: '100%', height: '100%', opacity: 0.22 },
});
