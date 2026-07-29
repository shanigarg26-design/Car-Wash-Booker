import React from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ScrollViewProps,
} from "react-native";

// Expo Go compatible: uses a plain ScrollView inside a KeyboardAvoidingView.
// (Previously used react-native-keyboard-controller, which isn't available in Expo Go.)
type Props = ScrollViewProps & {
  children?: React.ReactNode;
  // tolerate any extra props previously passed to the keyboard-controller version
  [key: string]: any;
};

export function KeyboardAwareScrollViewCompat({
  children,
  keyboardShouldPersistTaps = "handled",
  contentContainerStyle,
  style,
  ...props
}: Props) {
  return (
    <KeyboardAvoidingView
      style={[{ flex: 1 }, style]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        contentContainerStyle={contentContainerStyle}
        {...props}
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
