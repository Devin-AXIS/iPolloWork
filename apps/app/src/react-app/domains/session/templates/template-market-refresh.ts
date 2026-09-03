export function shouldRefreshTemplateCatalogOnOpen(open: boolean, previouslyOpen: boolean): boolean {
  return open && !previouslyOpen;
}
