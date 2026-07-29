/**
 * WasherTrackingMap — Leaflet WebView live tracking map.
 * Works in Expo Go on Android, iOS, and web via react-native-webview.
 *
 * Shows:
 *  • OpenStreetMap tiles (no API key)
 *  • Customer pin (blue 🏠)
 *  • Cleaner pin (🧹) that smoothly moves as location updates via postMessage
 *  • Dashed route polyline between them
 *  • LIVE badge, status banner, distance + ETA pills overlaid in React Native
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Platform, Animated, Easing, ActivityIndicator,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/api/client';
import Colors from '@/constants/colors';
import AppIcon from '@/components/AppIcon';

let WebView: any = null;
try { WebView = require('react-native-webview').WebView; } catch { WebView = null; }

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function etaLabel(km: number): string {
  if (km < 0.1) return 'Almost here';
  const mins = Math.round((km / 20) * 60);
  return mins <= 1 ? '~1 min' : `~${mins} min`;
}

function distLabel(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m away`;
  return `${km.toFixed(1)} km away`;
}

interface Props {
  bookingId:   string | number;
  customerLat: number;
  customerLng: number;
  washerName:  string;
  status:      string;
}

// ── Build the full Leaflet HTML page ─────────────────────────────────────────
function buildLeafletHtml(customerLat: number, customerLng: number, status: string): string {
  const markerColor =
    status === 'arrived'     ? '#7C3AED' :
    status === 'in_progress' ? '#4ADE80' :
    '#3B82F6';

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

  /* Customer pin */
  .cust-pin {
    width:44px; height:44px;
    border-radius:50%;
    background:#3B82F6;
    border:3px solid #fff;
    display:flex; align-items:center; justify-content:center;
    font-size:20px;
    box-shadow:0 0 16px rgba(59,130,246,0.7);
  }

  /* Cleaner pin */
  .cleaner-wrap {
    display:flex; flex-direction:column; align-items:center;
    width:56px;
  }
  .cleaner-pin {
    width:48px; height:48px;
    border-radius:50%;
    background:${markerColor};
    border:3px solid #fff;
    display:flex; align-items:center; justify-content:center;
    font-size:22px;
    box-shadow:0 0 20px ${markerColor}99;
    animation:pulse 1.8s ease-in-out infinite;
    position:relative;
  }
  .cleaner-pin::before {
    content:'';
    position:absolute;
    width:100%; height:100%;
    border-radius:50%;
    border:2px solid ${markerColor};
    animation:ring 1.8s ease-out infinite;
    opacity:0;
  }
  @keyframes pulse {
    0%,100% { box-shadow:0 0 10px ${markerColor}66; }
    50%      { box-shadow:0 0 28px ${markerColor}cc; }
  }
  @keyframes ring {
    0%   { transform:scale(1);   opacity:0.7; }
    100% { transform:scale(2.2); opacity:0; }
  }
  .cleaner-label {
    margin-top:4px;
    background:${markerColor};
    border-radius:8px;
    padding:2px 8px;
    font-size:10px;
    color:#fff;
    font-weight:700;
    white-space:nowrap;
    font-family:sans-serif;
  }
</style>
</head>
<body>
<div id="map"></div>
<script>
  var CUST_LAT = ${customerLat};
  var CUST_LNG = ${customerLng};

  var map = L.map('map', {
    center: [CUST_LAT, CUST_LNG],
    zoom: 15,
    zoomControl: false,
    attributionControl: false,
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
  }).addTo(map);

  /* Customer marker */
  var custIcon = L.divIcon({
    html: '<div class="cust-pin">📍</div>',
    className: '',
    iconSize: [44, 44],
    iconAnchor: [22, 22],
  });
  L.marker([CUST_LAT, CUST_LNG], { icon: custIcon }).addTo(map);

  /* Cleaner marker — added when first location arrives */
  var cleanerMarker = null;
  var routeLine = null;
  var cleanerName = 'Cleaner';

  function getCleanerIcon(name) {
    var label = name.split(' ')[0];
    return L.divIcon({
      html: '<div class="cleaner-wrap"><div class="cleaner-pin">🧹</div><div class="cleaner-label">' + label + '</div></div>',
      className: '',
      iconSize: [56, 66],
      iconAnchor: [28, 66],
    });
  }

  function handleMsg(e) {
    try {
      var data = JSON.parse(e.data);
      if (data.type === 'UPDATE_CLEANER') {
        var lat = data.lat, lng = data.lng;
        if (data.name) cleanerName = data.name;

        if (!cleanerMarker) {
          cleanerMarker = L.marker([lat, lng], {
            icon: getCleanerIcon(cleanerName),
          }).addTo(map);

          routeLine = L.polyline(
            [[lat, lng], [CUST_LAT, CUST_LNG]],
            { color: '${markerColor}', weight: 3, dashArray: '10 8', opacity: 0.8 }
          ).addTo(map);

          map.fitBounds([[CUST_LAT, CUST_LNG], [lat, lng]], {
            paddingTopLeft: [60, 60],
            paddingBottomRight: [60, 60],
          });
        } else {
          cleanerMarker.setLatLng([lat, lng]);
          routeLine.setLatLngs([[lat, lng], [CUST_LAT, CUST_LNG]]);
        }

        /* Notify React Native that map received an update */
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'MAP_UPDATED' }));
        }
      }
    } catch(_) {}
  }

  document.addEventListener('message', handleMsg);
  window.addEventListener('message', handleMsg);
