import { animate, style, transition, trigger } from "@angular/animations";
import { HttpErrorResponse } from "@angular/common/http";
import { ChangeDetectorRef, Component, ElementRef, Inject, NgZone, OnDestroy, OnInit, ViewChild, ViewEncapsulation } from "@angular/core";
import { FormControl } from "@angular/forms";
import { none, Option, some } from "fp-ts/lib/Option";
import { Tuple } from "fp-ts/lib/Tuple";
import { List, Map, OrderedMap, Set } from "immutable";
import * as ol from "openlayers";
import * as rx from "rxjs";
import {
  catchError,
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  filter,
  map,
  scan,
  shareReplay,
  startWith,
  switchMap,
  tap
} from "rxjs/operators";

import { KaartChildComponentBase } from "../../kaart/kaart-child-component-base";
import * as ke from "../../kaart/kaart-elementen";
import { VeldInfo } from "../../kaart/kaart-elementen";
import { KaartInternalMsg, kaartLogOnlyWrapper } from "../../kaart/kaart-internal-messages";
import * as prt from "../../kaart/kaart-protocol";
import { KaartComponent } from "../../kaart/kaart.component";
import { kaartLogger } from "../../kaart/log";
import { matchGeometryType } from "../../util/geometries";
import { collect, Pipeable } from "../../util/operators";
import { forEach } from "../../util/option";
import {
  compareResultaten,
  IconDescription,
  StringZoekInput,
  ZoekInput,
  ZoekKaartResultaat,
  ZoekResultaat,
  ZoekResultaten
} from "../zoeker-base";
import { AbstractRepresentatieService, ZOEKER_REPRESENTATIE } from "../zoeker-representatie.service";

export const ZoekerUiSelector = "Zoeker";

export class Fout {
  constructor(readonly zoeker: string, readonly fout: string) {}
}

export interface HuidigeSelectie {
  feature: ol.Feature;
  zoekResultaat: ZoekKaartResultaat;
}

export type ZoekerType = typeof BASIS | typeof PERCEEL | typeof CRAB | typeof EXTERNE_WMS;

export const BASIS = "Basis";
export const PERCEEL = "Perceel";
export const CRAB = "Crab";
export const EXTERNE_WMS = "ExterneWms";

export function isNotNullObject(object) {
  return object && object instanceof Object;
}

export function toTrimmedLowerCasedString(s: string): string {
  return s
    ? s
        .toString()
        .trim()
        .toLocaleLowerCase()
    : "";
}

export function toNonEmptyDistinctLowercaseString(): Pipeable<any, string> {
  return o =>
    o.pipe(
      filter(value => value), // filter de lege waardes eruit
      // zorg dat we een lowercase waarde hebben zonder leading of trailing spaties.
      map(toTrimmedLowerCasedString),
      distinctUntilChanged()
    );
}

export abstract class GetraptZoekerComponent extends KaartChildComponentBase {
  protected constructor(kaartComponent: KaartComponent, private zoekerComponent: ZoekerBoxComponent, zone: NgZone) {
    super(kaartComponent, zone);
  }

  maakVeldenLeeg(vanafNiveau: number) {
    this.zoekerComponent.maakResultaatLeeg();
  }

  protected meldFout(fout: HttpErrorResponse) {
    kaartLogger.error("error", fout);
    this.dispatch(prt.MeldComponentFoutCmd(List.of("Fout bij ophalen perceel gegevens", fout.message)));
  }

  protected subscribeToDisableWhenEmpty<T>(observable: rx.Observable<T[]>, control: FormControl, maakLeegVanaf: number) {
    // Wanneer de array leeg is, disable de control, enable indien niet leeg of er een filter is opgegeven.
    function disableWanneerLeeg(array: T[]) {
      if (array.length > 0 || (control.value && control.value !== "")) {
        control.enable();
      } else {
        control.disable();
      }
    }

    this.bindToLifeCycle(observable).subscribe(
      waardes => {
        disableWanneerLeeg(waardes);
        this.maakVeldenLeeg(maakLeegVanaf);
      },
      error => this.meldFout(error)
    );
  }

  protected busy<T>(observable: rx.Observable<T>): rx.Observable<T> {
    function noop() {}

    this.zoekerComponent.increaseBusy();
    return observable.pipe(tap(noop, () => this.zoekerComponent.decreaseBusy(), () => this.zoekerComponent.decreaseBusy()));
  }

