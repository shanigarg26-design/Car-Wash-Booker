import React, {
  useState, useRef, useMemo, useEffect, forwardRef, useImperativeHandle,
} from 'react';
import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import Colors from '@/constants/colors';

export interface PickedLocation {
  latitude: number;
  longitude: number;
  address?: string;
}

export interface MapPickerViewRef {
  panTo: (lat: number, lng: number) => void;
}

interface MapPickerViewProps {
  initialLocation: PickedLocation | null;
  onLocationChange: (loc: PickedLocation) => void;
  onRequestLocation?: () => void;
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
.search-results{margin-top:5px;background:#fff;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.3);overflow:hidden;max-height:200px;overflow-y:auto}
.result-item{padding:12px 16px;border-bottom:1px solid #f0f0f0;cursor:pointer}
.result-item:last-child{border-bottom:none}
.result-item:active{background:#f0f4ff}
.result-name{font-size:14px;font-weight:600;color:#111}
.result-sub{font-size:12px;color:#888;margin-top:2px}
.locate-btn{position:absolute;bottom:118px;right:12px;z-index:1000;background:#2563EB;border:none;border-radius:50%;width:44px;height:44px;box-shadow:0 2px 12px rgba(37,99,235,0.4);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:opacity .15s}
.locate-btn:active{opacity:.75}
.locate-btn.locating{opacity:.6}
.footer{position:absolute;bottom:0;left:0;right:0;height:108px;background:#0A1628;padding:10px 16px 14px;z-index:1000;border-top:1px solid rgba(255,255,255,0.09)}
.addr-label{color:#6B7280;font-size:10px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;margin-bottom:3px}
.addr-value{color:#fff;font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:8px;min-height:18px}
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
<button class="locate-btn" id="locateBtn" title="Use my location">
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="8" stroke-opacity=".5"/></svg>
</button>
<div class="footer">
  <div class="addr-label">Selected Location</div>
  <div class="addr-value" id="addrDisplay">Move the map to pin your location</div>
</div>
<script>
var initLat=${lat}, initLng=${lng};
var currentLat=initLat, currentLng=initLng;
var currentAddress='';
var searchTimer;
var locating=false;

var map=L.map('map',{zoomControl:false,attributionControl:false}).setView([initLat,initLng],16);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);

var pin=document.getElementById('pin');
var addrDisplay=document.getElementById('addrDisplay');
var locateBtn=document.getElementById('locateBtn');

function sendMsg(data){
  var s=JSON.stringify(data);
  if(window.ReactNativeWebView){window.ReactNativeWebView.postMessage(s);}
  else{window.parent.postMessage(s,'*');}
}

map.on('movestart',function(){pin.classList.add('lifting');addrDisplay.textContent='Moving…';});
map.on('moveend',function(){
  pin.classList.remove('lifting');
  var c=map.getCenter();
  currentLat=c.lat;currentLng=c.lng;
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
      sendMsg({type:'locationChange',lat:currentLat,lng:currentLng,address:currentAddress});
    })
    .catch(function(){
      currentAddress=la.toFixed(5)+', '+lo.toFixed(5);
      addrDisplay.textContent=currentAddress;
      sendMsg({type:'locationChange',lat:currentLat,lng:currentLng,address:currentAddress});
    });
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
          searchResults.innerHTML='<div class="result-item" style="color:#999;font-size:13px;text-align:center;">No results. Try a broader search.</div>';
          searchResults.style.display='block';return;
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
            addrDisplay.textContent=name+(sub?', '+sub:'');
            searchResults.style.display='none';
            sendMsg({type:'locationChange',lat:parseFloat(item.lat),lng:parseFloat(item.lon),address:item.display_name});
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
  searchInput.value='';clearBtn.style.display='none';
  searchResults.style.display='none';searchInput.focus();
});

// On native, try GPS directly; if blocked send requestLocation to parent
locateBtn.addEventListener('click',function(){
  if(locating)return;
  locating=true;
  locateBtn.classList.add('locating');
  if(navigator.geolocation){
    navigator.geolocation.getCurrentPosition(
      function(p){
        locating=false;locateBtn.classList.remove('locating');
        map.setView([p.coords.latitude,p.coords.longitude],17);
      },
      function(){
        // GPS unavailable — ask parent React layer
        sendMsg({type:'requestLocation'});
      },
      {timeout:6000,enableHighAccuracy:true,maximumAge:0}
    );
  } else {
    sendMsg({type:'requestLocation'});
  }
  setTimeout(function(){
    if(locating){locating=false;locateBtn.classList.remove('locating');}
  },10000);
});

// Listen for panTo commands from parent
window.addEventListener('message',function(e){
  try{
    var d=JSON.parse(e.data);
    if(d.type==='panTo'){
      map.setView([d.lat,d.lng],17);
      reverseGeocode(d.lat,d.lng);
      locating=false;locateBtn.classList.remove('locating');
    }
  }catch(ex){}
});

// Also support ReactNativeWebView injection
document.addEventListener('message',function(e){
  try{
    var d=JSON.parse(e.data);
    if(d.type==='panTo'){
      map.setView([d.lat,d.lng],17);
      reverseGeocode(d.lat,d.lng);
      locating=false;locateBtn.classList.remove('locating');
    }
  }catch(ex){}
});

reverseGeocode(initLat,initLng);

// Native: auto-center on GPS when map opens
if(navigator.geolocation){
  navigator.geolocation.getCurrentPosition(
    function(p){map.setView([p.coords.latitude,p.coords.longitude],17);},
    function(){},
    {timeout:8000,maximumAge:60000,enableHighAccuracy:true}
  );
}
</script>
</body>
</html>`;
}

const MapPickerView = forwardRef<MapPickerViewRef, MapPickerViewProps>(
  function MapPickerView({ initialLocation, onLocationChange, onRequestLocation }, ref) {
    const [loading, setLoading] = useState(true);
    const [mapKey] = useState(() => Date.now());
    const webviewRef = useRef<any>(null);
    const onRequestLocationRef = useRef(onRequestLocation);

    useEffect(() => { onRequestLocationRef.current = onRequestLocation; }, [onRequestLocation]);

    useImperativeHandle(ref, () => ({
      panTo: (lat: number, lng: number) => {
        // Directly call the global map variable and reverseGeocode function
        // that are defined in the WebView's HTML. This is more reliable than
        // dispatching a MessageEvent which can silently fail in Android WebViews.
        const js = `
          (function() {
            try {
              if (typeof map !== 'undefined') {
                map.setView([${lat}, ${lng}], 17);
              }
              if (typeof reverseGeocode === 'function') {
                reverseGeocode(${lat}, ${lng});
              }
              if (typeof locating !== 'undefined') { locating = false; }
              var lb = document.getElementById('locateBtn');
              if (lb) {
                lb.classList.remove('locating');
                lb.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="8" stroke-opacity=".5"/></svg>';
              }
            } catch(e) {}
          })();
          true;
        `;
        webviewRef.current?.injectJavaScript(js);
      },
    }));

    const mapHtml = useMemo(() => buildMapHtml(
      initialLocation?.latitude ?? DEFAULT_LAT,
      initialLocation?.longitude ?? DEFAULT_LNG,
      API_BASE,
    ), [mapKey]);

    useEffect(() => {
      const t = setTimeout(() => setLoading(false), 6000);
      return () => clearTimeout(t);
    }, []);

    const handleMessage = (event: any) => {
      try {
        const data = JSON.parse(event.nativeEvent.data);
        if (data.type === 'locationChange') {
          onLocationChange({ latitude: data.lat, longitude: data.lng, address: data.address });
        } else if (data.type === 'requestLocation') {
          onRequestLocationRef.current?.();
        }
      } catch {}
    };

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
          androidLayerType="hardware"
        />
      </View>
    );
  }
);

export default MapPickerView;

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
