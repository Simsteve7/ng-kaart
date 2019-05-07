import { AfterViewInit, Component, NgZone, OnInit, QueryList, ViewChildren } from "@angular/core";
import { MatButton } from "@angular/material";
import { Function1, Function3, Function4 } from "fp-ts/lib/function";
import { none, Option, some } from "fp-ts/lib/Option";
import * as ol from "openlayers";
import * as rx from "rxjs";
import { debounceTime, distinctUntilChanged, filter, map, pairwise, scan, shareReplay, startWith } from "rxjs/operators";

import { catOptions } from "../../util/operators";
import * as ke from "../kaart-elementen";
import { kaartLogOnlyWrapper } from "../kaart-internal-messages";
import { KaartModusComponent } from "../kaart-modus-component";
import * as prt from "../kaart-protocol";
import { Viewinstellingen } from "../kaart-protocol";
import { KaartComponent } from "../kaart.component";
import { kaartLogger } from "../log";

export const MijnLocatieUiSelector = "Mijnlocatie";
const MijnLocatieLaagNaam = "Mijn Locatie";

const TrackingInterval = 500; // aantal milliseconden tussen tracking updates

export type State = "TrackingDisabled" | "NoTracking" | "Tracking" | "TrackingCenter" | "TrackingAutoRotate";

export type Event = "ActiveerEvent" | "DeactiveerEvent" | "PanEvent" | "ZoomEvent" | "RotateEvent" | "ClickEvent";

export type EventMap = { [event in Event]: State };
export type StateMachine = { [state in State]: EventMap };

export const NoOpStateMachine: StateMachine = {
  NoTracking: {
    ClickEvent: "NoTracking",
    ActiveerEvent: "NoTracking",
    DeactiveerEvent: "NoTracking",
    PanEvent: "NoTracking",
    ZoomEvent: "NoTracking",
    RotateEvent: "NoTracking"
  },
  TrackingCenter: {
    ClickEvent: "TrackingCenter",
    PanEvent: "TrackingCenter",
    ActiveerEvent: "TrackingCenter",
    DeactiveerEvent: "NoTracking",
    ZoomEvent: "TrackingCenter",
    RotateEvent: "TrackingCenter"
  },
  TrackingDisabled: {
    ClickEvent: "TrackingDisabled",
    ActiveerEvent: "NoTracking",
    DeactiveerEvent: "NoTracking",
    PanEvent: "TrackingDisabled",
    ZoomEvent: "TrackingDisabled",
    RotateEvent: "TrackingDisabled"
  },
  Tracking: {
    ClickEvent: "Tracking",
    ActiveerEvent: "Tracking",
    DeactiveerEvent: "NoTracking",
    PanEvent: "Tracking",
    ZoomEvent: "Tracking",
    RotateEvent: "Tracking"
  },
  TrackingAutoRotate: {
    ClickEvent: "TrackingAutoRotate",
    ActiveerEvent: "TrackingAutoRotate",
    DeactiveerEvent: "NoTracking",
    PanEvent: "TrackingAutoRotate",
    ZoomEvent: "TrackingAutoRotate",
    RotateEvent: "TrackingAutoRotate"
  }
};

const pasLocatieFeatureAan: Function4<ol.Feature, ol.Coordinate, number, number, ol.Feature> = (feature, coordinate, zoom, accuracy) => {
  feature.setGeometry(new ol.geom.Point(coordinate));
  zetStijl(feature, zoom, accuracy);
  feature.changed(); // force redraw meteen
  return feature;
};

const moetCentreren = (state: State) => state === "TrackingCenter" || state === "TrackingAutoRotate";

const moetLocatieTonen = (state: State) => state === "Tracking" || state === "TrackingCenter" || state === "TrackingAutoRotate";

const zetStijl: Function3<ol.Feature, number, number, void> = (feature, zoom, accuracy) => feature.setStyle(locatieStijlFunctie(accuracy));

const locatieStijlFunctie: Function1<number, ol.FeatureStyleFunction> = accuracy => {
  return resolution => {
    const accuracyInPixels = Math.min(accuracy, 500) / resolution; // max 500m cirkel, soms accuracy 86000 in chrome bvb...
    const radius = Math.max(accuracyInPixels, 12); // nauwkeurigheid cirkel toch nog tonen zelfs indien ver uitgezoomd
    return [
      new ol.style.Style({
        zIndex: 2,
        image: new ol.style.Circle({
          fill: new ol.style.Fill({
            color: "rgba(66, 133, 244, 1.0)"
          }),
          stroke: new ol.style.Stroke({
            color: "rgba(255, 255, 255, 1.0)",
            width: 2
          }),
          radius: 6
        })
      }),
      new ol.style.Style({
        zIndex: 1,
        image: new ol.style.Circle({
          fill: new ol.style.Fill({
            color: "rgba(65, 105, 225, 0.15)"
          }),
          stroke: new ol.style.Stroke({
            color: "rgba(65, 105, 225, 0.5)",
            width: 1
          }),
          radius: radius
        })
      })
    ];
  };
};

