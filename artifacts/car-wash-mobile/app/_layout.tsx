import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, usePathname } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { DevSettings, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import AppIcon from "@/components/AppIcon";
import { BUILD_TAG } from "@/constants/build";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import HomeButton from "@/components/HomeButton";
import { usePushToken } from "@/hooks/usePushToken";
// Must be imported at module level so the background task is registered before any component mounts
import "@/tasks/locationTask";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function DevReloadButton() {
  if (!__DEV__) return null;

  const handleReload = () => {
    if (Platform.OS === 'web') {
      // @ts-ignore
      window.location.reload();
    } else {
      DevSettings.reload();
    }
  };

  return (
    <View style={devStyles.wrap} pointerEvents="box-none">
      <TouchableOpacity style={devStyles.btn} onPress={handleReload} activeOpacity={0.8}>
        <AppIcon name="refresh-cw" size={18} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

const devStyles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    bottom: 90,
    right: 16,
    zIndex: 9999,
  },
  btn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(37,99,235,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 6,
  },
});

function GlobalHomeButton() {
  const pathname = usePathname();
  // Hide on the welcome/login page itself and inside the tab bar (tabs have their own home tab)
  const hidden =
    pathname === '/(auth)/welcome' ||
    pathname === '/welcome' ||
    pathname.startsWith('/(tabs)');
  if (hidden) return null;

  return (
    <View style={globalHomeStyles.wrap} pointerEvents="box-none">
      <HomeButton
        style={globalHomeStyles.btn}
        color="#E2E8F0"
        size={20}
      />
    </View>
  );
}

const globalHomeStyles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    bottom: 144,
    right: 16,
    zIndex: 9999,
  },
  btn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(37,99,235,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 6,
  },
});

// Global build stamp — shows on EVERY screen (incl. login) so you can confirm at a
// glance that the newest bundle is running on Appetize / the phone.
function GlobalBuildStamp() {
  return (
    <View style={buildStampStyles.wrap} pointerEvents="none">
      <Text style={buildStampStyles.text}>build · {BUILD_TAG}</Text>
    </View>
  );
}
const buildStampStyles = StyleSheet.create({
  wrap: { position: 'absolute', bottom: 4, left: 10, zIndex: 99999 },
  text: { color: '#94A3B8', opacity: 0.7, fontSize: 10 },
});

// Registers Expo push token after login and handles notification taps
function PushTokenManager() {
  const { user } = useAuth();
  usePushToken(user?.id);
  return null;
}

function RootLayoutNav() {
  return (
    <>
      <PushTokenManager />
      <Stack screenOptions={{ headerShown: false, headerBackTitle: "Back" }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="book/index" options={{ presentation: 'modal' }} />
        <Stack.Screen name="book/[cleanerId]" options={{ presentation: 'modal' }} />
        <Stack.Screen name="booking/[id]" />
        <Stack.Screen name="cleaner/[id]" />
        <Stack.Screen name="public-rates" options={{ presentation: 'modal' }} />
        <Stack.Screen name="feedback/[bookingId]" />
        <Stack.Screen name="history/index" />
        <Stack.Screen name="auth/google-result" options={{ animation: 'none' }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError && Platform.OS !== 'web') return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <GestureHandlerRootView style={{ flex: 1 }}>
              <RootLayoutNav />
              <GlobalHomeButton />
              <DevReloadButton />
              <GlobalBuildStamp />
            </GestureHandlerRootView>
          </AuthProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
