/* One overview object for the whole app. Every write calls reload(): the server recalculates (cached by an inputs hash). */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Overview } from '../shared/view.ts';
import { api } from './api.ts';

interface Store { ov: Overview | null; error: string; reload: () => Promise<void>; run: <T>(f: () => Promise<T>, ok?: string) => Promise<T | undefined>; toast: { msg: string; err: boolean } | null; theme: number; bumpTheme: () => void; slots: Record<string, number> }
const Ctx = createContext<Store>(null as never);
export const useStore = (): Store => useContext(Ctx);

/** Palette slot per goal (ticket 11): the pension goal gets slot 1, the emergency-fund goal slot 6, the others follow from slot 2. */
function slotMap(ov: Overview | null): Record<string, number> {
  const m: Record<string, number> = {}; if (!ov) return m;
  const pen = ov.goals.find(g => g.isP), ef = ov.goals.find(g => g.id === ov.settings.fire.efFromGoal && !g.isP);
  const order = ov.goals.filter(g => !g.isP && g !== ef).concat(ef ? [ef] : []);
  if (pen) m[pen.id] = 1;
  order.forEach((g, i) => { m[g.id] = ((i + (pen ? 1 : 0)) % 6) + 1; });
  return m;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ov, setOv] = useState<Overview | null>(null), [error, setError] = useState(''), [toast, setToast] = useState<Store['toast']>(null), [theme, setTheme] = useState(0);
  const reload = useCallback(async () => { try { setOv(await api.overview()); setError(''); } catch (e) { setError((e as Error).message); } }, []);
  useEffect(() => { void reload(); }, [reload]);
  const run: Store['run'] = useCallback(async (f, ok) => {
    try { const r = await f(); await reload(); if (ok) { setToast({ msg: ok, err: false }); setTimeout(() => setToast(null), 2500); } return r; }
    catch (e) { setToast({ msg: (e as Error).message, err: true }); setTimeout(() => setToast(null), 5000); return undefined; }
  }, [reload]);
  const slots = useMemo(() => slotMap(ov), [ov]);
  return <Ctx.Provider value={{ ov, error, reload, run, toast, theme, bumpTheme: () => setTheme(t => t + 1), slots }}>{children}</Ctx.Provider>;
}
