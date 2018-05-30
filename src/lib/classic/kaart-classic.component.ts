import { Component, EventEmitter, Input, NgZone, OnChanges, OnDestroy, OnInit, Output, SimpleChanges } from "@angular/core";
import { pipe } from "fp-ts/lib/function";
import * as option from "fp-ts/lib/Option";
import { some } from "fp-ts/lib/Option";
import { List } from "immutable";
import * as ol from "openlayers";
import * as rx from "rxjs";
import { Observable } from "rxjs/Observable";
import { map, share, tap } from "rxjs/operators";

import { forChangedValue, KaartComponentBase } from "../kaart/kaart-component-base";
import { KaartCmdDispatcher, ReplaySubjectKaartCmdDispatcher } from "../kaart/kaart-event-dispatcher";
import * as prt from "../kaart/kaart-protocol";
import { KaartMsgObservableConsumer } from "../kaart/kaart.component";
import { subscriptionCmdOperator } from "../kaart/subscription-helper";
import { ofType, TypedRecord } from "../util/operators";

import { classicLogger } from "./log";
import {
  ExtentAangepastMsg,
  FeatureGedeselecteerdMsg,
  FeatureSelectieAangepastMsg,
  KaartClassicMsg,
  KaartClassicSubMsg,
  logOnlyWrapper,
  MiddelpuntAangepastMsg,
  SubscribedMsg,
  ZichtbareFeaturesAangepastMsg,
  ZoomAangepastMsg
} from "./messages";

@Component({
  selector: "awv-kaart-classic",
  templateUrl: "./kaart-classic.component.html"
})
export class KaartClassicComponent extends KaartComponentBase implements OnInit, OnDestroy, OnChanges, KaartCmdDispatcher<prt.TypedRecord> {
  private static counter = 1;
  kaartClassicSubMsg$: Observable<KaartClassicSubMsg> = Observable.empty();
  private hasFocus = false;

  readonly dispatcher: ReplaySubjectKaartCmdDispatcher<TypedRecord> = new ReplaySubjectKaartCmdDispatcher();
  readonly kaartMsgObservableConsumer: KaartMsgObservableConsumer;

  @Input() zoom: number;
  @Input() minZoom = 0;
  @Input() maxZoom = 15;
  @Input() middelpunt: ol.Coordinate; // = [130000, 193000]; // "extent" heeft voorrang
  @Input() breedte; // neem standaard de hele breedte in
  @Input() hoogte = 400;
  @Input() mijnLocatieZoom: number | undefined;
  @Input() extent: ol.Extent;
  @Input() selectieModus: prt.SelectieModus = "none";
  @Input() naam = "kaart" + KaartClassicComponent.counter++;

  @Output() geselecteerdeFeatures: EventEmitter<List<ol.Feature>> = new EventEmitter();
  @Output() middelpuntChange: EventEmitter<ol.Coordinate> = new EventEmitter();
  @Output() zoomChange: EventEmitter<number> = new EventEmitter();
  @Output() extentChange: EventEmitter<ol.Extent> = new EventEmitter();
  @Output() zichtbareFeatures: EventEmitter<List<ol.Feature>> = new EventEmitter();

  constructor(zone: NgZone) {
    super(zone);
    this.kaartMsgObservableConsumer = (msg$: Observable<prt.KaartMsg>) => {
      // We zijn enkel geïnteresseerd in messages van ons eigen type
      this.kaartClassicSubMsg$ = msg$.pipe(
        ofType<KaartClassicMsg>("KaartClassic"),
        map(m => m.payload),
        tap(m => classicLogger.debug("Een classic msg werd ontvangen", m)),
        share() // 1 rx subscription naar boven toe is genoeg
      );

      this.bindToLifeCycle(
        this.kaartClassicSubMsg$.lift(
          classicMsgSubscriptionCmdOperator(
            this.dispatcher,
            prt.GeselecteerdeFeaturesSubscription(pipe(FeatureSelectieAangepastMsg, KaartClassicMsg)),
            prt.ZichtbareFeaturesSubscription(pipe(ZichtbareFeaturesAangepastMsg, KaartClassicMsg)),
            prt.ViewinstellingenSubscription(pipe(zi => zi.zoom, ZoomAangepastMsg, KaartClassicMsg)),
            prt.MiddelpuntSubscription(pipe(MiddelpuntAangepastMsg, KaartClassicMsg)),
            prt.ExtentSubscription(pipe(ExtentAangepastMsg, KaartClassicMsg))
          )
        )
      ).subscribe(err => classicLogger.error(err));

      this.bindToLifeCycle(this.kaartClassicSubMsg$).subscribe(msg => {
        switch (msg.type) {
          case "FeatureSelectieAangepast":
            // Zorg ervoor dat de geselecteerde features in de @Output terecht komen
            return this.geselecteerdeFeatures.emit(msg.geselecteerdeFeatures.geselecteerd);
          case "ZichtbareFeaturesAangepast":
            return this.zichtbareFeatures.emit(msg.features);
          case "FeatureGedeselecteerd":
            // Zorg ervoor dat deselecteer van een feature via infoboodschap terug naar kaart-reducer gaat
            return this.dispatch(prt.DeselecteerFeatureCmd(msg.featureid));
          case "ZoomAangepast":
            return this.zoomChange.emit(msg.zoom);
          case "MiddelpuntAangepast":
            return this.middelpuntChange.emit(msg.middelpunt);
          case "ExtentAangepast":
            return this.extentChange.emit(msg.extent);
          default:
            return; // Op de andere boodschappen reageren we niet
        }
      });
    };
  }

