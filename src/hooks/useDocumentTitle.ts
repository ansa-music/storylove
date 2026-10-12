import { useEffect } from 'react';

/** Заголовок вкладки для текущей страницы. */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    if (title) document.title = title;
  }, [title]);
}