</script>
</body>
</html>`;
}

// ── Blinking LIVE badge ───────────────────────────────────────────────────────
function LiveBadge({ color }: { color: string }) {
  const blink = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(blink, { toValue: 0.15, duration: 600, useNativeDriver: true }),
        Animated.timing(blink, { toValue: 1,    duration: 600, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);
  return (
    <View style={[styles.liveBadge, { borderColor: color + '80' }]}>
      <Animated.View style={[styles.liveDot, { backgroundColor: color, opacity: blink }]} />
      <Text style={[styles.liveBadgeText, { color }]}>LIVE</Text>
    </View>
  );
}

// ── Animated fallback (web / no WebView) ─────────────────────────────────────
function AnimatedFallback({ washerName, status }: { washerName: string; status: string }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);
  const tx = anim.interpolate({ inputRange: [0, 1], outputRange: [-20, 20] });

  const color =
    status === 'arrived'     ? '#7C3AED' :
    status === 'in_progress' ? '#4ADE80' :
    Colors.dark.tint;

  const label =
    status === 'arrived'     ? `${washerName} has arrived!` :
    status === 'in_progress' ? `${washerName} is cleaning your car` :
    `${washerName} is on the way`;

  return (
    <View style={styles.fallback}>
      <View style={styles.fallbackRow}>
        <View style={styles.fallbackCustPin}>
          <AppIcon name="home" size={20} color="#FFF" />
        </View>
        <View style={styles.fallbackDash} />
        <Animated.View style={[styles.fallbackCleanerPin, { backgroundColor: color, transform: [{ translateX: tx }] }]}>
          <Text style={{ fontSize: 20 }}>🧹</Text>
        </Animated.View>
      </View>
      <Text style={[styles.fallbackLabel, { color }]}>{label}</Text>
      <Text style={styles.fallbackHint}>Live map available in the mobile app</Text>
    </View>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function WasherTrackingMap({ bookingId, customerLat, customerLng, washerName, status }: Props) {
  const webViewRef = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);

  const markerColor =
    status === 'arrived'     ? '#7C3AED' :
    status === 'in_progress' ? '#4ADE80' :
    Colors.dark.tint;

  const statusLabel =
    status === 'arrived'     ? 'Arrived' :
    status === 'in_progress' ? 'Cleaning Now' :
    'On the Way';

  // Poll cleaner location every 2 s
  const { data } = useQuery<{ lat: number | null; lng: number | null; name: string | null }>({
    queryKey: ['washer-location', bookingId],
    queryFn:  () => apiFetch(`/api/bookings/${bookingId}/washer-location`),
    refetchInterval: 2000,
    staleTime:       1500,
    enabled: !!bookingId && ['accepted', 'arrived', 'in_progress'].includes(status),
  });

  const washerLat = data?.lat ?? null;
  const washerLng = data?.lng ?? null;

  const distKm = washerLat && washerLng
    ? haversineKm(customerLat, customerLng, washerLat, washerLng)
    : null;

  // Push cleaner location to Leaflet map via postMessage
  useEffect(() => {
    if (!webViewRef.current || !washerLat || !washerLng) return;
    webViewRef.current.postMessage(JSON.stringify({
      type: 'UPDATE_CLEANER',
      lat:  washerLat,
      lng:  washerLng,
      name: washerName,
    }));
  }, [washerLat, washerLng]);

  if (!WebView) {
    return <AnimatedFallback washerName={washerName} status={status} />;
  }

  return (
    <View style={styles.fill}>
      <WebView
        ref={webViewRef}
        source={{ html: buildLeafletHtml(customerLat, customerLng, status), baseUrl: '' }}
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
        onLoad={() => setMapReady(true)}
        onMessage={(e: any) => {
          try {
            const d = JSON.parse(e.nativeEvent.data);
            if (d.type === 'MAP_UPDATED') setMapReady(true);
          } catch {}
        }}
        onError={(e: any) => console.warn('[WasherTrackingMap] error:', e.nativeEvent)}
      />

      {/* LIVE badge — top-left */}
      <LiveBadge color={markerColor} />

      {/* Status + ETA banner — top-right */}
      <View style={[styles.statusBanner, { borderColor: markerColor + '55' }]}>
        <View style={[styles.statusDot, { backgroundColor: markerColor }]} />
        <View>
          <Text style={[styles.statusLabel, { color: markerColor }]}>{statusLabel}</Text>
          {distKm !== null && status === 'accepted' && (
            <Text style={styles.etaSmall}>{etaLabel(distKm)}</Text>
          )}
        </View>
      </View>

      {/* Distance + ETA pills — bottom */}
      <View style={styles.bottomRow}>
        <View style={styles.distPill}>
          <AppIcon name="map-pin" size={12} color="#94A3B8" />
          <Text style={styles.distPillText}>
            {washerLat && washerLng
              ? (distKm !== null ? distLabel(distKm) : 'Locating…')
              : `Locating ${washerName.split(' ')[0]}…`}
          </Text>
        </View>
        {distKm !== null && status === 'accepted' && (
          <View style={styles.etaPill}>
            <AppIcon name="clock" size={12} color="#60A5FA" />
            <Text style={styles.etaPillText}>{etaLabel(distKm)}</Text>
          </View>
        )}
      </View>

      {/* Locating overlay — shown until first cleaner position arrives */}
      {!washerLat && (
        <View style={styles.locatingOverlay}>
          <ActivityIndicator color="#FFF" size="small" />
          <Text style={styles.locatingText}>Locating {washerName.split(' ')[0]}…</Text>
        </View>
      )}
    </View>
  );
}

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
    top: 12, left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(0,0,0,0.76)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
  },
  liveDot: {
    width: 7, height: 7, borderRadius: 4,
  },
  liveBadgeText: {
    fontSize: 11, fontWeight: '800', letterSpacing: 1,
  },

  // Status banner (top-right)
  statusBanner: {
    position: 'absolute',
    top: 12, right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(0,0,0,0.76)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 12,
    borderWidth: 1,
  },
  statusDot: {
    width: 9, height: 9, borderRadius: 5,
  },
  statusLabel: {
    fontSize: 12, fontWeight: '800', letterSpacing: 0.3,
  },
  etaSmall: {
    color: '#94A3B8', fontSize: 10, fontWeight: '500', marginTop: 1,
  },

  // Bottom row
  bottomRow: {
    position: 'absolute',
    bottom: 16, left: 12, right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  distPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.76)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
  },
  distPillText: {
    color: '#CBD5E1', fontSize: 11, fontWeight: '600', flexShrink: 1,
  },
  etaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(0,0,0,0.76)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(96,165,250,0.35)',
  },
  etaPillText: {
    color: '#60A5FA', fontSize: 11, fontWeight: '700',
  },

  // Locating overlay
  locatingOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(10,22,40,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  locatingText: {
    color: '#CBD5E1', fontSize: 13, fontWeight: '600',
  },

  // Animated fallback (web or no WebView)
  fallback: {
    flex: 1,
    backgroundColor: '#0A101C',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  fallbackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  fallbackCustPin: {
    width: 50, height: 50, borderRadius: 25,
    backgroundColor: '#3B82F6',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2.5, borderColor: '#fff',
  },
  fallbackDash: {
    width: 72, height: 2,
    borderBottomWidth: 2, borderStyle: 'dashed', borderColor: '#334155',
  },
  fallbackCleanerPin: {
    width: 54, height: 54, borderRadius: 27,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2.5, borderColor: '#fff',
  },
  fallbackLabel: {
    fontSize: 15, fontWeight: '700', textAlign: 'center',
  },
  fallbackHint: {
    color: '#475569', fontSize: 12, textAlign: 'center',
  },
});
