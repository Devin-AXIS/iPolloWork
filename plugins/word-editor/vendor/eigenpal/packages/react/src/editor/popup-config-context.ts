// The popup registry context alone. `popup-config.tsx` imports every packaged popup, and those
// import the menu and toolbar parts; a part that reads one popup entry imports this module
// instead, so it never joins that import cycle.
import { createContext, useContext } from 'react';
import type { DocxEditorPopups } from './popup-config';

export const PopupConfigContext = createContext<DocxEditorPopups | undefined>(undefined);

/** The popup registry the nearest editor root provides. */
export const usePopupConfig = () => useContext(PopupConfigContext);
