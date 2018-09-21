import { AfterViewInit, NgZone, OnDestroy, OnInit, SimpleChanges } from "@angular/core";
import { ReplaySubject } from "rxjs";
import { Observable } from "rxjs/Observable";
import { takeUntil } from "rxjs/operators";
import { Subject } from "rxjs/Subject";

import { asap } from "../util/asap";

/**
 * Algemene basisklasse die gebruikt kan worden voor zowel child components van de kaartcomponent als voor kaart classic helper components.
 */
export abstract class KaartComponentBase implements AfterViewInit, OnInit, OnDestroy {
  private readonly destroyingSubj: Subject<void> = new ReplaySubject<void>(1); // ReplaySubject zodat laatkomers toch nog event krijgen
  private readonly initialisingSubj: Subject<void> = new ReplaySubject<void>(1);
  private readonly viewReadySubj: Subject<void> = new ReplaySubject<void>(1);

  constructor(readonly zone: NgZone) {}

  ngOnInit() {
    this.initialisingSubj.next();
    this.initialisingSubj.complete();
  }

  ngOnDestroy() {
    this.destroyingSubj.next();
    this.destroyingSubj.complete();
  }

  ngAfterViewInit() {
    this.viewReadySubj.next();
    this.viewReadySubj.complete();
  }

  protected bindToLifeCycle<T>(source: Observable<T>): Observable<T> {
    return source ? source.pipe(takeUntil(this.destroyingSubj)) : source;
  }

  protected get initialising$(): Observable<void> {
    return this.initialisingSubj;
  }

  protected get destroying$(): Observable<void> {
    return this.destroyingSubj;
  }

  protected get viewReady$(): Observable<void> {
    return this.viewReadySubj;
  }

  /**
   * Voor deze functie uit zonder de Angular change detection en zonder de caller te blokkeren.
   * @param f de uit te voeren functie
   */
  protected runAsapOutsideAngular(f: () => void): void {
    this.zone.runOutsideAngular(() => asap(f));
  }

  protected runOutsideAngular<T>(f: () => T): T {
    return this.zone.runOutsideAngular(f);
  }
}

export function forChangedValue(
  changes: SimpleChanges,
  prop: string,
  action: (cur: any, prev: any) => void,
  pred: (cur: any, prev: any) => boolean = () => true
): void {
  if (prop in changes && (!changes[prop].previousValue || pred(changes[prop].currentValue, changes[prop].previousValue))) {
    action(changes[prop].currentValue, changes[prop].previousValue);
  }
}
