import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, FlatList,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/api/client';
import AppIcon from '@/components/AppIcon';
import Colors from '@/constants/colors';

export default function ChatScreen() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const listRef = useRef<FlatList>(null);
  const [text, setText] = useState('');

  const { data: messages, isLoading } = useQuery({
    queryKey: ['messages', bookingId],
    queryFn: () => apiFetch(`/api/bookings/${bookingId}/messages`),
    refetchInterval: 3000,
    enabled: !!bookingId,
  });

  const sendMutation = useMutation({
    mutationFn: (body: string) => apiFetch(`/api/bookings/${bookingId}/messages`, {
      method: 'POST', body: JSON.stringify({ text: body }),
    }),
    onSuccess: () => { setText(''); qc.invalidateQueries({ queryKey: ['messages', bookingId] }); },
  });

  useEffect(() => {
    if (messages?.length) setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
  }, [messages?.length]);

  const send = () => {
    const t = text.trim();
    if (t && !sendMutation.isPending) sendMutation.mutate(t);
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <AppIcon name="arrow-left" size={24} color={Colors.dark.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Chat</Text>
        <View style={{ width: 32 }} />
      </View>

      {isLoading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={Colors.dark.tint} />
      ) : (
        <FlatList
          ref={listRef}
          data={messages ?? []}
          keyExtractor={(m: any) => String(m.id)}
          contentContainerStyle={{ padding: 16, gap: 8 }}
          ListEmptyComponent={<Text style={styles.empty}>No messages yet. Say hello 👋</Text>}
          renderItem={({ item }: { item: any }) => (
            <View style={[styles.bubble, item.mine ? styles.bubbleMine : styles.bubbleTheirs]}>
              <Text style={[styles.bubbleText, item.mine && { color: '#FFF' }]}>{item.text}</Text>
            </View>
          )}
        />
      )}

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder="Type a message…"
            placeholderTextColor={Colors.dark.tabIconDefault}
            multiline
            onSubmitEditing={send}
          />
          <TouchableOpacity style={styles.sendBtn} onPress={send} disabled={!text.trim() || sendMutation.isPending}>
            {sendMutation.isPending
              ? <ActivityIndicator color="#FFF" size="small" />
              : <AppIcon name="send" size={20} color="#FFF" />}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.dark.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.dark.border,
  },
  backBtn: { width: 32, height: 32, justifyContent: 'center' },
  headerTitle: { color: Colors.dark.text, fontSize: 18, fontWeight: '700' },
  empty: { color: Colors.dark.tabIconDefault, textAlign: 'center', marginTop: 60 },
  bubble: { maxWidth: '78%', paddingVertical: 9, paddingHorizontal: 13, borderRadius: 16 },
  bubbleMine: { alignSelf: 'flex-end', backgroundColor: Colors.dark.tint, borderBottomRightRadius: 4 },
  bubbleTheirs: { alignSelf: 'flex-start', backgroundColor: Colors.dark.card, borderBottomLeftRadius: 4 },
  bubbleText: { color: Colors.dark.text, fontSize: 15, lineHeight: 20 },
  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 10,
    borderTopWidth: 1, borderTopColor: Colors.dark.border, backgroundColor: Colors.dark.background,
  },
  input: {
    flex: 1, maxHeight: 120, backgroundColor: Colors.dark.card, borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 10, color: Colors.dark.text, fontSize: 15,
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.dark.tint,
    justifyContent: 'center', alignItems: 'center',
  },
});
