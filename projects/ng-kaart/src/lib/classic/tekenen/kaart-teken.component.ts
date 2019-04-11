import { Component, EventEmitter, Injector, Input, OnInit, Output } from "@angular/core";
import { none, Option } from "fp-ts/lib/Option";
import * as ol from "openlayers";
import * as rx from "rxjs";
import { identity, merge } from "rxjs";
import { distinctUntilChanged, map, switchMap, takeUntil } from "rxjs/operators";

import { StartTekenen, StopTekenen, TekenenCommand, TekenSettings } from "../../kaart/kaart-elementen";
import * as prt from "../../kaart/kaart-protocol";
import * as ss from "../../kaart/stijl-selector";
import { TekenenUiSelector } from "../../kaart/tekenen/kaart-teken-laag.component";
import { collect, ofType } from "../../util/operators";
import { ClassicBaseComponent } from "../classic-base.component";
import { classicMsgSubscriptionCmdOperator } from "../kaart-classic.component";
import { KaartClassicMsg, TekenGeomAangepastMsg } from "../messages";

import * as val from "../webcomponent-support/params";

@Component({
  selector: "awv-kaart-teken",
  template: "<ng-content></ng-content>"
})
export class KaartTekenComponent extends ClassicBaseComponent implements OnInit {
  private stopTekenenSubj: rx.Subject<void> = new rx.Subject<void>();
  private tekenenCommandSubj = new rx.Subject<TekenenCommand>();

  @Input()
  set tekenen(param: boolean) {
    const teken = val.bool(param, false);
    if (teken) {
      this.tekenenCommandSubj.next(
        StartTekenen(
          TekenSettings(
            this.geometryType,
            this.geometry,
            ss.asStyleSelector(this.laagStyle),
            ss.asStyleSelector(this.drawStyle),
            this.meerdereGeometrieen
          )
        )
      );
    } else {
      this.tekenenCommandSubj.next(StopTekenen());
    }
  }

  @Input()
  set tekenenCommand(command: TekenenCommand) {
    this.tekenenCommandSubj.next(command);
  }

  @Input()
  private geometryType: ol.geom.GeometryType = "LineString";

  @Input()
  private laagStyle;

  @Input()
  private drawStyle: ol.style.Style;

  @Input()
  private meerdereGeometrieen = false;

  @Input()
  private geometry: Option<ol.geom.Geometry> = none;

  @Output()
  getekendeGeom: EventEmitter<ol.geom.Geometry> = new EventEmitter();

  constructor(injector: Injector) {
    super(injector);

    this.initialising$.subscribe(() => this.kaart.dispatch(prt.VoegUiElementToe(TekenenUiSelector)));
    this.destroying$.subscribe(() => this.kaart.dispatch(prt.VerwijderUiElement(TekenenUiSelector)));
  }

  ngOnInit() {
    super.ngOnInit();
    this.bindToLifeCycle(
      this.tekenenCommandSubj.pipe(
        distinctUntilChanged(),
        collect(identity),
        switchMap((command: TekenenCommand) => {
          switch (command.type) {
            case "start":
              return merge(
                this.kaart.kaartClassicSubMsg$
                  .lift(
                    classicMsgSubscriptionCmdOperator(
                      this.kaart.dispatcher,
                      prt.GeometryChangedSubscription(command.settings, resultaat =>
                        KaartClassicMsg(TekenGeomAangepastMsg(resultaat.geometry))
                      )
                    )
                  )
                  .pipe(
                    takeUntil(this.stopTekenenSubj) // Unsubscribe bij stoppen met tekenen
                  ),
                this.kaart.kaartClassicSubMsg$.pipe(
                  ofType<TekenGeomAangepastMsg>("TekenGeomAangepast"), //
                  map(m => this.getekendeGeom.emit(m.geom)),
                  takeUntil(this.stopTekenenSubj)
                )
              );
            case "stop":
              this.stopTekenenSubj.next(); // zorg dat de unsubscribe gebeurt
              this.stopTekenenSubj = new rx.Subject();
              return rx.EMPTY;
          }
        })
      )
    ).subscribe();
  }
}
