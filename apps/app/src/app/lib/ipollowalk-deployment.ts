export const IPOLLOWALK_DEPLOYMENT_ENV_VAR = "VITE_IPOLLOWALK_DEPLOYMENT";

export type iPolloWalkDeployment = "desktop" | "web";

function normalizeDeployment(value: string | undefined): iPolloWalkDeployment {
  const normalized = value?.trim().toLowerCase();
  return normalized === "web" ? "web" : "desktop";
}

export function getiPolloWalkDeployment(): iPolloWalkDeployment {
  const envValue =
    typeof import.meta !== "undefined" && typeof import.meta.env?.VITE_IPOLLOWALK_DEPLOYMENT === "string"
      ? import.meta.env.VITE_IPOLLOWALK_DEPLOYMENT
      : undefined;

  return normalizeDeployment(envValue);
}

export function isWebDeployment(): boolean {
  return getiPolloWalkDeployment() === "web";
}

export function isDesktopDeployment(): boolean {
  return getiPolloWalkDeployment() === "desktop";
}
