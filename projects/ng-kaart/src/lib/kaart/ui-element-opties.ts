import { option } from "fp-ts";
import { Option } from "fp-ts/lib/Option";

import * as maps from "../util/maps";

export type OptiesOpUiElement = Map<string, object>;

export namespace OptiesOpUiElement {
  export const create = (): OptiesOpUiElement => new Map();

  export const get = <A>(uiSelector: string) => (optiesMap: OptiesOpUiElement): Option<A> =>
    option.fromNullable((optiesMap.get(uiSelector) as unknown) as A);

  export const set = <A extends Object>(a: A) => (uiSelector: string) => (optiesMap: OptiesOpUiElement): OptiesOpUiElement =>
    maps.set(optiesMap, uiSelector, a);

  // export const init = <A extends Object>(a: A) => (uiSelector: string) => (optiesMap: OptiesOpUiElement):
  //   OptiesOpUiElement => optiesMap.has(uiSelector) ? optiesMap : set(a)(uiSelector)(optiesMap);

  // Vul enkel de niet reeds gezette optie waarden toe. Het probleem is dat wegens de Angular life-cycle classic
  // componenten volledig opgebouwd zijn vooraleer de onderliggende kaartsubcomponent geïnitialiseerd wordt. We willen
  // dat alle default waarden gezet zijn, maar tegelijkertijd ook dat de waarden die de classic component zet behouden worden.
  export const init = <A extends Object>(a: A) => (uiSelector: string) => (optiesMap: OptiesOpUiElement): OptiesOpUiElement =>
    set({ ...a, ...optiesMap.get(uiSelector) })(uiSelector)(optiesMap);

  // Uit de element optie stream hoeven niet enkel objecten te komen die alle properties van het optietype bevatten. De
  // properties die niet gezet zijn, worden overgenomen van de recentste keer dat ze gezet waren.
  export const extend = <A extends Object>(a: A) => (uiSelector: string) => (optiesMap: OptiesOpUiElement): OptiesOpUiElement =>
    set({ ...optiesMap.get(uiSelector), ...a })(uiSelector)(optiesMap);
}