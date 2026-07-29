import { useEffect, useRef, useState } from 'react';
import { Platform, Linking } from 'react-native';
import { LOCATION_TASK_NAME } from '@/tasks/locationTask';
import { apiFetch } from '@/api/client';

let Location: typeof import('expo-location') | null = null;
if (Platform.OS !== 'web') {
  try {
    Location = require('expo-location');
  } catch {
    Location = null;
  }
}

async function stopBackgroundTracking() {
  if (!Location) return;
  try {
    const isRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
    if (isRunning) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
    }
  } catch (err) {
    console.log('[Location] Stop error:', err);
  }
}

export async function pushCurrentLocation() {
  if (!Location) return;
  try {
    const { coords } = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    await apiFetch('/api/users/me/location', {
      method: 'PATCH',
      body: JSON.stringify({ latitude: coords.latitude, longitude: coords.longitude }),
    });
    console.log('[Location] Pushed:', coords.latitude, coords.longitude);
  } catch (err) {
    console.log('[Location] Push failed:', err);
  }
}

async function startBackgroundTracking() {
  if (!Location) return;

  const { status: fg } = await Location.requestForegroundPermissionsAsync();
  if (fg !== 'granted') return;

  await pushCurrentLocation();

  const { status: bg } = await Location.requestBackgroundPermissionsAsync();
  if (bg !== 'granted') return;

  const isAlreadyRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
  if (!isAlreadyRunning) {
    await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: 20_000,      // push every 20 s in background
      distanceInterval: 20,      // or every 20 m of movement
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'CarCleanPro — You are Online',
        notificationBody: 'Receiving car cleaning bookings near you.',
        notificationColor: '#3B82F6',
      },
      pausesUpdatesAutomatically: false,
    });
  }
}

export type LocationStatus = 'checking' | 'granted' | 'denied';

export function useWasherLocation(isOnline: boolean): {
  locationStatus: LocationStatus;
  requestPermission: () => Promise<void>;
} {
  const [locationStatus, setLocationStatus] = useState<LocationStatus>(
    Platform.OS === 'web' ? 'granted' : 'checking'
  );
  const prevOnlineRef = useRef<boolean | null>(null);

  const requestPermission = async () => {
    if (Platform.OS === 'web' || !Location) return;
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status === 'granted') {
      setLocationStatus('granted');
      pushCurrentLocation().catch(() => {});
    } else {
      Linking.openSettings();
    }
  };

  // Immediately check / request permission on mount and push initial coords to backend
  useEffect(() => {
    if (Platform.OS === 'web' || !Location) return;

    (async () => {
      // Check current permission without prompting first
      const { status: current } = await Location.getForegroundPermissionsAsync();

      if (current === 'granted') {
        setLocationStatus('granted');
        // Push location right away so backend has fresh coords before washer goes online
        pushCurrentLocation().catch(() => {});
        return;
      }

      if (current === 'denied') {
        // Already permanently denied — user must open Settings manually
        setLocationStatus('denied');
        return;
      }

      // 'undetermined' — ask now
      const { status: asked } = await Location.requestForegroundPermissionsAsync();
      if (asked === 'granted') {
        setLocationStatus('granted');
        pushCurrentLocation().catch(() => {});
      } else {
        setLocationStatus('denied');
      }
    })();
  }, []);

  // Start / stop background tracking when washer toggles online state
  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (locationStatus !== 'granted') return;
    if (prevOnlineRef.current === isOnline) return;
    prevOnlineRef.current = isOnline;

    if (isOnline) {
      startBackgroundTracking();
    } else {
      stopBackgroundTracking();
    }
  }, [isOnline, locationStatus]);

  // Foreground heartbeat: push location every 15 s while online & app is active
  // This keeps the server position fresh even when the background task is throttled
  useEffect(() => {
    if (Platform.OS === 'web' || !isOnline || locationStatus !== 'granted') return;
    const interval = setInterval(() => {
      pushCurrentLocation().catch(() => {});
    }, 15_000);
    return () => clearInterval(interval);
  }, [isOnline, locationStatus]);

  // Stop tracking on unmount
  useEffect(() => {
    return () => {
      if (Platform.OS === 'web') return;
      stopBackgroundTracking();
    };
  }, []);

  return { locationStatus, requestPermission };
}
