export function generateOtp(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

/**
 * Strips the +91 country code and returns the 10-digit Indian mobile number,
 * or returns the number as-is if it doesn't start with +91.
 */
function toFast2SmsNumber(phone: string): string {
  if (phone.startsWith("+91")) return phone.slice(3);
  if (phone.startsWith("91") && phone.length === 12) return phone.slice(2);
  return phone;
}

export async function sendOtpSms(phone: string, code: string): Promise<void> {
  const apiKey = process.env.FAST2SMS_API_KEY;

  if (!apiKey) {
    console.log(`[DEV MODE] OTP for ${phone}: ${code}`);
    return;
  }

  const number = toFast2SmsNumber(phone);

  const params = new URLSearchParams({
    authorization: apiKey,
    route: "otp",
    variables_values: code,
    flash: "0",
    numbers: number,
  });

  const url = `https://www.fast2sms.com/dev/bulkV2?${params.toString()}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "cache-control": "no-cache",
    },
  });

  const data = (await response.json()) as { return: boolean; message: string[] };

  if (!data.return) {
    const msg = Array.isArray(data.message) ? data.message.join(", ") : String(data.message);
    throw new Error(`Fast2SMS error: ${msg}`);
  }

  console.log(`[SMS] OTP sent to ${phone} via Fast2SMS`);
}
