/**
 * Shared Push Notification Service
 * Fire-and-forget push helper used by any service that needs to send alerts.
 * Supports Expo Push API. Failures are non-critical and only log a warning.
 */
export async function sendPush(
  pushTokens: string | string[],
  title: string,
  body: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  const tokens = (Array.isArray(pushTokens) ? pushTokens : [pushTokens])
    .filter(t => t && t.startsWith("ExponentPushToken"));

  if (tokens.length === 0) return;

  const messages = tokens.map(token => ({
    to: token,
    title,
    body,
    data,
    sound: "default",
    priority: "high",
  }));

  try {
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Accept-Encoding": "gzip, deflate",
      },
      body: JSON.stringify(messages),
    });
  } catch (err) {
    console.warn("[Push] Failed to send Expo notification:", err);
  }
}
