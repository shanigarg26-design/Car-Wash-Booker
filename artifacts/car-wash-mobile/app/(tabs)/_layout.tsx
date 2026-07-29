import { BlurView } from "expo-blur";
import { Tabs } from "expo-router";
import { SymbolView } from "expo-symbols";
import AppIcon from "@/components/AppIcon";
import React from "react";
import { Platform, StyleSheet, View } from "react-native";

import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";

export default function TabLayout() {
  const { user } = useAuth();
  const role = user?.role || 'customer';
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors.dark.tint,
        tabBarInactiveTintColor: Colors.dark.tabIconDefault,
        headerShown: false,
        tabBarStyle: {
          position: "absolute",
          backgroundColor: isIOS ? "transparent" : Colors.dark.card,
          borderTopWidth: isWeb ? 1 : 0,
          borderTopColor: Colors.dark.border,
          elevation: 0,
          ...(isWeb ? { height: 84 } : {}),
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={100}
              tint="dark"
              style={StyleSheet.absoluteFill}
            />
          ) : (
            <View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: Colors.dark.card },
              ]}
            />
          ),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="house" tintColor={color} size={24} />
            ) : (
              <AppIcon name="home" size={22} color={color} />
            ),
        }}
      />

      <Tabs.Screen
        name="cleaners"
        options={{
          title: "Cleaners",
          href: role === 'customer' ? '/(tabs)/cleaners' : null,
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="drop" tintColor={color} size={24} />
            ) : (
              <AppIcon name="droplet" size={22} color={color} />
            ),
        }}
      />

      <Tabs.Screen
        name="bookings"
        options={{
          title: "Bookings",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="calendar" tintColor={color} size={24} />
            ) : (
              <AppIcon name="calendar" size={22} color={color} />
            ),
        }}
      />

      <Tabs.Screen
        name="rates"
        options={{
          title: "Rates",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="tag" tintColor={color} size={24} />
            ) : (
              <AppIcon name="tag" size={22} color={color} />
            ),
        }}
      />

      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="person" tintColor={color} size={24} />
            ) : (
              <AppIcon name="user" size={22} color={color} />
            ),
        }}
      />
    </Tabs>
  );
}
