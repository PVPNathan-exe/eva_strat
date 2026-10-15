// Crochet des portes à boutons d'une carte : états des portes, horloge d'animation (requestAnimationFrame tant qu'une porte bouge) et pression d'un bouton.
// Les états sont liés à la carte : changer de carte remet les portes dans leur état de départ, sans setState dans un effet.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { initialStates, isMoving, press, type DoorButton, type DoorSetup, type DoorStates } from '../lib/doorBlocks';
import { doorSetup } from '../lib/doorData';

interface State {
  map: string | undefined;
  states: DoorStates;
}

export interface Doors {
  setup: DoorSetup;
  states: DoorStates;
  /** Instant de l'horloge d'animation (ms, performance.now) : à passer à doorView. */
  now: number;
  /** Au moins une porte est en mouvement. */
  moving: boolean;
  press: (button: DoorButton) => void;
  /** Remet les portes dans leur état de départ. */
  reset: () => void;
}

/** Portes de la carte, ou null si elle n'en a pas. */
export function useDoors(map: string | undefined): Doors | null {
  const setup = useMemo(() => doorSetup(map), [map]);
  const [state, setState] = useState<State>({ map, states: setup ? initialStates(setup) : {} });
  const [now, setNow] = useState(() => performance.now());
  const cur = useMemo<State>(() => (state.map === map ? state : { map, states: setup ? initialStates(setup) : {} }), [state, map, setup]);
  const anim = setup?.anim;
  const moving = !!anim && Object.values(cur.states).some((e) => isMoving(e, now, anim));

  useEffect(() => {
    if (!moving) return;
    let frame = 0;
    const tick = () => {
      setNow(performance.now());
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [moving]);

  const pressButton = useCallback(
    (button: DoorButton) => {
      if (!setup) return;
      const t = performance.now();
      setNow(t);
      setState({ map, states: press(cur.states, button, t, setup.anim) });
    },
    [setup, map, cur.states],
  );
  const reset = useCallback(() => {
    if (setup) setState({ map, states: initialStates(setup) });
  }, [setup, map]);

  if (!setup) return null;
  return { setup, states: cur.states, now, moving, press: pressButton, reset };
}
