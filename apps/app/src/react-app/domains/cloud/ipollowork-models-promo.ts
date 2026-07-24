import { INFERENCE_MODEL_ALIASES } from "@ipollowork/types/den/inference";

import {
  buildDenAuthUrl,
  getDenInferenceUrl,
  readDenBootstrapConfig,
  readDenSettings,
} from "../../../app/lib/den";

export const IPOLLOWORK_MODELS_PROVIDER_ID = "ipollowork";
export const IPOLLOWORK_MODELS_PROVIDER_NAME = "iPolloWork Models";
export const IPOLLOWORK_MODELS_PROMO_HIDDEN_KEY = "ipollowork.ipolloworkModelsPromo.hidden";
export const IPOLLOWORK_MODELS_PROMO_LAST_SHOWN_KEY = "ipollowork.ipolloworkModelsPromo.lastShownAt";
export const IPOLLOWORK_MODELS_STARTUP_PROMO_SHOWN_KEY = "ipollowork.ipolloworkModelsPromo.startupShown";
export const iPolloWorkModelsPromoChangedEvent = "ipollowork-ipollowork-models-promo-changed";
export const IPOLLOWORK_MODELS_PROMO_SHOW_DELAY_MS = 4_000;
export const IPOLLOWORK_MODELS_PROMO_VISIBLE_MS = 14_000;
export const IPOLLOWORK_MODELS_PROMO_REPEAT_MS = 6 * 60 * 60 * 1000;

export function areiPolloWorkModelsPromosDisabled() {
  return /^(1|true|yes|on)$/i.test(String(import.meta.env.VITE_DISABLE_IPOLLOWORK_MODELS ?? "").trim());
}

export type iPolloWorkModelPreview = {
  id: string;
  title: string;
  subtitle: string;
};

export const IPOLLOWORK_MODEL_PREVIEWS: iPolloWorkModelPreview[] = Object.entries(
  INFERENCE_MODEL_ALIASES,
)
  .filter(([, model]) => model.enabled)
  .map(([id, model]) => ({
    id,
    title: model.displayName.replace(/^iPolloWork:\s*/, ""),
    subtitle: "iPolloWork hosted",
  }));

export function hasiPolloWorkModelsProvider(providerIds: readonly string[]) {
  return providerIds.some((id) => id.trim().toLowerCase() === IPOLLOWORK_MODELS_PROVIDER_ID);
}

export function getiPolloWorkModelsActionUrl(
  isSignedIn: boolean,
  authMode: "sign-in" | "sign-up" = "sign-in",
) {
  const settings = readDenSettings();
  const baseUrl = settings.baseUrl || readDenBootstrapConfig().baseUrl;
  // Signed-in users go straight to the iPolloWork Models page — the value-prop
  // + subscribe surface — never to a bare auth or billing page.
  return isSignedIn ? getDenInferenceUrl(baseUrl) : buildDenAuthUrl(baseUrl, authMode);
}

export function isiPolloWorkModelsPromoHidden() {
  if (areiPolloWorkModelsPromosDisabled()) return true;
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(IPOLLOWORK_MODELS_PROMO_HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function hideiPolloWorkModelsPromo() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(IPOLLOWORK_MODELS_PROMO_HIDDEN_KEY, "1");
    window.dispatchEvent(new Event(iPolloWorkModelsPromoChangedEvent));
  } catch {}
}

export function wasiPolloWorkModelsStartupPromoShown() {
  if (areiPolloWorkModelsPromosDisabled()) return true;
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(IPOLLOWORK_MODELS_STARTUP_PROMO_SHOWN_KEY) === "1";
  } catch {
    return true;
  }
}

export function markiPolloWorkModelsStartupPromoShown() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(IPOLLOWORK_MODELS_STARTUP_PROMO_SHOWN_KEY, "1");
  } catch {}
}

export function shouldShowiPolloWorkModelsPromo(now = Date.now()) {
  if (areiPolloWorkModelsPromosDisabled() || typeof window === "undefined" || isiPolloWorkModelsPromoHidden()) return false;
  try {
    const lastShown = Number(window.localStorage.getItem(IPOLLOWORK_MODELS_PROMO_LAST_SHOWN_KEY) ?? "0");
    return !Number.isFinite(lastShown) || now - lastShown >= IPOLLOWORK_MODELS_PROMO_REPEAT_MS;
  } catch {
    return true;
  }
}

export function markiPolloWorkModelsPromoShown(now = Date.now()) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(IPOLLOWORK_MODELS_PROMO_LAST_SHOWN_KEY, String(now));
  } catch {}
}
