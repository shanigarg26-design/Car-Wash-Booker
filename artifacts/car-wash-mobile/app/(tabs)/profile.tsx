import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, ActivityIndicator, Image } from 'react-native';
import { useAuth } from '@/context/AuthContext';
import Colors from '@/constants/colors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppIcon from '@/components/AppIcon';
import HomeButton from '@/components/HomeButton';
import * as ImagePicker from 'expo-image-picker';
import { BASE_URL } from '@/api/client';
import { useRouter } from 'expo-router';

export default function ProfileScreen() {
  const { user, signOut, updateUser } = useAuth();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [uploading, setUploading] = useState(false);

  if (!user) return null;

  const pickAndUploadAvatar = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Please allow access to your photo library to update your profile picture.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });

    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    const filename = asset.uri.split('/').pop() || 'avatar.jpg';
    const type = asset.mimeType || 'image/jpeg';

    const formData = new FormData();
    formData.append('avatar', { uri: asset.uri, name: filename, type } as any);

    try {
      setUploading(true);
      const res = await fetch(`${BASE_URL}/api/users/avatar`, {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Upload failed');
      const data = await res.json();
      updateUser({ avatarUrl: data.avatarUrl });
    } catch (e: any) {
      Alert.alert('Upload Failed', e.message || 'Could not upload image. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const avatarSource = user.avatarUrl ? { uri: `${BASE_URL}${user.avatarUrl}` } : null;

  return (
    <ScrollView style={[styles.container, { paddingTop: insets.top }]} contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}>
      <View style={styles.header}>
        <View style={styles.profileNavRow}>
          <HomeButton />
        </View>

        <TouchableOpacity onPress={pickAndUploadAvatar} style={styles.avatarWrapper} disabled={uploading}>
          {avatarSource ? (
            <Image source={avatarSource} style={styles.avatarImage} />
          ) : (
            <View style={styles.avatarContainer}>
              <Text style={styles.avatarText}>{user.name[0].toUpperCase()}</Text>
            </View>
          )}
          <View style={styles.cameraOverlay}>
            {uploading
              ? <ActivityIndicator size="small" color="#FFF" />
              : <AppIcon name="edit-2" size={14} color="#FFF" />}
          </View>
        </TouchableOpacity>

        <Text style={styles.name}>{user.name}</Text>
        <View style={styles.roleBadge}>
          <Text style={styles.roleText}>{user.role.toUpperCase()}</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account Details</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <AppIcon name="mail" size={20} color={Colors.dark.tabIconDefault} />
            <Text style={styles.rowText}>{user.email || 'No email'}</Text>
          </View>
          {user.phone && (
            <>
              <View style={styles.divider} />
              <View style={styles.row}>
                <AppIcon name="phone" size={20} color={Colors.dark.tabIconDefault} />
                <Text style={styles.rowText}>{user.phone}</Text>
              </View>
            </>
          )}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Activity</Text>
        <View style={styles.card}>
          <TouchableOpacity style={styles.menuRow} onPress={() => router.push('/history' as any)} activeOpacity={0.7}>
            <View style={[styles.menuIconBox, { backgroundColor: 'rgba(37, 99, 235, 0.15)' }]}>
              <AppIcon name="clock" size={18} color={Colors.dark.tint} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.menuLabel}>Booking History</Text>
              <Text style={styles.menuSub}>View all past {user.role === 'cleaner' ? 'jobs' : 'bookings'}</Text>
            </View>
            <AppIcon name="chevron-right" size={18} color={Colors.dark.tabIconDefault} />
          </TouchableOpacity>
        </View>
      </View>

      <TouchableOpacity style={styles.logoutBtn} onPress={signOut}>
        <AppIcon name="log-out" size={20} color={Colors.dark.error} />
        <Text style={styles.logoutText}>Log Out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  header: {
    alignItems: 'center',
    padding: 32,
  },
  profileNavRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'flex-start',
    marginBottom: 16,
  },
  avatarWrapper: {
    position: 'relative',
    marginBottom: 16,
  },
  avatarImage: {
    width: 90,
    height: 90,
    borderRadius: 45,
    borderWidth: 3,
    borderColor: Colors.dark.tint,
  },
  avatarContainer: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: Colors.dark.tint,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#FFF',
  },
  cameraOverlay: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.dark.tint,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: Colors.dark.background,
  },
  name: {
    fontSize: 24,
    fontWeight: 'bold',
    color: Colors.dark.text,
    marginBottom: 8,
  },
  roleBadge: {
    backgroundColor: 'rgba(37, 99, 235, 0.2)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 16,
  },
  roleText: {
    color: Colors.dark.tint,
    fontWeight: 'bold',
    fontSize: 12,
  },
  section: {
    paddingHorizontal: 20,
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.dark.text,
    marginBottom: 12,
  },
  card: {
    backgroundColor: Colors.dark.card,
    borderRadius: 16,
    padding: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowText: {
    color: Colors.dark.text,
    fontSize: 16,
    flex: 1,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.dark.border,
    marginVertical: 12,
  },
  menuRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 4,
  },
  menuIconBox: {
    width: 38, height: 38, borderRadius: 10,
    justifyContent: 'center', alignItems: 'center',
  },
  menuLabel: {
    color: Colors.dark.text, fontSize: 15, fontWeight: '600',
  },
  menuSub: {
    color: Colors.dark.tabIconDefault, fontSize: 12, marginTop: 1,
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 20,
    marginTop: 20,
    padding: 16,
    borderRadius: 16,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    gap: 8,
  },
  logoutText: {
    color: Colors.dark.error,
    fontWeight: 'bold',
    fontSize: 16,
  },
});