  protected zoek<I extends ZoekInput>(zoekInput: I, zoekers: Set<string>) {
    this.zoekerComponent.toonResultaat = true;
    this.zoekerComponent.increaseBusy();
    this.dispatch({
      type: "Zoek",
      input: zoekInput,
      zoekers: zoekers,
      wrapper: kaartLogOnlyWrapper
    });
  }

  // Gebruik de waarde van de VORIGE control om een request te doen,
  //   maar alleen als die vorige waarde een object was (dus door de gebruiker aangeklikt in de lijst).
  // Filter het antwoord daarvan met de (eventuele) waarde van onze HUIDIGE control, dit om autocomplete te doen.
  protected autocomplete<T, A>(
    vorige: FormControl,
    provider: (A) => rx.Observable<T[]>,
    huidige: FormControl,
    propertyGetter: (T) => string
  ): rx.Observable<T[]> {
    // Filter een array van waardes met de waarde van een filter (control), de filter kan een string of een object zijn.
    function filterMetWaarde(): Pipeable<T[], T[]> {
      return combineLatest(huidige.valueChanges.pipe(startWith<string | T>(""), distinctUntilChanged()), (waardes, filterWaarde) => {
        if (!filterWaarde) {
          return waardes;
        } else if (typeof filterWaarde === "string") {
          const filterWaardeLowerCase = filterWaarde.toLocaleLowerCase();
          return waardes
            .filter(value =>
              propertyGetter(value)
                .toLocaleLowerCase()
                .includes(filterWaardeLowerCase)
            )
            .sort((a, b) => {
              const aValueLowerCase = propertyGetter(a).toLocaleLowerCase();
              const bValueLowerCase = propertyGetter(b).toLocaleLowerCase();

              const aIndex = aValueLowerCase.indexOf(filterWaardeLowerCase);
              const bIndex = bValueLowerCase.indexOf(filterWaardeLowerCase);

              // aIndex en bIndex zullen nooit -1 zijn. De filter van hierboven vereist dat xValueLowercase.includes(filterWaardeLowerCase)
              if (aIndex < bIndex) {
                // de filterwaarde komt korter vooraan voor in a dan in b
                return -1;
              } else if (aIndex > bIndex) {
                // de filterwaarde komt verder achteraan voor in a dan in b
                return 1;
              } else {
                // alfabetisch sorteren van alle andere gevallen
                return aValueLowerCase.localeCompare(bValueLowerCase);
              }
            });
        } else {
          return waardes.filter(value =>
            propertyGetter(value)
              .toLocaleLowerCase()
              .includes(propertyGetter(filterWaarde).toLocaleLowerCase())
          );
        }
      });
    }

    return vorige.valueChanges.pipe(distinctUntilChanged(), this.safeProvider(provider), filterMetWaarde(), shareReplay(1));
  }

  // inputWaarde kan een string of een object zijn. Enkel wanneer het een object is, roepen we de provider op,
  // anders geven we een lege array terug.
  private safeProvider<A, T>(provider: (A) => rx.Observable<T[]>): Pipeable<A, T[]> {
    return switchMap(inputWaarde => {
      return isNotNullObject(inputWaarde)
        ? this.busy(provider(inputWaarde)).pipe(
            catchError((error, obs) => {
              this.meldFout(error);
              return rx.Observable.of([]);
            })
          )
        : rx.Observable.of([]);
    });
  }
}

@Component({
  selector: "awv-zoeker",
  templateUrl: "./zoeker-box.component.html",
  styleUrls: ["./zoeker-box.component.scss"],
  animations: [
    trigger("enterAnimation", [
      transition(":enter", [
        style({ opacity: 0, "max-height": 0 }),
        animate("0.35s cubic-bezier(.62,.28,.23,.99)", style({ opacity: 1, "max-height": "400px" }))
      ]),
      transition(":leave", [
        style({ opacity: 1, "max-height": "400px" }),
        animate("0.35s cubic-bezier(.62,.28,.23,.99)", style({ opacity: 0, "max-height": 0 }))
      ])
    ])
  ],
  encapsulation: ViewEncapsulation.None
})
export class ZoekerBoxComponent extends KaartChildComponentBase implements OnInit, OnDestroy {
  zoekVeld = new FormControl();
  @ViewChild("zoekVeldElement") zoekVeldElement: ElementRef;

  @ViewChild("zoekerPerceelGetrapt")
  set setZoekerPerceelGetraptComponent(zoekerPerceelGetrapt: GetraptZoekerComponent) {
    this.zoekerComponentSubj.next(new Tuple<ZoekerType, GetraptZoekerComponent>(PERCEEL, zoekerPerceelGetrapt));
  }

