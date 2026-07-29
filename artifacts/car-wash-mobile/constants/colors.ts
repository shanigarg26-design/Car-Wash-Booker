const tintColorLight = "#2563EB"; // electric blue
const tintColorDark = "#2563EB";

export default {
  light: {
    text: "#0A1628", // deep navy for text in light mode
    background: "#F3F4F6", // soft gray background
    card: "#FFFFFF",
    tint: tintColorLight,
    tabIconDefault: "#9CA3AF",
    tabIconSelected: tintColorLight,
    border: "#E5E7EB",
    error: "#EF4444",
    success: "#10B981",
    warning: "#F59E0B",
  },
  dark: {
    text: "#FFFFFF",
    background: "#0A1628", // deep navy
    card: "#1E293B",
    tint: tintColorDark,
    tabIconDefault: "#64748B",
    tabIconSelected: tintColorDark,
    border: "#334155",
    error: "#EF4444",
    success: "#10B981",
    warning: "#F59E0B",
  },
};
