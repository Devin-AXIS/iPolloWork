export const SPEECH_INPUT_PROVIDERS = ["auto", "openai", "aliyun-bailian", "baidu-speech"] as const;

export type SpeechInputProvider = (typeof SPEECH_INPUT_PROVIDERS)[number];

const SPEECH_INPUT_PROVIDER_STORAGE_KEY = "ipollowork.speechInputProvider";

function isSpeechInputProvider(value: string): value is SpeechInputProvider {
  return SPEECH_INPUT_PROVIDERS.includes(value as SpeechInputProvider);
}

export function getSpeechInputProvider(): SpeechInputProvider {
  if (typeof window === "undefined") return "auto";
  const stored = window.localStorage.getItem(SPEECH_INPUT_PROVIDER_STORAGE_KEY)?.trim() ?? "";
  return isSpeechInputProvider(stored) ? stored : "auto";
}

export function setSpeechInputProvider(provider: SpeechInputProvider) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SPEECH_INPUT_PROVIDER_STORAGE_KEY, provider);
}
