import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import Colors from '@/constants/colors';

export default function Index() {
  const { user, isLoading } = useAuth();

  // While auth is resolving, show the loader.
  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.dark.background }}>
        <ActivityIndicator size="large" color={Colors.dark.tint} />
      </View>
    );
  }

  // Declarative redirect — fires reliably once the router is mounted, unlike an
  // imperative router.replace() in an effect which can be dropped on first load
  // (that's what left the app stuck on the spinner until a manual reload).
  return <Redirect href={user ? '/(tabs)' : '/(auth)/welcome'} />;
}
