import React, { useState, useMemo, useEffect, useRef } from 'react';
import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import Colors from '@/constants/colors';

interface CurrentLocationMapProps {
  latitude: number;
  longitude: number;
  address?: string;
}

const API_BASE = process.env.EXPO_PUBLIC_API_BASE || '';

// Read-only informational map: shows a fixed marker at the given coordinates.
// The user can pan/zoom to look around, but there is no search, no draggable
// pin and no confirm — it is purely for viewing the current location.
function buildMapHtml(lat: number, lng: number, apiBase: string, presetAddress: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{height:100%;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0A1628}
#map{position:absolute;top:0;left:0;right:0;bottom:88px}
.recenter-btn{position:absolute;bottom:98px;right:12px;z-index:1000;background:#2563EB;border:none;border-radius:50%;width:44px;height:44px;box-shadow:0 2px 12px rgba(37,99,235,0.4);cursor:pointer;display:flex;align-items:center;justify-content:center}
.recenter-btn:active{opacity:.75}
.footer{position:absolute;bottom:0;left:0;right:0;height:88px;background:#0A1628;padding:12px 16px 14px;z-index:1000;border-top:1px solid rgba(255,255,255,0.09)}
.addr-label{color:#6B7280;font-size:10px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;margin-bottom:3px}
.addr-value{color:#fff;font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-height:18px}
.leaflet-control-attribution,.leaflet-control-zoom{display:none!important}
</style>
</head>
<body>
<div id="map"></div>
<button class="recenter-btn" id="recenterBtn" title="Recenter">
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="8" stroke-opacity=".5"/></svg>
</button>
<div class="footer">
  <div class="addr-label">Your Current Location</div>
  <div class="addr-value" id="addrDisplay">${presetAddress ? presetAddress.replace(/</g, '&lt;') : 'Finding address…'}</div>
</div>
<script>
var initLat=${lat}, initLng=${lng};
var map=L.map('map',{zoomControl:false,attributionControl:false}).setView([initLat,initLng],16);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);

// Fixed marker at the current location (informational only)
var markerIcon=L.divIcon({
  className:'',
  html:'<svg width="32" height="42" viewBox="0 0 32 42" fill="none"><path d="M16 0C7.163 0 0 7.163 0 16c0 10.314 14.222 25.055 15.338 26.265a.9.9 0 001.324 0C17.778 41.055 32 26.314 32 16 32 7.163 24.837 0 16 0z" fill="#2563EB"/><circle cx="16" cy="16" r="6.5" fill="white"/></svg>',
  iconSize:[32,42],
  iconAnchor:[16,42],
});
L.marker([initLat,initLng],{icon:markerIcon,interactive:false,keyboard:false}).addTo(map);

var addrDisplay=document.getElementById('addrDisplay');
var GEOCODE_BASE='${apiBase}';
var presetAddress=${JSON.stringify(presetAddress || '')};

function reverseGeocode(la,lo){
  if(presetAddress) return; // already have a label from the app
  addrDisplay.textContent='Finding address…';
  fetch(GEOCODE_BASE+'/api/geocode/reverse?lat='+la+'&lon='+lo)
    .then(function(r){return r.json();})
    .then(function(d){
      if(d.address){
        var a=d.address,parts=[];
        if(a.amenity)parts.push(a.amenity);
        else if(a.road||a.pedestrian||a.footway)parts.push(a.road||a.pedestrian||a.footway);
        if(a.suburb||a.neighbourhood||a.quarter)parts.push(a.suburb||a.neighbourhood||a.quarter);
        if(a.city||a.town||a.village||a.county)parts.push(a.city||a.town||a.village||a.county);
        if(a.state)parts.push(a.state);
        addrDisplay.textContent=parts.length?parts.join(', '):(d.display_name||la.toFixed(5)+', '+lo.toFixed(5));
      } else {
        addrDisplay.textContent=d.display_name||la.toFixed(5)+', '+lo.toFixed(5);
      }
    })
    .catch(function(){addrDisplay.textContent=la.toFixed(5)+', '+lo.toFixed(5);});
}

document.getElementById('recenterBtn').addEventListener('click',function(){
  map.setView([initLat,initLng],16);
});

reverseGeocode(initLat,initLng);
</script>
</body>
</html>`;
}

export default function CurrentLocationMap({ latitude, longitude, address }: CurrentLocationMapProps) {
  const [loading, setLoading] = useState(true);
  const [mapKey] = useState(() => Date.now());
  const webviewRef = useRef<any>(null);

  const mapHtml = useMemo(
    () => buildMapHtml(latitude, longitude, API_BASE, address || ''),
    [mapKey, latitude, longitude, address],
  );

  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 6000);
    return () => clearTimeout(t);
  }, []);

  return (
    <View style={styles.container}>
      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#2563EB" />
          <Text style={styles.loadingText}>Loading map…</Text>
        </View>
      )}
      <WebView
        key={mapKey}
        ref={webviewRef}
        source={{ html: mapHtml }}
        style={styles.webview}
        onLoad={() => setLoading(false)}
        onLoadEnd={() => setLoading(false)}
        onError={() => setLoading(false)}
        onHttpError={() => setLoading(false)}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        mixedContentMode="always"
        originWhitelist={['*']}
        androidLayerType="hardware"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.dark.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    zIndex: 10,
  },
  loadingText: { color: Colors.dark.tabIconDefault, fontSize: 14 },
  webview: { flex: 1, backgroundColor: '#0A1628' },
});
