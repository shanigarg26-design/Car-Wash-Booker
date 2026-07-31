import { useEffect, useState } from 'react';
import { ActivityIndicator, View, Text } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import Colors from '@/constants/colors';

export default function Index() {
  const { user, isLoading } = useAuth();
  const [showSlowMsg, setShowSlowMsg] = useState(false);

  // If loading drags on, it's the free-tier server waking up — tell the user so
  // the wait doesn't look like a frozen app.
  useEffect(() => {
    if (!isLoading) { setShowSlowMsg(false); return; }
    const t = setTimeout(() => setShowSlowMsg(true), 4000);
    return () => clearTimeout(t);
  }, [isLoading]);

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.dark.background, paddingHorizontal: 40 }}>
        <ActivityIndicator size="large" color={Colors.dark.tint} />
        {showSlowMsg && (
          <Text style={{ color: Colors.dark.tabIconDefault, fontSize: 14, textAlign: 'center', marginTop: 20, lineHeight: 20 }}>
            Waking up the server…{'\n'}The first open after a while can take up to a minute.
          </Text>
        )}
      </View>
    );
  }

  // Declarative redirect — fires reliably once the router is mounted, unlike an
  // imperative router.replace() in an effect which can be dropped on first load.
  return <Redirect href={user ? '/(tabs)' : '/(auth)/welcome'} />;
}
