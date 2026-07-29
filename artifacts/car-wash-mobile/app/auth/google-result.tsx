import { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { router } from 'expo-router';

/**
 * This screen exists solely to absorb the Google OAuth deep-link callback URL
 * (e.g. car-wash-mobile://auth/google-result?status=new&token=xxx).
 *
 * expo-router navigates here when the OS delivers the deep link.
 * Simultaneously, useGoogleAuth's Linking listener fires and processes the URL,
 * updating state in welcome.tsx (which stays mounted under this screen).
 *
 * We immediately navigate back so the welcome screen (already updated) becomes visible.
 */
export default function GoogleResultScreen() {
  useEffect(() => {
    const t = setTimeout(() => {
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace('/(auth)/welcome');
      }
    }, 80);
    return () => clearTimeout(t);
  }, []);

  return <View style={styles.bg} />;
}

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: '#0A1628' },
});
