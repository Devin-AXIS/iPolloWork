export const PRESENTATION_SLIDE_SELECTOR = "[data-ipw-slide],section.slide,.slide,.slide-frame";

export function deckExportContainer(slide: HTMLElement) {
  return slide.closest<HTMLElement>(".slide-wrap") ?? slide;
}

export function activateDeckExportSlide(slides: readonly HTMLElement[], slide: HTMLElement) {
  for (const entry of slides) {
    const active = entry === slide;
    const container = deckExportContainer(entry);
    entry.classList.toggle("is-active", active);
    entry.classList.toggle("active", active);
    entry.hidden = !active;
    container.hidden = !active;
    container.classList.toggle("hidden", !active);
    entry.style.transform = "none";
    entry.style.opacity = active ? "1" : "0";
    entry.style.visibility = active ? "visible" : "hidden";
    entry.style.pointerEvents = "none";
  }

  const container = deckExportContainer(slide);
  slide.removeAttribute("hidden");
  container.removeAttribute("hidden");
  container.classList.remove("hidden");
  slide.setAttribute("aria-hidden", "false");
}
