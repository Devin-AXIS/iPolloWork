export function relaunchActionForMode(isDevMode) {
  return isDevMode ? "reload-window" : "relaunch-app";
}
