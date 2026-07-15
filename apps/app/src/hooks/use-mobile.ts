import * as React from "react";

const MOBILE_BREAKPOINT = 768

export function isNarrowMobileViewport(width: number) {
  if (typeof window !== "undefined" && window.__IPOLLOWORK_ELECTRON__ != null) {
    return false
  }

  return width < MOBILE_BREAKPOINT
}

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(isNarrowMobileViewport(window.innerWidth))
    }
    mql.addEventListener("change", onChange)
    setIsMobile(isNarrowMobileViewport(window.innerWidth))
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}
