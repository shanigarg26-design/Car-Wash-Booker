import { Platform } from 'react-native';

export const LOCATION_TASK_NAME = 'carcleanpro-cleaner-location';

// Register the background location task (must be called at module level, not inside a component)
// This file is imported once at app startup in _layout.tsx
if (Platform.OS !== 'web') {
  let TaskManager: typeof import('expo-task-manager') | null = null;
  let Location: typeof import('expo-location') | null = null;

  try {
    TaskManager = require('expo-task-manager');
    Location = require('expo-location');
  } catch {
    // Not available in web or Expo Go limitations
  }

  if (TaskManager && !TaskManager.isTaskDefined(LOCATION_TASK_NAME)) {
    TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }: any) => {
      if (error) {
        console.log('[BgLocation] Task error:', error.message);
        return;
      }

      const locations = data?.locations as Array<{ coords: { latitude: number; longitude: number } }> | undefined;
      if (!locations || locations.length === 0) return;

      const { latitude, longitude } = locations[locations.length - 1].coords;

      try {
        const BASE_URL = process.env.EXPO_PUBLIC_API_BASE || '';
        await fetch(`${BASE_URL}/api/users/me/location`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ latitude, longitude }),
        });
      } catch (err) {
        console.log('[BgLocation] Failed to send location:', err);
      }
    });
  }
}
