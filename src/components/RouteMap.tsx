import { useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { Feather } from '@expo/vector-icons';
import type { Coords } from '../lib/location';
import { mapsUrl } from '../lib/links';
import { colors, PILL } from '../theme';

// Interim active-job map (Option B — see memory project_driver_active_map). A WebView
// + Leaflet/OSM that plots the driver relative to the CURRENT stop (merchant before
// pickup, customer after) with a ROAD-FOLLOWING route (OSRM public demo server),
// falling back to a straight dashed line if routing fails. Heavier on low-end Android
// + 2G than native maps; the PLANNED upgrade is react-native-maps + paid tiles + a
// production routing API once billing is funded. Degrades gracefully: no driver fix
// yet → centre on the stop; tiles/Leaflet/routing fail → the address card above and
// the "Open in Google Maps" CTA still carry the driver to the door.
export default function RouteMap({
  from,
  to,
  label,
}: {
  from: Coords | null;
  to: Coords;
  label: string;
}) {
  const [loading, setLoading] = useState(true);
  const html = useMemo(() => buildHtml(from, to), [from?.lat, from?.lng, to.lat, to.lng]);

  return (
    <View style={styles.wrap}>
      {/* pointerEvents none → the static map never steals scroll/touch from the parent
          ScrollView; the CTA pill is the only interactive target. */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <WebView
          style={styles.web}
          originWhitelist={['*']}
          source={{ html }}
          scrollEnabled={false}
          onLoadEnd={() => setLoading(false)}
        />
      </View>
      {loading ? (
        <View style={styles.loading} pointerEvents="none">
          <ActivityIndicator color={colors.textFaint} />
        </View>
      ) : null}
      <View style={styles.label} pointerEvents="none">
        <Text style={styles.labelText} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <Pressable style={styles.cta} onPress={() => void Linking.openURL(mapsUrl(to.lat, to.lng))}>
        <Feather name="navigation" size={16} color={colors.textPrimary} />
        <Text style={styles.ctaText}>Open in Google Maps</Text>
      </Pressable>
    </View>
  );
}

// Self-contained Leaflet page. The driver (green dot) and the stop (gold pin) are
// markers; a road-following route (fetched from OSRM, straight dashed line on failure)
// connects them and the view fits the route. With no driver fix, just centre on the
// stop. Leaflet + OSRM load over the network — a known 2G cost folded into the
// native-maps upgrade.
function buildHtml(from: Coords | null, to: Coords): string {
  const stop = [to.lat, to.lng];
  const driver = from ? [from.lat, from.lng] : null;
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>html,body,#m{height:100%;margin:0;padding:0}#m,.leaflet-container{background:#e9e6ea}</style>
</head><body><div id="m"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
(function(){
  var stop=${JSON.stringify(stop)},driver=${JSON.stringify(driver)};
  var map=L.map('m',{zoomControl:false,attributionControl:false,dragging:false,tap:false,keyboard:false,scrollWheelZoom:false,doubleClickZoom:false});
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);
  function dot(c,s,b){return L.divIcon({className:'',iconSize:[s,s],iconAnchor:[s/2,s/2],html:'<div style="width:'+s+'px;height:'+s+'px;border-radius:50%;background:'+c+';border:2px solid '+b+';box-shadow:0 1px 3px rgba(0,0,0,.45)"></div>'});}
  L.marker(stop,{icon:dot('#ffc03d',22,'#100c08')}).addTo(map);
  if(driver){
    L.marker(driver,{icon:dot('#15803d',16,'#ffffff')}).addTo(map);
    map.fitBounds([driver,stop],{padding:[42,42],maxZoom:16});
    var line=null;
    function straight(){if(!line){line=L.polyline([driver,stop],{color:'#603262',weight:3,dashArray:'6 8',opacity:0.85}).addTo(map);}}
    // Road-following route from the OSRM public demo server (free, no key — interim;
    // upgrade to a paid directions API alongside native maps). Falls back to a
    // straight dashed line if routing fails (offline / rate-limited / no route).
    var u='https://router.project-osrm.org/route/v1/driving/'+driver[1]+','+driver[0]+';'+stop[1]+','+stop[0]+'?overview=full&geometries=geojson';
    fetch(u).then(function(r){return r.ok?r.json():null;}).then(function(j){
      var g=j&&j.routes&&j.routes[0]&&j.routes[0].geometry;
      if(g&&g.coordinates&&g.coordinates.length>1){
        line=L.polyline(g.coordinates.map(function(c){return [c[1],c[0]];}),{color:'#603262',weight:4,opacity:0.9}).addTo(map);
        map.fitBounds(line.getBounds(),{padding:[42,42],maxZoom:16});
      }else{straight();}
    }).catch(function(){straight();});
  }else{
    map.setView(stop,15);
  }
})();
</script></body></html>`;
}

const styles = StyleSheet.create({
  wrap: {
    height: 170,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  web: { flex: 1, backgroundColor: 'transparent' },
  loading: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    maxWidth: '58%',
    backgroundColor: colors.surface,
    borderRadius: PILL,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  labelText: { fontSize: 12, fontWeight: '700', color: colors.textPrimary },
  cta: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: PILL,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  ctaText: { fontSize: 12, fontWeight: '700', color: colors.textPrimary },
});
