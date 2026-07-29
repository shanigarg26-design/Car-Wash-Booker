/**
 * SearchingMap — Embedded Leaflet map (OpenStreetMap tiles, no API key required).
 * Works in Expo Go on Android, iOS, and web via react-native-webview.
 *
 * Shows:
 *  • Real map tiles centred on the customer's location
 *  • Pulsing sonar rings + blue pin overlay (CSS animated, inside the map HTML)
 *  • 5 km radius shaded circle
 *  • 🧹 markers for every nearby / available cleaner
 *  • LIVE badge & cleaner-count pill
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Platform, Animated, Easing, ActivityIndicator,
} from 'react-native';
import Colors from '@/constants/colors';
import AppIcon from '@/components/AppIcon';

// react-native-webview — cross-platform, works in Expo Go
let WebView: any = null;
try { WebView = require('react-native-webview').WebView; } catch { WebView = null; }

// expo-location — only needed on native as a GPS fallback
let ExpoLocation: any = null;
if (Platform.OS !== 'web') {
  try { ExpoLocation = require('expo-location'); } catch { ExpoLocation = null; }
}

export interface NearbyCleanerItem {
  id: number;
  lat: number;
  lng: number;
  dist: number;
}

interface Props {
  customerLat:      number | null | undefined;
  customerLng:      number | null | undefined;
  nearbyWashers:    NearbyCleanerItem[];
  dispatchedCount:  number;
  onLocationChange?: (lat: number, lng: number) => void;
}

// ── Sonar rings (shown in the animated-radar fallback only) ───────────────────
function SonarRing({ delay, maxScale, color = Colors.dark.tint }: {
  delay: number; maxScale: number; color?: string;
}) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(anim, { toValue: 1, duration: 2400, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);
  const scale   = anim.interpolate({ inputRange: [0, 1], outputRange: [1, maxScale] });
  const opacity = anim.interpolate({ inputRange: [0, 0.12, 1], outputRange: [0, 0.55, 0] });
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.sonarRing, { borderColor: color, transform: [{ scale }], opacity }]}
    />
  );
}

// ── Pure-animation radar fallback (no map at all) ─────────────────────────────
function RadarFallback({ nearbyCount }: { nearbyCount: number }) {
  return (
    <View style={styles.radarContainer}>
      <SonarRing delay={0}    maxScale={2.6} />
      <SonarRing delay={750}  maxScale={3.4} />
      <SonarRing delay={1500} maxScale={4.2} />
      <View style={styles.radarCenter}>
        <AppIcon name="map-pin" size={32} color="#FFF" />
      </View>
      {nearbyCount > 0 && (
        <View style={styles.radarBadge}>
          <Text style={styles.radarBadgeText}>
            {nearbyCount} cleaner{nearbyCount !== 1 ? 's' : ''} nearby
          </Text>
        </View>
      )}
    </View>
  );
}

// ── Build the full HTML page that Leaflet will render ─────────────────────────
function buildLeafletHtml(
  lat: number,
  lng: number,
  cleaners: NearbyCleanerItem[],
): string {
  const cleanerMarkers = cleaners
    .map(c => `addCleaner(${c.lat}, ${c.lng}, ${c.dist.toFixed(2)});`)
    .join('\n      ');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { width:100%; height:100%; background:#0A101C; overflow:hidden; }
  #map { width:100%; height:100%; }

  /* ── SONAR rings centered on the customer pin ── */
  #sonar-wrap {
    position: fixed;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    pointer-events: none;
    z-index: 900;
  }
  .ring {
    position: absolute;
    width: 60px; height: 60px;
    top: -30px; left: -30px;
    border-radius: 50%;
    border: 2.5px solid #3B82F6;
    animation: sonar 2.6s ease-out infinite;
    opacity: 0;
  }
  .ring:nth-child(2) { animation-delay: 0.8s; }
  .ring:nth-child(3) { animation-delay: 1.6s; }
  @keyframes sonar {
    0%   { transform: scale(1);   opacity: 0; }
    8%   { opacity: 0.55; }
    100% { transform: scale(5.5); opacity: 0; }
  }

  /* ── Centre pin ── */
  #pin-center {
    position: fixed;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    width: 44px; height: 44px;
    border-radius: 50%;
    background: #3B82F6;
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 0 18px rgba(59,130,246,0.7);
    z-index: 901;
    pointer-events: none;
    font-size: 20px;
  }

  /* ── Cleaner DivIcon ── */
  .cleaner-icon {
    width: 34px; height: 34px;
    background: #1E3A5F;
    border: 2.5px solid #3B82F6;
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 16px;
    box-shadow: 0 0 8px rgba(59,130,246,0.5);
    animation: pulse-cleaner 1.6s ease-in-out infinite;
  }
  @keyframes pulse-cleaner {
    0%, 100% { box-shadow: 0 0 6px rgba(59,130,246,0.4); }
    50%       { box-shadow: 0 0 16px rgba(59,130,246,0.9); }
  }

  /* ── Customer DivIcon ── */
  .customer-icon {
    width: 28px; height: 28px;
    background: rgba(59,130,246,0.25);
    border: 2.5px solid #3B82F6;
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
  }
  .customer-dot {
    width: 12px; height: 12px;
    background: #3B82F6;
    border-radius: 50%;
  }
