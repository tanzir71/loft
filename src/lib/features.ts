type RuntimeEnv = Record<string, string | undefined>;
type SettingsMap = Record<string, string | null | undefined>;

function present(value: string | null | undefined) {
  return Boolean(value?.trim());
}

export function hasEmail(env: RuntimeEnv = process.env) {
  return present(env.RESEND_API_KEY);
}

export function hasBlob(env: RuntimeEnv = process.env) {
  return present(env.BLOB_READ_WRITE_TOKEN);
}

export function aiEnabled(settings: SettingsMap) {
  return present(settings.ai_provider) && present(settings.ai_key_encrypted);
}
