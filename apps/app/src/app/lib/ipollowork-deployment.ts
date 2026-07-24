export const IPOLLOWORK_DEPLOYMENT_ENV_VAR = "VITE_IPOLLOWORK_DEPLOYMENT";

export type iPolloWorkDeployment = "desktop" | "web";

function normalizeDeployment(value: string | undefined): iPolloWorkDeployment {
  const normalized = value?.trim().toLowerCase();
  return normalized === "web" ? "web" : "desktop";
}

export function getiPolloWorkDeployment(): iPolloWorkDeployment {
  const envValue =
    typeof import.meta !== "undefined" && typeof import.meta.env?.VITE_IPOLLOWORK_DEPLOYMENT === "string"
      ? import.meta.env.VITE_IPOLLOWORK_DEPLOYMENT
      : undefined;

  return normalizeDeployment(envValue);
}

export function isWebDeployment(): boolean {
  return getiPolloWorkDeployment() === "web";
}

export function isDesktopDeployment(): boolean {
  return getiPolloWorkDeployment() === "desktop";
}
