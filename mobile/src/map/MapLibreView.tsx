import React, { useEffect, useMemo, useRef } from 'react';
import { Linking, type StyleProp, type ViewStyle } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { MAP_PAGE_ORIGIN, mapDarkStyleUrl, mapStyleUrl } from './config';
import { buildMapHtml } from './page';
import { injection, navigationDecision, parseFromWeb, readyMessages, type Camera, type Bounds, type LngLat, type MapTheme, type Overlay } from './protocol';

export type MapLibreViewProps = {
  style?: StyleProp<ViewStyle>;
  center: LngLat;
  zoom: number;
  theme: MapTheme;
  overlay: Overlay;
  camera?: Camera;
  onGesture?(): void;
  onPress?(position: LngLat): void;
  onDragEnd?(id: string, position: LngLat): void;
  onSelect?(id: string): void;
  onBounds?(bounds: Bounds): void;
  onBasemap?(status: 'loaded' | 'unavailable', detail?: string): void;
};

/**
 * OSM basemap rendered by MapLibre GL JS inside a WebView (works in Expo Go). The page is built once;
 * overlays are pushed after the page reports ready, and the latest overlay is resent on every ready.
 */
export function MapLibreView(props: MapLibreViewProps) {
  const ref = useRef<WebView>(null);
  const ready = useRef(false);
  const latest = useRef(props);
  latest.current = props;
  // Center/zoom are initial values only, like react-native-maps' initialRegion.
  const html = useMemo(() => buildMapHtml({ styleUrl: mapStyleUrl, darkStyleUrl: mapDarkStyleUrl, center: props.center, zoom: props.zoom }), []);

  // The app rebuilds the overlay every render; only changed content crosses the bridge.
  const overlayText = JSON.stringify(props.overlay);
  useEffect(() => {
    if (ready.current) ref.current?.injectJavaScript(injection({ type: 'overlay', overlay: props.overlay }));
  }, [overlayText]);
  useEffect(() => {
    if (ready.current) ref.current?.injectJavaScript(injection({ type: 'theme', theme: props.theme }));
  }, [props.theme]);

  const cameraText = JSON.stringify(props.camera);
  useEffect(() => {
    if (ready.current && props.camera) ref.current?.injectJavaScript(injection({ type: 'camera', camera: props.camera }));
  }, [cameraText]);

  function onMessage(event: WebViewMessageEvent) {
    const message = parseFromWeb(event.nativeEvent.data);
    if (!message) return;
    const current = latest.current;
    switch (message.type) {
      case 'ready':
        ready.current = true;
        readyMessages(current.theme, current.overlay).forEach(message => ref.current?.injectJavaScript(injection(message)));
        if (current.camera) ref.current?.injectJavaScript(injection({ type: 'camera', camera: current.camera }));
        break;
      case 'gesture': current.onGesture?.(); break;
      case 'press': current.onPress?.(message.position); break;
      case 'drag': current.onDragEnd?.(message.id, message.position); break;
      case 'select': current.onSelect?.(message.id); break;
      case 'bounds': current.onBounds?.(message.bounds); break;
      case 'basemap': current.onBasemap?.(message.status, message.detail); break;
    }
  }

  return <WebView ref={ref} style={props.style} source={{ html, baseUrl: MAP_PAGE_ORIGIN }} onMessage={onMessage}
    javaScriptEnabled domStorageEnabled={false} setSupportMultipleWindows={false}
    // '*' sends every navigation to the guard below. A narrower whitelist would make the library pass
    // non-matching URLs (intent:, tel:, javascript: ...) straight to Linking.openURL.
    originWhitelist={['*']}
    onShouldStartLoadWithRequest={request => {
      const decision = navigationDecision(request.url, MAP_PAGE_ORIGIN);
      if (decision === 'external') void Linking.openURL(request.url);
      return decision === 'load';
    }}
    onContentProcessDidTerminate={() => { ready.current = false; ref.current?.reload(); }}
    onRenderProcessGone={() => { ready.current = false; ref.current?.reload(); }} />;
}