  @ViewChild("zoekerCrabGetrapt")
  set setZoekerCrabGetraptComponent(zoekerCrabGetrapt: GetraptZoekerComponent) {
    this.zoekerComponentSubj.next(new Tuple<ZoekerType, GetraptZoekerComponent>(CRAB, zoekerCrabGetrapt));
  }

  @ViewChild("zoekerExterneWmsGetrapt")
  set setZoekerExterneWmsGetraptComponent(zoekerExterneWmsGetrapt: GetraptZoekerComponent) {
    this.zoekerComponentSubj.next(new Tuple<ZoekerType, GetraptZoekerComponent>(EXTERNE_WMS, zoekerExterneWmsGetrapt));
  }

  featuresByResultaat = Map<ZoekResultaat, ol.Feature[]>();
  huidigeSelectie: Option<HuidigeSelectie> = none;
  alleZoekResultaten: ZoekResultaat[] = [];
  alleFouten: Fout[] = [];
  legende: Map<string, IconDescription> = Map<string, IconDescription>();
  legendeKeys: string[] = [];
  toonHelp = false;
  toonResultaat = true;
  busy = 0;
  actieveZoeker: ZoekerType = "Basis";
  perceelMaakLeegDisabled = true;
  crabMaakLeegDisabled = true;
  zoekerMaakLeegDisabled = Set<ZoekerType>();
  externeWmsMaakLeegDisabled = true;
  readonly zoekerNamen$: rx.Observable<Set<string>>;
  readonly zoekerComponentSubj: rx.Subject<Tuple<ZoekerType, GetraptZoekerComponent>> = new rx.Subject();
  readonly zoekerComponentOpNaam$: rx.Observable<Map<ZoekerType, GetraptZoekerComponent>>;
  readonly maakVeldenLeegSubj: rx.Subject<ZoekerType> = new rx.Subject<ZoekerType>();

  // Member variabelen die eigenlijk constanten of statics zouden kunnen zijn, maar gebruikt in de HTML template
  readonly Basis: ZoekerType = BASIS;
  readonly Crab: ZoekerType = CRAB;
  readonly Perceel: ZoekerType = PERCEEL;
  readonly ExterneWms: ZoekerType = EXTERNE_WMS;

  private static createLayer(): ke.VectorLaag {
    return {
      type: ke.VectorType,
      titel: ZoekerUiSelector,
      source: new ol.source.Vector(),
      styleSelector: none,
      selectieStyleSelector: none,
      hoverStyleSelector: none,
      selecteerbaar: false,
      hover: false,
      minZoom: 2,
      maxZoom: 15,
      offsetveld: none,
      velden: OrderedMap<string, VeldInfo>(),
      verwijderd: false
    };
  }

  private static maakNieuwFeature(resultaat: ZoekResultaat): ol.Feature[] {
    function multiLineStringMiddlePoint(geometry: ol.geom.MultiLineString): ol.geom.Point {
      // voeg een puntelement toe ergens op de linestring om een icoon met nummer te tonen
      const lineStrings = geometry.getLineStrings();
      const lineString = lineStrings[Math.floor(lineStrings.length / 2)];
      return new ol.geom.Point(lineString.getCoordinateAt(0.5));
    }

    function polygonMiddlePoint(geometry: ol.geom.Geometry): ol.geom.Point {
      // in midden van gemeente polygon
      const extent = geometry.getExtent();
      return new ol.geom.Point([(extent[0] + extent[2]) / 2, (extent[1] + extent[3]) / 2]);
    }

    function createMiddlePointFeature(middlePoint: ol.geom.Point): ol.Feature {
      const middlePointFeature = new ol.Feature({
        data: resultaat,
        geometry: middlePoint,
        name: resultaat.omschrijving
      });
      resultaat.kaartInfo.map(kaartInfo => middlePointFeature.setStyle(kaartInfo.style));
      return middlePointFeature;
    }

    function createFeature(geometry: ol.geom.Geometry): ol.Feature {
      const feature = new ol.Feature({
        data: resultaat,
        geometry: geometry,
        name: resultaat.omschrijving
      });
      feature.setId(resultaat.bron + "_" + resultaat.featureIdSuffix);
      resultaat.kaartInfo.map(kaartInfo => feature.setStyle(kaartInfo.style));
      return feature;
    }

    function createFeatureAndMiddlePoint(geometry: ol.geom.Geometry): ol.Feature[] {
      return matchGeometryType(geometry, {
        multiLineString: multiLineStringMiddlePoint,
        polygon: polygonMiddlePoint,
        multiPolygon: polygonMiddlePoint
      }).foldL(() => [createFeature(geometry)], middlePoint => [createFeature(geometry), createMiddlePointFeature(middlePoint)]);
    }

    return resultaat.kaartInfo.fold([], kaartInfo => createFeatureAndMiddlePoint(kaartInfo.geometry));
  }

