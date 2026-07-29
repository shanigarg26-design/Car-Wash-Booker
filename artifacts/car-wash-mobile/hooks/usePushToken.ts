import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { apiFetch } from '@/api/client';

// Dynamically import expo-notifications only on native (not available on web)
// Wrapped in try/catch because Expo Go on Android SDK 53+ removed remote push support
let Notifications: typeof import('expo-notifications') | null = null;
if (Platform.OS !== 'web') {
  try {
    Notifications = require('expo-notifications');
  } catch {
    Notifications = null;
  }
}

export function usePushToken(userId: number | undefined) {
  const router = useRouter();
  const registeredRef = useRef(false);

  useEffect(() => {
    if (Platform.OS === 'web' || !userId || registeredRef.current) return;
    registeredRef.current = true;

    async function register() {
      if (!Notifications) return;
      try {
        const { status: existing } = await Notifications.getPermissionsAsync();
        let finalStatus = existing;
        if (existing !== 'granted') {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }
        if (finalStatus !== 'granted') {
          console.log('[Push] Permission not granted');
          return;
        }

        const tokenData = await Notifications.getExpoPushTokenAsync();
        const token = tokenData.data;
        console.log('[Push] Token:', token);

        await apiFetch('/api/auth/push-token', {
          method: 'POST',
          body: JSON.stringify({ token }),
        });
      } catch (err) {
        console.log('[Push] Could not register:', err);
      }
    }

    register();
  }, [userId]);

  useEffect(() => {
    if (Platform.OS === 'web' || !Notifications) return;

    // Handle notification taps (background/killed state)
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown>;
      if (data?.type === 'new_booking' && data?.bookingId) {
        router.push(`/booking/${data.bookingId}` as any);
      }
    });

    // Configure foreground notifications to show banner + sound
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });

    return () => sub.remove();
  }, []);
}