  ngOnInit() {
    super.ngOnInit();
    // De volgorde van de dispatching hier is van belang voor wat de overhand heeft
    if (this.zoom) {
      this.dispatch(prt.VeranderZoomCmd(this.zoom, logOnlyWrapper));
    }
    if (this.extent) {
      this.dispatch(prt.VeranderExtentCmd(this.extent));
    }
    if (this.middelpunt) {
      this.dispatch(prt.VeranderMiddelpuntCmd(this.middelpunt));
    }
    if (this.breedte || this.hoogte) {
      this.dispatch(prt.VeranderViewportCmd([this.breedte, this.hoogte]));
    }
    if (this.selectieModus) {
      this.dispatch(prt.ActiveerSelectieModusCmd(this.selectieModus));
    }
  }

  ngOnChanges(changes: SimpleChanges) {
    forChangedValue(changes, "zoom", zoom => this.dispatch(prt.VeranderZoomCmd(zoom, logOnlyWrapper)));
    forChangedValue(changes, "middelpunt", center => this.dispatch(prt.VeranderMiddelpuntCmd(center)), coordinateIsDifferent);
    forChangedValue(changes, "extent", ext => this.dispatch(prt.VeranderExtentCmd(ext)), extentIsDifferent);
    forChangedValue(changes, "breedte", breedte => this.dispatch(prt.VeranderViewportCmd([breedte, this.hoogte])));
    forChangedValue(changes, "hoogte", hoogte => this.dispatch(prt.VeranderViewportCmd([this.breedte, hoogte])));
    forChangedValue(changes, "mijnLocatieZoom", zoom => this.dispatch(prt.ZetMijnLocatieZoomCmd(option.fromNullable(zoom))));
  }

  dispatch(cmd: prt.Command<TypedRecord>) {
    this.dispatcher.dispatch(cmd);
  }

  get kaartCmd$(): Observable<prt.Command<prt.TypedRecord>> {
    return this.dispatcher.commands$;
  }

  focus(): void {
    // Voor performantie
    if (!this.hasFocus) {
      this.hasFocus = true;
      this.dispatch({ type: "FocusOpKaart" });
    }
  }

  geenFocus(): void {
    // Stuur enkel enkel indien nodig
    if (this.hasFocus) {
      this.hasFocus = false;
      this.dispatch({ type: "VerliesFocusOpKaart" });
    }
  }

  toonIdentifyInformatie(feature: ol.Feature): void {
    const featureId = feature.get("id").toString();
    this.dispatch(
      prt.ToonInfoBoodschapCmd({
        type: "InfoBoodschapIdentify",
        id: featureId,
        titel: feature.get("laagnaam"),
        feature: feature,
        verbergMsgGen: () => some(KaartClassicMsg(FeatureGedeselecteerdMsg(featureId)))
      })
    );
    // Gewoon alert:
    //
    // this.dispatch(
    //   prt.ToonInfoBoodschapCmd({
    //     id: "alert-" + featureId,
    //     type: "InfoBoodschapAlert",
    //     titel: feature.get("laagnaam"),
    //     message: "Feature " + featureId + " geselecteerd",
    //     verbergMsgGen: () => some(KaartClassicMsg(FeatureGedeselecteerdMsg(featureId)))
    //   })
    // );
  }

  verbergIdentifyInformatie(id: string): void {
    this.dispatch(prt.VerbergInfoBoodschapCmd(id));
  }
}

const coordinateIsEqual = (coor1: ol.Coordinate, coor2: ol.Coordinate) => {
  if (!coor1 && !coor2) {
    return true;
  }
  if (!coor1 || !coor2) {
    return false;
  }
  return coor1[0] === coor2[0] && coor1[1] === coor2[1];
};
const coordinateIsDifferent = (coor1: ol.Coordinate, coor2: ol.Coordinate) => !coordinateIsEqual(coor1, coor2);

const extentIsEqual = (ext1: ol.Extent, ext2: ol.Extent) => {
  if (!ext1 && !ext2) {
    return true;
  }
  if (!ext1 || !ext2) {
    return false;
  }
  return ext1[0] === ext2[0] && ext1[1] === ext2[1] && ext1[2] === ext2[2] && ext1[3] === ext2[3];
};
const extentIsDifferent = (ext1: ol.Extent, ext2: ol.Extent) => !extentIsEqual(ext1, ext2);

/**
 * Een specialisatie van de subscriptionCmdOperator die specifiek werkt met KaartClassicMessages.
 */
export function classicMsgSubscriptionCmdOperator(
  dispatcher: KaartCmdDispatcher<KaartClassicMsg>,
  ...subscriptions: prt.Subscription<KaartClassicMsg>[]
): rx.Operator<KaartClassicSubMsg, string[]> {
  return subscriptionCmdOperator(dispatcher, ref => validation => KaartClassicMsg(SubscribedMsg(validation, ref)), ...subscriptions);
}
