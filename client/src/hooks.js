import { useEffect, useState } from 'react';
import { api } from './api';

export function useLoad(path) {
  const [state, setState] = useState({ data: null, error: '', loading: true });
  useEffect(() => {
    let live = true;
    setState({ data: null, error: '', loading: true });
    api(path)
      .then(data => live && setState({ data, error: '', loading: false }))
      .catch(e => live && setState({ data: null, error: e.message, loading: false }));
    return () => { live = false; };
  }, [path]);
  return state;
}