@Component({
  selector: "awv-kaart-mijn-locatie",
  templateUrl: "./kaart-mijn-locatie.component.html",
  styleUrls: ["./kaart-mijn-locatie.component.scss"]
})
export class KaartMijnLocatieComponent extends KaartModusComponent implements OnInit, AfterViewInit {
  constructor(zone: NgZone, private readonly parent: KaartComponent) {
    super(parent, zone);
  }

  private viewinstellingen$: rx.Observable<Viewinstellingen> = rx.EMPTY;
  private zoomdoelSetting$: rx.Observable<Option<number>> = rx.EMPTY;
  private locatieSubj: rx.Subject<Position> = new rx.Subject<Position>();

  private eventsSubj: rx.Subject<Event> = new rx.Subject<Event>();

  currentState$: rx.Observable<State> = rx.of("TrackingDisabled" as State);
  enabled$: rx.Observable<boolean> = rx.of(true);

  @ViewChildren("locateBtn")
  locateBtnQry: QueryList<MatButton>;

  private mijnLocatie: Option<ol.Feature> = none;
  private watchId: Option<number> = none;

  private gevraagdeZoom: Option<number> = none;
  private gevraagdeRotatie: Option<number> = none;

  modus(): string {
    return MijnLocatieUiSelector;
  }

  activeer() {
    this.eventsSubj.next("ActiveerEvent");
  }

  deactiveer() {
    this.eventsSubj.next("DeactiveerEvent");
  }

  ngOnInit(): void {
    super.ngOnInit();

    this.dispatch({
      type: "VoegLaagToe",
      positie: 0,
      laag: this.createLayer(),
      magGetoondWorden: true,
      laaggroep: "Tools",
      legende: none,
      stijlInLagenKiezer: none,
      filterinstellingen: none,
      wrapper: kaartLogOnlyWrapper
    });

    this.viewinstellingen$ = this.parent.modelChanges.viewinstellingen$;
    this.zoomdoelSetting$ = this.parent.modelChanges.mijnLocatieZoomDoel$;
    this.enabled$ = this.zoomdoelSetting$.pipe(map(m => m.isSome()));
  }

  ngAfterViewInit() {
    super.ngAfterViewInit();

    const zoomdoel$: rx.Observable<number> = this.zoomdoelSetting$.pipe(catOptions); // Hou enkel de effectieve zoomniveaudoelen over
    const zoom$ = this.viewinstellingen$.pipe(
      distinctUntilChanged((vi1, vi2) => vi1.zoom === vi2.zoom && vi1.minZoom === vi2.minZoom && vi1.maxZoom === vi2.maxZoom),
      map(vi => vi.zoom)
    );

    // Event handlers
    this.bindToLifeCycle(this.parent.modelChanges.dragInfo$).subscribe(() => {
      this.eventsSubj.next("PanEvent");
    });
    this.bindToLifeCycle(this.parent.modelChanges.rotatie$).subscribe(rotatie => {
      if (this.gevraagdeRotatie.isSome()) {
        if (this.gevraagdeRotatie.toNullable()! === rotatie) {
          // Het is waarschijnlijk de rotatie die wij gevraagd hebben voor de autorotate.
          this.gevraagdeRotatie = none;
        }
      } else {
        this.eventsSubj.next("RotateEvent");
      }
    });
    this.bindToLifeCycle(zoom$).subscribe(zoom => {
      if (this.gevraagdeZoom.isSome()) {
        if (this.gevraagdeZoom.toNullable()! === zoom) {
          // Het is waarschijnlijk de zoom die wij gevraagd hebben voor de autozoom.
          this.gevraagdeZoom = none;
        }
      } else {
        this.eventsSubj.next("ZoomEvent");
      }
    });

    // "State machine"
    const stateMachine: StateMachine = this.getStateMachine();

    this.currentState$ = this.eventsSubj.pipe(
      shareReplay(1),
      startWith("TrackingDisabled"),
      scan<Event, State>((state: State, event: Event) => {
        return stateMachine[state][event];
      })
    );

    // pas positie aan bij nieuwe locatie
    this.bindToLifeCycle(
      rx.combineLatest(zoom$, zoomdoel$, this.locatieSubj.pipe(debounceTime(TrackingInterval)), this.currentState$.pipe(pairwise())).pipe(
        filter(([, , , [, state]]) => {
          return this.isTrackingActief(state);
        }),
        map(([zoom, doel, locatie, [prevState, state]]) => {
          return { zoom: zoom, doelzoom: doel, position: locatie, state: state, stateVeranderd: prevState !== state };
        })
      )
    ).subscribe(r => this.zetMijnPositie(r.position, r.zoom, r.doelzoom, r.state, r.stateVeranderd));

    this.bindToLifeCycle(this.currentState$).subscribe(state => {
      if ((moetCentreren(state) || moetLocatieTonen(state)) && this.watchId.isNone()) {
        this.startTracking();
      }
      if (!(moetCentreren(state) || moetLocatieTonen(state)) && this.watchId.isSome()) {
        this.stopTracking();
      }
      this.centreerIndienNodig(state);
    });

    if (navigator.geolocation) {
      this.eventsSubj.next("ActiveerEvent");
    }
  }

