import React from 'react';
import { TouchableOpacity, StyleSheet } from 'react-native';
import AppIcon from '@/components/AppIcon';
import { useRouter } from 'expo-router';
import { useAuth } from '@/context/AuthContext';

interface HomeButtonProps {
  style?: object;
  color?: string;
  size?: number;
}

export default function HomeButton({ style, color = '#E2E8F0', size = 22 }: HomeButtonProps) {
  const router = useRouter();
  const { user } = useAuth();

  const handlePress = () => {
    if (user) {
      router.replace('/(tabs)');
    } else {
      router.replace('/(auth)/welcome');
    }
  };

  return (
    <TouchableOpacity
      style={[styles.btn, style]}
      onPress={handlePress}
      activeOpacity={0.7}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
    >
      <AppIcon name="home" size={size} color={color} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: 'rgba(37,99,235,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