</style>
</head>
<body>
<div id="map"></div>
<div id="sonar-wrap">
  <div class="ring"></div>
  <div class="ring"></div>
  <div class="ring"></div>
</div>
<div id="pin-center">📍</div>

<script>
  // Init Leaflet
  var map = L.map('map', {
    center: [${lat}, ${lng}],
    zoom: 14,
    zoomControl: false,
    attributionControl: false,
  });

  // Dark-ish OSM tile layer
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
  }).addTo(map);

  // 5 km radius circle
  L.circle([${lat}, ${lng}], {
    radius: 5000,
    color: '#3B82F6',
    weight: 1.5,
    opacity: 0.4,
    fillColor: '#3B82F6',
    fillOpacity: 0.05,
  }).addTo(map);

  /* ── Draggable customer pin ── */
  var customerIcon = L.divIcon({
    html: '<div class="customer-icon"><div class="customer-dot"></div></div>',
    className: '',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
  var customerMarker = L.marker([${lat}, ${lng}], {
    icon: customerIcon,
    draggable: true,
    autoPan: true,
  }).addTo(map);

  /* Show a tooltip while dragging */
  customerMarker.bindTooltip('Move pin to change location', { permanent: false, direction: 'top' });

  customerMarker.on('dragstart', function() {
    customerMarker.setTooltipContent('Move to new location');
    customerMarker.openTooltip();
  });

  customerMarker.on('drag', function() {
    /* Keep sonar rings centred on the dragged pin */
  });

  customerMarker.on('dragend', function() {
    customerMarker.closeTooltip();
    var pos = customerMarker.getLatLng();
    var msg = JSON.stringify({ type: 'LOCATION_CHANGED', lat: pos.lat, lng: pos.lng });
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(msg);
    } else {
      window.parent.postMessage(msg, '*');
    }
  });

  // Cleaner markers
  function addCleaner(clat, clng, dist) {
    var icon = L.divIcon({
      html: '<div class="cleaner-icon">🧹</div>',
      className: '',
      iconSize: [34, 34],
      iconAnchor: [17, 17],
    });
    L.marker([clat, clng], { icon: icon })
      .bindPopup('Cleaner · ' + dist + ' km away')
      .addTo(map);
  }

  ${cleanerMarkers}

  // Accept messages from React Native to update cleaners
  document.addEventListener('message', handleMsg);
  window.addEventListener('message', handleMsg);
  function handleMsg(e) {
    try {
      var data = JSON.parse(e.data);
      if (data.type === 'UPDATE_CLEANERS') {
        // Simple page reload with new markers would be too jarring;
        // instead re-draw by tracking layer groups
        if (window._cleanerGroup) { window._cleanerGroup.clearLayers(); }
        window._cleanerGroup = L.layerGroup().addTo(map);
        (data.cleaners || []).forEach(function(c) {
          var icon = L.divIcon({
            html: '<div class="cleaner-icon">🧹</div>',
            className: '',
            iconSize: [34, 34],
            iconAnchor: [17, 17],
          });
          L.marker([c.lat, c.lng], { icon: icon })
            .bindPopup('Cleaner · ' + c.dist.toFixed(2) + ' km away')
            .addTo(window._cleanerGroup);
        });
      }
    } catch(_) {}
  }
</script>
</body>
</html>`;
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function SearchingMap({
  customerLat,
  customerLng,
  nearbyWashers,
  dispatchedCount,
  onLocationChange,
}: Props) {
  const [resolvedLat, setResolvedLat] = useState<number | null>(customerLat ?? null);
  const [resolvedLng, setResolvedLng] = useState<number | null>(customerLng ?? null);
  const [locLoading, setLocLoading]   = useState(false);
  const webViewRef = useRef<any>(null);

  // Sync when booking coordinates arrive
  useEffect(() => {
    if (customerLat != null) setResolvedLat(customerLat);
    if (customerLng != null) setResolvedLng(customerLng);
  }, [customerLat, customerLng]);

  // GPS fallback — if the booking has no coordinates, ask the device
  useEffect(() => {
    if (!ExpoLocation || resolvedLat != null) return;
    let cancelled = false;
    setLocLoading(true);
    (async () => {
      try {
        const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
        if (status !== 'granted' || cancelled) return;
        const pos = await ExpoLocation.getCurrentPositionAsync({
          accuracy: ExpoLocation.Accuracy.Balanced,
        });
        if (!cancelled) {
          setResolvedLat(pos.coords.latitude);
          setResolvedLng(pos.coords.longitude);
        }
      } catch { /* fall through to radar */ } finally {
        if (!cancelled) setLocLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [resolvedLat]);

  // Push cleaner updates to the embedded Leaflet map via postMessage
  useEffect(() => {
    if (!webViewRef.current || !resolvedLat || !resolvedLng) return;
    const msg = JSON.stringify({ type: 'UPDATE_CLEANERS', cleaners: nearbyWashers });
    webViewRef.current.postMessage(msg);
  }, [nearbyWashers]);

  // ── Fallback: WebView unavailable (very rare) ─────────────────────────────
  if (!WebView) {
    return <RadarFallback nearbyCount={nearbyWashers.length} />;
  }

  // ── Loading: waiting for GPS ──────────────────────────────────────────────
  if (locLoading && !resolvedLat) {
    return (
      <View style={styles.locatingBox}>
        <ActivityIndicator color={Colors.dark.tint} size="small" />
        <Text style={styles.locatingText}>Locating you…</Text>
      </View>
    );
  }

  // ── No coordinates at all (shouldn't happen normally) ─────────────────────
  if (!resolvedLat || !resolvedLng) {
    return <RadarFallback nearbyCount={nearbyWashers.length} />;
  }

  // ── Real Leaflet map in a WebView ─────────────────────────────────────────
  const html = buildLeafletHtml(resolvedLat, resolvedLng, nearbyWashers);

  return (
    <View style={styles.fill}>
      <WebView
        ref={webViewRef}
        source={{ html, baseUrl: '' }}
        style={styles.webView}
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        mixedContentMode="always"
        allowFileAccess
        cacheEnabled={false}
        onMessage={(e: any) => {
          try {
            const data = JSON.parse(e.nativeEvent.data);
            if (data.type === 'LOCATION_CHANGED' && onLocationChange) {
              onLocationChange(data.lat, data.lng);
            }
          } catch {}
        }}
        onError={(e: any) => console.warn('[SearchingMap] WebView error:', e.nativeEvent)}
      />

      {/* Overlay: LIVE badge */}
      <View style={styles.liveBadge}>
        <View style={styles.liveDot} />
        <Text style={styles.liveBadgeText}>LIVE</Text>
      </View>

      {/* Overlay: drag-to-relocate hint — only shown for customers (when onLocationChange is provided) */}
      {onLocationChange && (
        <View style={styles.dragHint}>
          <AppIcon name="map-pin" size={12} color="#CBD5E1" />
          <Text style={styles.dragHintText}>Drag pin to change location</Text>
        </View>
      )}

      {/* Overlay: cleaner count pill */}
      <View style={styles.countPill}>
        <View style={[styles.countDot, nearbyWashers.length > 0 ? styles.dotGreen : styles.dotAmber]} />
        <Text style={styles.countText}>
          {nearbyWashers.length > 0
            ? `${nearbyWashers.length} cleaner${nearbyWashers.length !== 1 ? 's' : ''} within 5 km`
            : 'Searching for cleaners…'}
        </Text>
      </View>
    </View>
  );
}

const SONAR_SIZE = 70;
const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  webView: {
    flex: 1,
    backgroundColor: '#0A101C',
  },

  // LIVE badge
  liveBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(0,0,0,0.72)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#4ADE80',
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#4ADE80',
  },
  liveBadgeText: {
    color: '#4ADE80',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },

  // Drag-to-relocate hint (top-left, below LIVE badge)
  dragHint: {
    position: 'absolute',
    top: 50,
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(0,0,0,0.60)',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 10,
  },
  dragHintText: {
    color: '#CBD5E1',
    fontSize: 10,
    fontWeight: '600',
  },

  // Count pill
  countPill: {
    position: 'absolute',
    bottom: 16,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: 'rgba(0,0,0,0.76)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 24,
  },
  countDot: { width: 8, height: 8, borderRadius: 4 },
  dotGreen:  { backgroundColor: '#4ADE80' },
  dotAmber:  { backgroundColor: '#FBBF24' },
  countText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '600',
  },

  // Animated radar fallback
  radarContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.dark.background,
  },
  sonarRing: {
    position: 'absolute',
    width: SONAR_SIZE,
    height: SONAR_SIZE,
    borderRadius: SONAR_SIZE / 2,
    borderWidth: 2.5,
    backgroundColor: 'transparent',
  },
  radarCenter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.dark.tint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radarBadge: {
    position: 'absolute',
    bottom: '25%',
    backgroundColor: 'rgba(59,130,246,0.18)',
    borderWidth: 1,
    borderColor: Colors.dark.tint,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 5,
  },
  radarBadgeText: {
    color: Colors.dark.tint,
    fontSize: 12,
    fontWeight: '700',
  },

  // Locating spinner
  locatingBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: Colors.dark.background,
  },
  locatingText: {
    color: Colors.dark.tabIconDefault,
    fontSize: 13,
  },
});
