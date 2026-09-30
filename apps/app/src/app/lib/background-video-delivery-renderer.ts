export function isBackgroundVideoDeliveryRenderer(): boolean {
  return typeof window !== "undefined"
    && new URLSearchParams(window.location.search).get("ipolloworkBackgroundDelivery") === "1";
}