  isTrackingActief(state: State): boolean {
    return state !== "TrackingDisabled" && state !== "NoTracking";
  }

  // Dit is het statemachine van deze modus: Altijd tussen TrackingCenter en NoTracking, initialState: NoTracking
  protected getStateMachine(): StateMachine {
    return {
      ...NoOpStateMachine,
      NoTracking: { ...NoOpStateMachine.NoTracking, ClickEvent: "TrackingCenter" },
      TrackingCenter: { ...NoOpStateMachine.TrackingCenter, ClickEvent: "NoTracking", PanEvent: "NoTracking" }
    };
  }

  click() {
    this.eventsSubj.next("ClickEvent");
  }

  private maakNieuwFeature(coordinate: ol.Coordinate, accuracy: number): Option<ol.Feature> {
    const feature = new ol.Feature(new ol.geom.Point(coordinate));
    feature.setStyle(locatieStijlFunctie(accuracy));
    this.dispatch(prt.VervangFeaturesCmd(MijnLocatieLaagNaam, [feature], kaartLogOnlyWrapper));
    return some(feature);
  }

  private meldFout(fout: PositionError | string) {
    kaartLogger.error("error", fout);
    this.dispatch(
      prt.MeldComponentFoutCmd([
        "Zoomen naar huidige locatie niet mogelijk",
        "De toepassing heeft geen toestemming om locatie te gebruiken"
      ])
    );
  }

  private stopTracking() {
    this.watchId.map(watchId => navigator.geolocation.clearWatch(watchId));
    this.watchId = none;
    this.mijnLocatie = none;
    this.dispatch(prt.VervangFeaturesCmd(MijnLocatieLaagNaam, <Array<ol.Feature>>[], kaartLogOnlyWrapper));
  }

  private startTracking() {
    if (navigator.geolocation) {
      if (this.watchId.isNone()) {
        this.watchId = some(
          navigator.geolocation.watchPosition(
            //
            positie => this.locatieSubj.next(positie),
            fout => this.meldFout(fout),
            {
              enableHighAccuracy: true,
              timeout: 20000 // genoeg tijd geven aan gebruiker om locatie toestemming te geven
            }
          )
        );
      }
    } else {
      this.meldFout("Geen geolocatie mogelijk");
    }
  }

  private zetMijnPositie(position: Position, zoom: number, doelzoom: number, state: State, stateVeranderd: boolean) {
    const longLat: ol.Coordinate = [position.coords.longitude, position.coords.latitude];
    const coordinate = ol.proj.fromLonLat(longLat, "EPSG:31370");

    if (moetLocatieTonen(state)) {
      this.mijnLocatie = this.mijnLocatie
        .map(feature => pasLocatieFeatureAan(feature, coordinate, zoom, position.coords.accuracy))
        .orElse(() => {
          return this.maakNieuwFeature(coordinate, position.coords.accuracy);
        })
        .map(feature => {
          if (stateVeranderd && zoom < doelzoom && moetCentreren(state)) {
            // We zitten nu op een te laag zoomniveau, dus gaan we eerst inzoomen,
            // maar we doen dit alleen wanneer we van een state veranderd zijn.
            this.gevraagdeZoom = some(doelzoom);
            this.dispatch(prt.VeranderZoomCmd(doelzoom, kaartLogOnlyWrapper));
          }
          return feature;
        });
    }

    this.centreerIndienNodig(state);
  }

  private centreerIndienNodig(state: State) {
    if (moetCentreren(state)) {
      // kleine delay om OL tijd te geven eerst de icon te verplaatsen
      this.mijnLocatie.map(feature =>
        setTimeout(
          () => this.dispatch(prt.VeranderMiddelpuntCmd((<ol.geom.Point>feature.getGeometry()).getCoordinates(), some(TrackingInterval))),
          50
        )
      );
    }
  }

  private createLayer(): ke.VectorLaag {
    return {
      type: ke.VectorType,
      titel: MijnLocatieLaagNaam,
      source: new ol.source.Vector(),
      styleSelector: none,
      styleSelectorBron: none,
      selectieStyleSelector: none,
      hoverStyleSelector: none,
      selecteerbaar: false,
      hover: false,
      minZoom: 2,
      maxZoom: 15,
      velden: new Map<string, ke.VeldInfo>(),
      offsetveld: none,
      verwijderd: false,
      rijrichtingIsDigitalisatieZin: false,
      filter: none
    };
  }
}
