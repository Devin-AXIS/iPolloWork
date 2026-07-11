import { INFERENCE_MODEL_ALIASES } from "@ipollowalk/types/den/inference";

import {
  buildDenAuthUrl,
  getDenInferenceUrl,
  readDenBootstrapConfig,
  readDenSettings,
} from "../../../app/lib/den";

export const IPOLLOWALK_MODELS_PROVIDER_ID = "ipollowalk";
export const IPOLLOWALK_MODELS_PROVIDER_NAME = "iPolloWalk Models";
export const IPOLLOWALK_MODELS_PROMO_HIDDEN_KEY = "ipollowalk.ipollowalkModelsPromo.hidden";
export const IPOLLOWALK_MODELS_PROMO_LAST_SHOWN_KEY = "ipollowalk.ipollowalkModelsPromo.lastShownAt";
export const IPOLLOWALK_MODELS_STARTUP_PROMO_SHOWN_KEY = "ipollowalk.ipollowalkModelsPromo.startupShown";
export const iPolloWalkModelsPromoChangedEvent = "ipollowalk-ipollowalk-models-promo-changed";
export const IPOLLOWALK_MODELS_PROMO_SHOW_DELAY_MS = 4_000;
export const IPOLLOWALK_MODELS_PROMO_VISIBLE_MS = 14_000;
export const IPOLLOWALK_MODELS_PROMO_REPEAT_MS = 6 * 60 * 60 * 1000;

export function areiPolloWalkModelsPromosDisabled() {
  return /^(1|true|yes|on)$/i.test(String(import.meta.env.VITE_DISABLE_IPOLLOWALK_MODELS ?? "").trim());
}

export type iPolloWalkModelPreview = {
  id: string;
  title: string;
  subtitle: string;
};

export const IPOLLOWALK_MODEL_PREVIEWS: iPolloWalkModelPreview[] = Object.entries(
  INFERENCE_MODEL_ALIASES,
)
  .filter(([, model]) => model.enabled)
  .map(([id, model]) => ({
    id,
    title: model.displayName.replace(/^iPolloWalk:\s*/, ""),
    subtitle: "iPolloWalk hosted",
  }));

export function hasiPolloWalkModelsProvider(providerIds: readonly string[]) {
  return providerIds.some((id) => id.trim().toLowerCase() === IPOLLOWALK_MODELS_PROVIDER_ID);
}

export function getiPolloWalkModelsActionUrl(
  isSignedIn: boolean,
  authMode: "sign-in" | "sign-up" = "sign-in",
) {
  const settings = readDenSettings();
  const baseUrl = settings.baseUrl || readDenBootstrapConfig().baseUrl;
  // Signed-in users go straight to the iPolloWalk Models page — the value-prop
  // + subscribe surface — never to a bare auth or billing page.
  return isSignedIn ? getDenInferenceUrl(baseUrl) : buildDenAuthUrl(baseUrl, authMode);
}

export function isiPolloWalkModelsPromoHidden() {
  if (areiPolloWalkModelsPromosDisabled()) return true;
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(IPOLLOWALK_MODELS_PROMO_HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function hideiPolloWalkModelsPromo() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(IPOLLOWALK_MODELS_PROMO_HIDDEN_KEY, "1");
    window.dispatchEvent(new Event(iPolloWalkModelsPromoChangedEvent));
  } catch {}
}

export function wasiPolloWalkModelsStartupPromoShown() {
  if (areiPolloWalkModelsPromosDisabled()) return true;
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(IPOLLOWALK_MODELS_STARTUP_PROMO_SHOWN_KEY) === "1";
  } catch {
    return true;
  }
}

export function markiPolloWalkModelsStartupPromoShown() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(IPOLLOWALK_MODELS_STARTUP_PROMO_SHOWN_KEY, "1");
  } catch {}
}

export function shouldShowiPolloWalkModelsPromo(now = Date.now()) {
  if (areiPolloWalkModelsPromosDisabled() || typeof window === "undefined" || isiPolloWalkModelsPromoHidden()) return false;
  try {
    const lastShown = Number(window.localStorage.getItem(IPOLLOWALK_MODELS_PROMO_LAST_SHOWN_KEY) ?? "0");
    return !Number.isFinite(lastShown) || now - lastShown >= IPOLLOWALK_MODELS_PROMO_REPEAT_MS;
  } catch {
    return true;
  }
}

export function markiPolloWalkModelsPromoShown(now = Date.now()) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(IPOLLOWALK_MODELS_PROMO_LAST_SHOWN_KEY, String(now));
  } catch {}
}