  constructor(
    parent: KaartComponent,
    zone: NgZone,
    private cd: ChangeDetectorRef,
    @Inject(ZOEKER_REPRESENTATIE) private zoekerRepresentatie: AbstractRepresentatieService
  ) {
    super(parent, zone);

    this.zoekerNamen$ = parent.modelChanges.zoekerServices$.pipe(
      map(svcs => svcs.map(svc => svc!.naam()).toSet()),
      debounceTime(250),
      shareReplay(1)
    );
    this.zoekerComponentOpNaam$ = this.zoekerComponentSubj.pipe(
      scan(
        (zoekerComponentOpNaam: Map<ZoekerType, GetraptZoekerComponent>, nz: Tuple<ZoekerType, GetraptZoekerComponent>) =>
          zoekerComponentOpNaam.set(nz.fst, nz.snd),
        Map<ZoekerType, GetraptZoekerComponent>()
      ),
      shareReplay(1)
    );
    this.bindToLifeCycle(
      this.zoekerComponentOpNaam$.pipe(switchMap(zcon => this.maakVeldenLeegSubj.pipe(collect((naam: ZoekerType) => zcon.get(naam)))))
    ).subscribe(zoekerGetraptComponent => zoekerGetraptComponent.maakVeldenLeeg(0));
  }

  protected kaartSubscriptions(): prt.Subscription<KaartInternalMsg>[] {
    return [prt.ZoekResultatenSubscription(r => this.processZoekerAntwoord(r))];
  }

  ngOnInit(): void {
    super.ngOnInit();
    this.dispatch({
      type: "VoegLaagToe",
      positie: 1,
      laag: ZoekerBoxComponent.createLayer(),
      magGetoondWorden: true,
      laaggroep: "Tools",
      legende: none,
      stijlInLagenKiezer: none,
      wrapper: kaartLogOnlyWrapper
    });
  }

  ngOnDestroy(): void {
    this.dispatch(prt.VerwijderLaagCmd(ZoekerUiSelector, kaartLogOnlyWrapper));
    super.ngOnDestroy();
  }

  protected refreshUI(): void {
    this.cd.detectChanges();
  }

  toggleResultaat() {
    this.toonResultaat = !this.toonResultaat;
    this.refreshUI();
  }

  toggleHelp() {
    this.toonHelp = !this.toonHelp;
    this.refreshUI();
  }

  zoomNaarResultaat(resultaat: ZoekResultaat) {
    this.toonResultaat = false;
    this.toonHelp = false;
    this.dispatch(prt.ZoekGekliktCmd(resultaat));
    resultaat.kaartInfo.filter(info => !ol.extent.isEmpty(info.extent)).map(info => {
      this.dispatch(prt.VeranderExtentCmd(info.geometry.getExtent()));
      if (info.geometry.getType() === "Point") {
        resultaat.preferredPointZoomLevel.map(zoom => this.dispatch(prt.VeranderZoomCmd(zoom, kaartLogOnlyWrapper)));
      }
      const selectedFeature = this.featuresByResultaat.get(resultaat)[0];
      this.highlight(selectedFeature, info);
    });
  }

  private highlight(nieuweFeature: ol.Feature, zoekKaartResultaat: ZoekKaartResultaat) {
    forEach(this.huidigeSelectie, selectie => selectie.feature.setStyle(selectie.zoekResultaat.style));
    nieuweFeature.setStyle(zoekKaartResultaat.highlightStyle);
    this.huidigeSelectie = some({
      feature: nieuweFeature,
      zoekResultaat: zoekKaartResultaat
    });
  }

  zoek() {
    if (this.zoekVeld.value) {
      this.toonResultaat = true;
      this.increaseBusy();
      this.dispatch({
        type: "Zoek",
        input: { type: "string", value: this.zoekVeld.value } as StringZoekInput,
        zoekers: Set(),
        wrapper: kaartLogOnlyWrapper
      });
    }
  }

  kuisZoekOp() {
    this.clearBusy();
    this.maakResultaatLeeg();
    this.focusOpZoekVeld();
  }

  focusOpZoekVeld() {
    setTimeout(() => {
      if (this.actieveZoeker === BASIS) {
        this.zoekVeldElement.nativeElement.focus();
      }
    });
  }

