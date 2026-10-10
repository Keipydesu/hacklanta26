import React from 'react';
import { View } from 'react-native';
import { useTheme } from './theme';

export type IconName = 'sun' | 'moon' | 'map' | 'route' | 'report' | 'pin' | 'expand' | 'collapse' | 'locate' | 'pothole' | 'obstruction' | 'closure' | 'other';

/** One native, dependency-free icon dialect. Labels belong to the containing control. */
export function Icon({ name, color: suppliedColor }: { name: IconName; color?: string }) {
  const theme = useTheme();
  const color = suppliedColor ?? theme.ink;
  const line = { position: 'absolute' as const, backgroundColor: color, borderRadius: 1 };
  const ring = { position: 'absolute' as const, borderColor: color, borderWidth: 2 };
  return <View accessible={false} importantForAccessibility="no-hide-descendants" style={{ width: 24, height: 24 }}>
    {name === 'sun' && <><View style={{ ...ring, width: 12, height: 12, borderRadius: 6, left: 6, top: 6 }} />{[0, 45, 90, 135].map(angle => <View key={angle} style={{ position: 'absolute', width: 24, height: 24, transform: [{ rotate: `${angle}deg` }] }}><View style={{ ...line, left: 11, top: 0, width: 2, height: 4 }} /><View style={{ ...line, left: 11, top: 20, width: 2, height: 4 }} /></View>)}</>}
    {name === 'moon' && <><View style={{ ...ring, width: 20, height: 20, borderRadius: 10, left: 2, top: 2 }} /><View style={{ position: 'absolute', width: 17, height: 17, borderRadius: 9, backgroundColor: theme.surface, left: 9, top: -1 }} /></>}
    {name === 'map' && <>{[3, 10, 17].map((left, i) => <View key={left} style={{ ...ring, left, top: i === 1 ? 3 : 6, width: 7, height: 15, transform: [{ skewY: i === 1 ? '-18deg' : '18deg' }] }} />)}</>}
    {(name === 'pin' || name === 'route') && <><View style={{ ...ring, width: 14, height: 14, borderRadius: 9, left: 5, top: 2 }} /><View style={{ ...line, width: 5, height: 5, borderRadius: 3, left: 9.5, top: 6.5 }} /><View style={{ ...line, width: 2, height: 8, left: 11, top: 14 }} /></>}
    {name === 'report' && <><View style={{ ...ring, width: 20, height: 20, borderRadius: 10, left: 2, top: 2 }} /><View style={{ ...line, width: 2, height: 8, left: 11, top: 6 }} /><View style={{ ...line, width: 2, height: 2, left: 11, top: 16 }} /></>}
    {(name === 'expand' || name === 'collapse') && <View style={{ ...ring, borderTopWidth: 0, borderLeftWidth: 0, width: 9, height: 9, left: 7, top: name === 'expand' ? 9 : 5, transform: [{ rotate: name === 'expand' ? '225deg' : '45deg' }] }} />}
    {name === 'locate' && <><View style={{ ...ring, width: 14, height: 14, borderRadius: 8, left: 5, top: 5 }} /><View style={{ ...line, width: 2, height: 24, left: 11 }} /><View style={{ ...line, width: 24, height: 2, top: 11 }} /><View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.surface, left: 9, top: 9 }} /></>}
    {name === 'pothole' && <><View style={{ ...ring, width: 22, height: 12, borderRadius: 10, top: 7, left: 1 }} /><View style={{ ...line, width: 10, height: 2, left: 7, top: 12 }} /></>}
    {(name === 'obstruction' || name === 'closure') && <><View style={{ ...ring, width: 20, height: 10, left: 2, top: 5 }} /><View style={{ ...line, width: 2, height: 6, top: 15, left: 5 }} /><View style={{ ...line, width: 2, height: 6, top: 15, left: 17 }} />{name === 'closure' && <View style={{ ...line, width: 17, height: 2, top: 9, left: 4, transform: [{ rotate: '-20deg' }] }} />}</>}
    {name === 'other' && <>{[3, 10, 17].map(left => <View key={left} style={{ ...line, width: 4, height: 4, borderRadius: 2, top: 10, left }} />)}</>}
  </View>;
}
