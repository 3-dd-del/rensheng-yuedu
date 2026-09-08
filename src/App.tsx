import { useCallback, useEffect, useState } from 'react';

import { LibraryPage } from './app/LibraryPage';
import { ReaderPage } from './app/ReaderPage';

type Route = { page: 'library' } | { page: 'reader'; bookId: string };

function parseRoute(hash: string): Route {
  const value = hash.replace(/^#\/?/, '');
  const match = /^reader\/(.+)$/.exec(value);
  if (match && match[1]) {
    return { page: 'reader', bookId: decodeURIComponent(match[1]) };
  }
  return { page: 'library' };
}

export function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));

  useEffect(() => {
    const onHashChange = () => {
      setRoute(parseRoute(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const openBook = useCallback((bookId: string) => {
    window.location.hash = `#/reader/${encodeURIComponent(bookId)}`;
  }, []);

  const backToLibrary = useCallback(() => {
    window.location.hash = '#/';
  }, []);

  if (route.page === 'reader') {
    return <ReaderPage key={route.bookId} bookId={route.bookId} onBack={backToLibrary} />;
  }
  return <LibraryPage onOpenBook={openBook} />;
}
