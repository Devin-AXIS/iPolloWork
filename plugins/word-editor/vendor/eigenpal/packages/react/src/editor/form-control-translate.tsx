import { createContext, useCallback, useContext } from 'react';
import type { TFunction } from '@docx-editor.dev/i18n';
import { useTranslation } from '../i18n';

const Context = createContext<TFunction | undefined>(undefined);
/** Internal bridge between Root's live engine resolver and framework-owned form controls. */
export const FormControlTranslateProvider = Context.Provider;
export function useFormControlTranslate(): TFunction {
  const override = useContext(Context);
  const { t } = useTranslation();
  return useCallback<TFunction>(
    (key, params) => {
      const translated = override?.(key, params);
      return translated === undefined || translated === key ? t(key, params) : translated;
    },
    [override, t]
  );
}