  onKey(event: any) {
    // De gebruiker kan locatie voorstellen krijgen door in het zoekveld max. 2 tekens in te typen en op enter te drukken
    if (event.keyCode === 13 && event.srcElement.value.length >= 2) {
      this.zoek();
    }
  }

  heeftFout(): boolean {
    return this.alleFouten.length > 0;
  }

  isInklapbaar(): boolean {
    return this.heeftFout() || this.alleZoekResultaten.length > 0 || [PERCEEL, CRAB, EXTERNE_WMS].indexOf(this.actieveZoeker) >= 0;
  }

  kiesZoeker(zoeker: ZoekerType) {
    this.clearBusy();
    this.maakResultaatLeeg();
    this.actieveZoeker = zoeker;
    this.focusOpZoekVeld();
    this.toonResultaat = true;
  }

  maakResultaatLeeg() {
    this.zoekVeld.setValue("");
    this.zoekVeld.markAsPristine();
    this.alleFouten = [];
    this.alleZoekResultaten = [];
    this.featuresByResultaat = Map<ZoekResultaat, ol.Feature[]>();
    this.huidigeSelectie = none;
    this.legende.clear();
    this.legendeKeys = [];
    this.dispatch(prt.VervangFeaturesCmd(ZoekerUiSelector, List(), kaartLogOnlyWrapper));
  }

  private processZoekerAntwoord(nieuweResultaten: ZoekResultaten): KaartInternalMsg {
    kaartLogger.debug("Process " + nieuweResultaten.zoeker);
    this.alleZoekResultaten = this.alleZoekResultaten
      .filter(resultaat => resultaat.zoeker !== nieuweResultaten.zoeker)
      .concat(nieuweResultaten.resultaten);
    this.alleZoekResultaten.sort((a, b) => compareResultaten(a, b, this.zoekVeld.value, this.zoekerRepresentatie));
    nieuweResultaten.legende.forEach((safeHtml, name) => this.legende.set(name!, safeHtml!));
    this.legendeKeys = this.legende.keySeq().toArray();

    this.alleFouten = this.alleFouten
      .filter(resultaat => resultaat.zoeker !== nieuweResultaten.zoeker)
      .concat(nieuweResultaten.fouten.map(fout => new Fout(nieuweResultaten.zoeker, fout)));

    this.featuresByResultaat = this.alleZoekResultaten.reduce(
      (map, resultaat) => map.set(resultaat, ZoekerBoxComponent.maakNieuwFeature(resultaat)),
      Map<ZoekResultaat, ol.Feature[]>()
    );

    this.decreaseBusy();
    this.dispatch(
      prt.VervangFeaturesCmd(
        ZoekerUiSelector,
        this.featuresByResultaat.toList().reduce((list, fs) => list!.push(...fs!), List<ol.Feature>()),
        kaartLogOnlyWrapper
      )
    );
    return {
      type: "KaartInternal",
      payload: none
    };
  }

  increaseBusy() {
    this.busy++;
    this.cd.detectChanges();
  }

  decreaseBusy() {
    if (this.busy > 0) {
      this.busy--;
    }
    this.cd.detectChanges();
  }

  clearBusy() {
    this.busy = 0;
  }

  isBusy(): boolean {
    return this.busy > 0;
  }

  onCrabMaakLeegDisabledChange(maakLeegDisabled: boolean): void {
    setTimeout(() => {
      this.crabMaakLeegDisabled = maakLeegDisabled;
    });
  }

  onPerceelMaakLeegDisabledChange(maakLeegDisabled: boolean): void {
    setTimeout(() => {
      this.perceelMaakLeegDisabled = maakLeegDisabled;
    });
  }

  onMaakLeegDisabledChange(zoekerNaam: ZoekerType, maakLeegDisabled: boolean): void {
    this.zoekerMaakLeegDisabled = maakLeegDisabled
      ? this.zoekerMaakLeegDisabled.add(zoekerNaam)
      : this.zoekerMaakLeegDisabled.remove(zoekerNaam);
  }

  availability$(zoekerNaam: ZoekerType): rx.Observable<boolean> {
    return this.zoekerNamen$.pipe(map(nmn => nmn.contains(zoekerNaam)));
  }

  maakVeldenLeeg(zoekerNaam: ZoekerType): void {
    this.maakVeldenLeegSubj.next(zoekerNaam);
  }

  isZoekerMaakLeegEnabled(zoekerNaam: ZoekerType) {
    return !this.zoekerMaakLeegDisabled.contains(zoekerNaam);
  }
}
