import { forwardRef, type ReactNode } from 'react';
import { Platform, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import MapView, { Polygon, type MapPressEvent, type MapStyleElement, type Region } from 'react-native-maps';

import { colors } from '@/lib/theme';
import type { LatLng } from '@/lib/types';

// Dunkler Kartenstil für Google Maps (Android). iOS nutzt Apple Maps im Dunkelmodus.
const darkStyle: MapStyleElement[] = [
  { elementType: 'geometry', stylers: [{ color: '#0b1114' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#6f8580' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#07090b' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ visibility: 'on' }, { color: '#0d1c17' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#18242a' }] },
  { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#22323a' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#061a24' }] },
];

export const toCoord = (p: LatLng) => ({ latitude: p.lat, longitude: p.lng });

type Props = {
  initialRegion?: Region;
  area?: LatLng[] | null;
  areaColor?: string;
  onPress?: (p: LatLng) => void;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  showsUserLocation?: boolean;
  interactive?: boolean;
};

export const GameMap = forwardRef<MapView, Props>(function GameMap(
  { initialRegion, area, areaColor = colors.signal, onPress, children, style, showsUserLocation = true, interactive = true },
  ref,
) {
  return (
    <MapView
      ref={ref}
      style={[StyleSheet.absoluteFill, style]}
      initialRegion={initialRegion}
      customMapStyle={Platform.OS === 'android' ? darkStyle : undefined}
      userInterfaceStyle="dark"
      showsUserLocation={showsUserLocation}
      showsMyLocationButton={false}
      showsPointsOfInterests={false}
      showsCompass={false}
      toolbarEnabled={false}
      pitchEnabled={false}
      rotateEnabled={interactive}
      scrollEnabled={interactive}
      zoomEnabled={interactive}
      onPress={
        onPress
          ? (e: MapPressEvent) => onPress({ lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude })
          : undefined
      }>
      {area && area.length >= 3 ? (
        <Polygon
          coordinates={area.map(toCoord)}
          strokeColor={areaColor}
          strokeWidth={3}
          fillColor={`${areaColor}14`}
        />
      ) : null}
      {children}
    </MapView>
  );
});
