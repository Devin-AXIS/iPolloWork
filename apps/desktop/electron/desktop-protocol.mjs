import path from "node:path";

export function resolveDesktopProtocolRegistration({
  isDevMode,
  isPackaged,
  execPath,
  entryPath,
}) {
  if (isPackaged) {
    return { scheme: "ipollowork", executablePath: null, args: [] };
  }
  if (!isDevMode || !execPath || !entryPath) {
    return null;
  }
  return {
    scheme: "ipollowork-dev",
    executablePath: execPath,
    args: [path.resolve(entryPath)],
  };
}

export function registerDesktopProtocolClient(app, registration) {
  if (!registration) return false;
  if (registration.executablePath) {
    return app.setAsDefaultProtocolClient(
      registration.scheme,
      registration.executablePath,
      registration.args,
    );
  }
  return app.setAsDefaultProtocolClient(registration.scheme);
}
