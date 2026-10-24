import { useCallback, useReducer, type SetStateAction } from 'react';
import type { Document } from '../../core/src/model';
import { newHistory, recordHistory, travelHistory, type DraftHistory } from './editor-model';

type Action =
  | { type: 'load'; value: SetStateAction<Document | null> }
  | { type: 'edit'; update: (document: Document) => Document }
  | { type: 'travel'; direction: -1 | 1 };
function reducer(state: DraftHistory | null, action: Action): DraftHistory | null {
  if (action.type === 'load') {
    const value = typeof action.value === 'function' ? action.value(state?.present ?? null) : action.value;
    return value ? newHistory(value) : null;
  }
  if (!state) return state;
  return action.type === 'edit'
    ? recordHistory(state, action.update(state.present))
    : travelHistory(state, action.direction);
}

export function useDraftHistory() {
  const [history, dispatch] = useReducer(reducer, null);
  const load = useCallback((value: SetStateAction<Document | null>) => dispatch({ type: 'load', value }), []);
  const change = useCallback((update: (document: Document) => Document) => dispatch({ type: 'edit', update }), []);
  const travel = useCallback((direction: -1 | 1) => dispatch({ type: 'travel', direction }), []);
  return {
    content: history?.present ?? null,
    load,
    change,
    travel,
    canUndo: Boolean(history?.past.length),
    canRedo: Boolean(history?.future.length),
  };
}
