import { Component, NgZone } from "@angular/core";
import { List } from "immutable";
import * as rx from "rxjs";
import { OperatorFunction } from "rxjs/interfaces";
import {
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  map,
  mergeAll,
  scan,
  shareReplay,
  startWith,
  switchMap,
  switchMapTo,
  take
} from "rxjs/operators";

import { ofType } from "../../util/operators";
import { KaartChildComponentBase } from "../kaart-child-component-base";
import { isNoSqlFsLaag, NoSqlFsLaag, ToegevoegdeLaag } from "../kaart-elementen";
import { DataLoadEvent, LoadError } from "../kaart-load-events";
import * as prt from "../kaart-protocol";
import { KaartComponent } from "../kaart.component";

@Component({
  selector: "awv-ladend",
  templateUrl: "./kaart-loading.component.html",
  styleUrls: ["./kaart-loading.component.scss"]
})
export class KaartLoadingComponent extends KaartChildComponentBase {
  readonly activityClass$: rx.Observable<string>;
  readonly progressStyle$: rx.Observable<object>;

  constructor(parent: KaartComponent, zone: NgZone) {
    super(parent, zone);

    const toegevoegdeLagenToLoadEvents: (_: List<ToegevoegdeLaag>) => rx.Observable<DataLoadEvent> = (lgn: List<ToegevoegdeLaag>) =>
      rx.Observable.from(
        lgn
          .map(lg => lg!.bron) // ga naar de onderliggende laag
          .filter(isNoSqlFsLaag) // hou enkel de noSqlFsLagen over
          .map(lg => (lg as NoSqlFsLaag).source.loadEvent$) // kijk naar de load evts
          .toArray()
      ).pipe(mergeAll() as OperatorFunction<rx.Observable<DataLoadEvent>, DataLoadEvent>);

    const lagenHoog$: rx.Observable<List<ToegevoegdeLaag>> = this.modelChanges.lagenOpGroep$.get("Voorgrond.Hoog");
    const lagenLaag$: rx.Observable<List<ToegevoegdeLaag>> = this.modelChanges.lagenOpGroep$.get("Voorgrond.Laag");
    const dataloadEvent$: rx.Observable<DataLoadEvent> = lagenHoog$.pipe(
      // subscribe/unsubscribe voor elke nieuwe lijst van toegevoegde lagen
      switchMap(toegevoegdeLagenToLoadEvents),
      shareReplay(1, 1000)
    );
    const numBusy$: rx.Observable<number> = dataloadEvent$.pipe(
      scan((numBusy: number, evt: DataLoadEvent) => {
        switch (evt.type) {
          case "LoadStart":
            return numBusy + 1;
          case "LoadComplete":
            return numBusy - 1;
          case "LoadError":
            return numBusy - 1;
          case "PartReceived":
            // We doen hier dus niks mee, maar we zouden ook een tick kunnen geven.
            // Echter maar interessant als we het totaal aantal chunks kennen.
            return numBusy;
        }
      }, 0)
    );
    const stableError$ = (stability: number) => dataloadEvent$.pipe(ofType<LoadError>("LoadError"), debounceTime(stability));

    const busy$: rx.Observable<boolean> = numBusy$.pipe(map(numBusy => numBusy > 0), distinctUntilChanged());
    const inError$: rx.Observable<boolean> = stableError$(100).pipe(
      switchMapTo(rx.Observable.timer(0, 1000).pipe(map(t => t === 0), take(2))), // Produceert direct true, dan na een seconde false
      startWith(false)
    );

    // busy$ heeft voorrang op inactive$
    this.activityClass$ = busy$.pipe(combineLatest(inError$, (busy, error) => (busy ? "active" : error ? "error" : "inactive")));

    // We willen het "oog" verbergen wanneer we in de error toestand zijn
    this.progressStyle$ = inError$.pipe(
      // 110 = 11 * 10 . De modulus moet het eerste geheel veelvoud van het aantal onderverdelingen > 100 zijn.
      combineLatest(rx.Observable.timer(0, 200), (inError, n) => ({ "margin-left": inError ? "-10000px" : (n * 11) % 110 + "%" }))
    );

    this.bindToLifeCycle(stableError$(500)).subscribe(evt => this.dispatch(prt.MeldComponentFoutCmd(List.of(evt.error))));
  }
}
