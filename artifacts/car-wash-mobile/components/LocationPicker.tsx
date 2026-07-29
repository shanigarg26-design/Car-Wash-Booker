import React, { useState, useRef, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  SafeAreaView,
  ActivityIndicator,
} from 'react-native';
import { WebView } from 'react-native-webview';
import AppIcon from '@/components/AppIcon';
import Colors from '@/constants/colors';

export interface PickedLocation {
  latitude: number;
  longitude: number;
  address?: string;
}

interface LocationPickerProps {
  value: PickedLocation | null;
  onChange: (loc: PickedLocation) => void;
}

const DEFAULT_LAT = 20.5937;
const DEFAULT_LNG = 78.9629;
const API_BASE = process.env.EXPO_PUBLIC_DOMAIN
  ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
  : '';

function buildMapHtml(lat: number, lng: number, apiBase: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{height:100%;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0A1628}
#map{position:absolute;top:0;left:0;right:0;bottom:108px}
.pin{position:absolute;top:calc(50% - 108px/2);left:50%;transform:translate(-50%,-100%);z-index:999;pointer-events:none;transition:transform .12s ease}
.pin.lifting{transform:translate(-50%,-115%)}
.pin-shadow{width:10px;height:5px;background:rgba(0,0,0,0.25);border-radius:50%;position:absolute;bottom:-3px;left:50%;transform:translateX(-50%)}
.search-wrap{position:absolute;top:10px;left:10px;right:10px;z-index:1000}
.search-bar{background:#fff;border-radius:12px;display:flex;align-items:center;padding:10px 14px;gap:8px;box-shadow:0 3px 18px rgba(0,0,0,0.3)}
.search-input{flex:1;border:none;outline:none;font-size:15px;color:#111;background:transparent}
.search-input::placeholder{color:#aaa}
.search-results{margin-top:5px;background:#fff;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.3);overflow:hidden;max-height:220px;overflow-y:auto}
.result-item{padding:12px 16px;border-bottom:1px solid #f0f0f0;cursor:pointer}
.result-item:last-child{border-bottom:none}
.result-item:active{background:#f0f4ff}
.result-name{font-size:14px;font-weight:600;color:#111}
.result-sub{font-size:12px;color:#888;margin-top:2px}
.locate-btn{position:absolute;bottom:118px;right:12px;z-index:1000;background:#fff;border:none;border-radius:50%;width:44px;height:44px;box-shadow:0 2px 12px rgba(0,0,0,0.25);cursor:pointer;display:flex;align-items:center;justify-content:center}
.footer{position:absolute;bottom:0;left:0;right:0;height:108px;background:#0A1628;padding:10px 16px 14px;z-index:1000;border-top:1px solid rgba(255,255,255,0.09)}
.addr-label{color:#6B7280;font-size:10px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;margin-bottom:3px}
.addr-value{color:#fff;font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:8px;min-height:18px}
.confirm-btn{background:#2563EB;color:#fff;border:none;border-radius:10px;padding:11px;width:100%;font-size:15px;font-weight:700;cursor:pointer}
.confirm-btn:active{background:#1d4ed8}
.leaflet-control-attribution,.leaflet-control-zoom{display:none!important}
</style>
</head>
<body>
<div id="map"></div>
<div class="pin" id="pin">
  <svg width="32" height="42" viewBox="0 0 32 42" fill="none">
    <path d="M16 0C7.163 0 0 7.163 0 16c0 10.314 14.222 25.055 15.338 26.265a.9.9 0 001.324 0C17.778 41.055 32 26.314 32 16 32 7.163 24.837 0 16 0z" fill="#2563EB"/>
    <circle cx="16" cy="16" r="6.5" fill="white"/>
  </svg>
  <div class="pin-shadow"></div>
</div>
<div class="search-wrap">
  <div class="search-bar">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#aaa" stroke-width="2.5" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
    <input class="search-input" id="searchInput" type="text" placeholder="Search area, street or city…" autocomplete="off"/>
    <button id="clearBtn" style="display:none;background:none;border:none;color:#bbb;font-size:17px;cursor:pointer;padding:0 2px;line-height:1">&#x2715;</button>
  </div>
  <div class="search-results" id="searchResults" style="display:none"></div>
</div>
<button class="locate-btn" id="locateBtn">
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563EB" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="8" stroke-opacity=".3"/></svg>
</button>
<div class="footer">
  <div class="addr-label">Selected Location</div>
  <div class="addr-value" id="addrDisplay">Move the map to select a location</div>
  <button class="confirm-btn" id="confirmBtn">Confirm Location</button>
</div>
<script>
var initLat=${lat}, initLng=${lng};
var currentAddress='';
var searchTimer;

var map=L.map('map',{zoomControl:false,attributionControl:false}).setView([initLat,initLng],16);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);

var pin=document.getElementById('pin');
var addrDisplay=document.getElementById('addrDisplay');

map.on('movestart',function(){
  pin.classList.add('lifting');
  addrDisplay.textContent='Moving…';
});
map.on('moveend',function(){
  pin.classList.remove('lifting');
  var c=map.getCenter();
  reverseGeocode(c.lat,c.lng);
});

var GEOCODE_BASE='${apiBase}';

function reverseGeocode(la,lo){
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
        currentAddress=parts.length?parts.join(', '):d.display_name;
      } else {
        currentAddress=d.display_name||la.toFixed(5)+', '+lo.toFixed(5);
      }
      addrDisplay.textContent=currentAddress;
    })
    .catch(function(){currentAddress=la.toFixed(5)+', '+lo.toFixed(5);addrDisplay.textContent=currentAddress;});
}

var searchInput=document.getElementById('searchInput');
var searchResults=document.getElementById('searchResults');
var clearBtn=document.getElementById('clearBtn');

searchInput.addEventListener('input',function(){
  clearTimeout(searchTimer);
  var q=searchInput.value.trim();
  clearBtn.style.display=q?'block':'none';
  if(!q){searchResults.style.display='none';return;}
  searchTimer=setTimeout(function(){
    fetch(GEOCODE_BASE+'/api/geocode/search?q='+encodeURIComponent(q))
      .then(function(r){return r.json();})
      .then(function(results){
        searchResults.innerHTML='';
        if(!results||!results.length){
          searchResults.innerHTML='<div class="result-item" style="color:#999;font-size:13px;text-align:center;">No results found. Try a broader search.</div>';
          searchResults.style.display='block';
          return;
        }
        results.forEach(function(item){
          var parts=item.display_name.split(',');
          var name=parts[0].trim();
          var sub=parts.slice(1,4).map(function(s){return s.trim();}).filter(Boolean).join(', ');
          var div=document.createElement('div');
          div.className='result-item';
          div.innerHTML='<div class="result-name">'+name+'</div>'+(sub?'<div class="result-sub">'+sub+'</div>':'');
          div.addEventListener('click',function(){
            map.setView([parseFloat(item.lat),parseFloat(item.lon)],17);
            searchInput.value=name;
            currentAddress=item.display_name;
            addrDisplay.textContent=name+', '+sub;
            searchResults.style.display='none';
          });
          searchResults.appendChild(div);
        });
        searchResults.style.display='block';
      })
      .catch(function(){
        searchResults.innerHTML='<div class="result-item" style="color:#999;font-size:13px;text-align:center;">Search unavailable. Drag the map to select.</div>';
        searchResults.style.display='block';
      });
  },350);
});

clearBtn.addEventListener('click',function(){
  searchInput.value='';
  clearBtn.style.display='none';
  searchResults.style.display='none';
  searchInput.focus();
});

document.getElementById('locateBtn').addEventListener('click',function(){
  if(navigator.geolocation){
    navigator.geolocation.getCurrentPosition(
      function(p){map.setView([p.coords.latitude,p.coords.longitude],17);},
      function(){}
    );
  }
});

function sendMsg(data){
  var s=JSON.stringify(data);
  if(window.ReactNativeWebView){window.ReactNativeWebView.postMessage(s);}
  else{window.parent.postMessage(s,'*');}
}
document.getElementById('confirmBtn').addEventListener('click',function(){
  var c=map.getCenter();
  sendMsg({
    type:'confirm',
    lat:c.lat,
    lng:c.lng,
    address:currentAddress||addrDisplay.textContent
  });
});

reverseGeocode(initLat,initLng);
</script>
</body>
</html>`;
}

export default function LocationPicker({ value, onChange }: LocationPickerProps) {
  const [modalVisible, setModalVisible] = useState(false);
  const [mapKey, setMapKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const webviewRef = useRef<any>(null);

  const mapHtml = useMemo(() => buildMapHtml(
    value?.latitude ?? DEFAULT_LAT,
    value?.longitude ?? DEFAULT_LNG,
    API_BASE,
  ), [mapKey]);

  const openModal = () => {
    setLoading(true);
    setMapKey(k => k + 1);
    setModalVisible(true);
  };

  useEffect(() => {
    if (!modalVisible) return;
    const t = setTimeout(() => setLoading(false), 6000);
    return () => clearTimeout(t);
  }, [modalVisible, mapKey]);

  const handleMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'confirm') {
        onChange({ latitude: data.lat, longitude: data.lng, address: data.address });
        setModalVisible(false);
      }
    } catch {}
  };

  return (
    <>
      <TouchableOpacity
        style={[styles.trigger, value && styles.triggerSet]}
        onPress={openModal}
        activeOpacity={0.85}
      >
        <View style={styles.triggerLeft}>
          <View style={[styles.iconWrap, value && styles.iconWrapSet]}>
            <AppIcon name="map-pin" size={18} color={value ? '#fff' : Colors.dark.tabIconDefault} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.triggerLabel, value && { color: Colors.dark.text }]}>
              {value ? 'Location set ✓' : 'Set exact location on map'}
            </Text>
            {value?.address ? (
              <Text style={styles.triggerSub} numberOfLines={1}>{value.address}</Text>
            ) : value ? (
              <Text style={styles.triggerSub}>{value.latitude.toFixed(5)}, {value.longitude.toFixed(5)}</Text>
            ) : (
              <Text style={styles.triggerHint}>Search or drag the map to pin your spot</Text>
            )}
          </View>
        </View>
        <AppIcon name={value ? 'edit-2' : 'chevron-right'} size={16} color={Colors.dark.tabIconDefault} />
      </TouchableOpacity>

      <Modal visible={modalVisible} animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <SafeAreaView style={styles.modal}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => setModalVisible(false)} style={styles.closeBtn}>
              <AppIcon name="arrow-left" size={22} color={Colors.dark.text} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Pick Location</Text>
            <View style={{ width: 40 }} />
          </View>

          <View style={{ flex: 1 }}>
            {loading && (
              <View style={styles.loadingOverlay}>
                <ActivityIndicator size="large" color={Colors.dark.tint} />
                <Text style={styles.loadingText}>Loading map…</Text>
              </View>
            )}
            <WebView
              key={mapKey}
              ref={webviewRef}
              source={{ html: mapHtml }}
              style={styles.webview}
              onMessage={handleMessage}
              onLoad={() => setLoading(false)}
              onLoadEnd={() => setLoading(false)}
              onError={() => setLoading(false)}
              onHttpError={() => setLoading(false)}
              javaScriptEnabled
              domStorageEnabled
              geolocationEnabled
              allowsInlineMediaPlayback
              mixedContentMode="always"
              originWhitelist={['*']}
            />
          </View>
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.dark.border,
    padding: 14,
    gap: 12,
  },
  triggerSet: {
    borderColor: Colors.dark.tint,
    backgroundColor: 'rgba(37,99,235,0.08)',
  },
  triggerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.dark.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapSet: {
    backgroundColor: Colors.dark.tint,
  },
  triggerLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.dark.tabIconDefault,
    marginBottom: 2,
  },
  triggerSub: {
    fontSize: 12,
    color: Colors.dark.tint,
  },
  triggerHint: {
    fontSize: 12,
    color: Colors.dark.tabIconDefault,
  },
  modal: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.border,
  },
  closeBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  webview: {
    flex: 1,
    backgroundColor: '#0A1628',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.dark.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    zIndex: 10,
  },
  loadingText: {
    color: Colors.dark.tabIconDefault,
    fontSize: 14,
  },
});
