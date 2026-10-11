import React, { useEffect, useRef, useState } from 'react';
import { Image, Linking, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ActionButton as Button } from '../ui/ActionButton';
import { useTheme } from '../ui/theme';
import { analyzePhoto, type PhotoAnalysis } from '../api/client';
import { categoryLabel } from '../reports/categories';
import { createLatest } from './latest';

const MAX_BASE64 = 4 * 1024 * 1024;
export function PhotoReport({ disabled, onApply }: {
  disabled: boolean; onApply(result: PhotoAnalysis): void;
}) {
  const theme = useTheme();
  const [photo, setPhoto] = useState<{ uri: string; base64: string } | null>(null);
  const [result, setResult] = useState<PhotoAnalysis | null>(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  const pickerBusy = useRef(false);
  const [latest] = useState(() => createLatest<PhotoAnalysis>(setResult,
    () => setError('Photo analysis is unavailable. Try again or choose a category manually.'), setBusy));
  useEffect(() => { alive.current = true; return () => { alive.current = false; latest.clear(); }; }, []);
  function clear() { latest.clear(); setPhoto(null); setResult(null); setError(''); }
  async function pick(camera: boolean) {
    if (pickerBusy.current) return;
    pickerBusy.current = true; setPicking(true); setError('');
    try {
      if (camera && !(await ImagePicker.requestCameraPermissionsAsync()).granted) {
        if (alive.current) setError('Camera permission is off. Choose a photo or enable the camera in Settings.');
        return;
      }
      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ['images'], base64: true, exif: false, quality: 0.5, allowsEditing: false,
      };
      const picked = camera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
      if (!alive.current || picked.canceled) return;
      const asset = picked.assets[0];
      if (!asset?.base64 || asset.base64.length > MAX_BASE64) {
        setError('Choose a smaller photo (under 3 MB after compression).'); return;
      }
      clear(); setPhoto({ uri: asset.uri, base64: asset.base64 });
    } catch {
      if (alive.current) setError('Could not open the camera or photo picker. You can report manually.');
    } finally {
      pickerBusy.current = false;
      if (alive.current) setPicking(false);
    }
  }
  const styles = StyleSheet.create({
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    image: { height: 120, borderRadius: theme.radius, marginVertical: 6 },
    caption: { color: theme.muted, fontFamily: theme.fontBody, fontSize: 12, lineHeight: 18, marginVertical: 4 },
    title: { color: theme.ink, fontFamily: theme.fontBody, fontSize: 14 },
    error: { color: theme.danger, fontFamily: theme.fontBody, fontSize: 12, marginVertical: 4 },
  });
  return <View>
    <View style={styles.row}>
      <Button title="Take photo" disabled={disabled || busy || picking} onPress={() => void pick(true)} />
      <Button title="Choose photo" disabled={disabled || busy || picking} onPress={() => void pick(false)} />
    </View>
    {photo && <>
      <Image source={{ uri: photo.uri }} style={styles.image} accessibilityLabel="Selected hazard photo" />
      <Text style={styles.caption}>Analyze sends this photo to our AI provider. Stop before taking a photo. Review the suggestion and report only a hazard at your current location.</Text>
      <View style={styles.row}>
        <Button title={busy ? 'Analyzing…' : 'Analyze photo'} disabled={disabled || busy || picking}
          onPress={() => { setError(''); setResult(null); void latest.run(() => analyzePhoto(photo.base64)); }} />
        <Button title="Remove photo" disabled={picking} onPress={clear} />
      </View>
    </>}
    {result && <>
      <Text style={styles.title}>{result.kind ? `AI suggestion · ${categoryLabel(result.kind)}` : result.status === 'unclear' ? 'Photo is unclear' : 'No visible hazard identified'}</Text>
      <Text style={styles.caption}>{result.description}</Text>
      {result.status === 'suggested' && <Button title="Use suggestion" disabled={disabled}
        onPress={() => { onApply(result); clear(); }} />}
    </>}
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {error.startsWith('Camera permission') && <Button title="Open camera settings" onPress={() => void Linking.openSettings()} />}
  </View>;
}
