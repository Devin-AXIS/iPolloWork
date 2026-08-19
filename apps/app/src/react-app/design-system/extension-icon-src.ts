const featuredPluginIconSrc: Readonly<Record<string, string>> = {
  context7: "/ext-context7.svg",
  figma: "/ext-figma.svg",
  github: "/ext-github.svg",
  linear: "/ext-linear.svg",
  notion: "/ext-notion.svg",
  sentry: "/ext-sentry.svg",
  stripe: "/ext-stripe.svg",
};

export function resolveExtensionIconSrc(iconSrc: string): string {
  if (!iconSrc.startsWith("/")) {
    return iconSrc;
  }

  const base = import.meta.env.BASE_URL || "/";
  return `${base.replace(/\/?$/, "/")}${iconSrc.replace(/^\/+/, "")}`;
}

export function resolveExtensionIconUrl(input: {
  pluginId?: string;
  iconSrc?: string;
  iconSlug?: string;
  serviceUrl?: string;
}): string | undefined {
  const featuredIconSrc = input.pluginId ? featuredPluginIconSrc[input.pluginId] : undefined;
  if (featuredIconSrc) {
    return resolveExtensionIconSrc(featuredIconSrc);
  }

  if (input.iconSrc) {
    return resolveExtensionIconSrc(input.iconSrc);
  }

  if (input.iconSlug) {
    return `https://cdn.simpleicons.org/${input.iconSlug}`;
  }

  const serviceUrl = input.serviceUrl?.trim();
  if (!serviceUrl?.match(/^https?:\/\//i)) {
    return undefined;
  }

  // Favicon lookups use the registrable (apex) domain: MCP servers usually
  // live on subdomains without favicons (mcp.notion.com), while the apex
  // (notion.com) serves the real brand icon.
  try {
    const labels = new URL(serviceUrl).hostname.split(".").filter(Boolean);
    const apex = labels.length < 2 ? labels.join(".") : labels.slice(-2).join(".");
    return `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(apex)}`;
  } catch {
    return undefined;
  }
}
