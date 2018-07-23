import { Component, NgZone, OnDestroy, OnInit, ViewEncapsulation } from "@angular/core";
import { fromNullable, none, Option, some } from "fp-ts/lib/Option";
import { OrderedMap } from "immutable";
import * as ol from "openlayers";
import { Subject } from "rxjs";
import { distinctUntilChanged, map, skipWhile } from "rxjs/operators";
import * as uuid from "uuid";

import { dimensieBeschrijving } from "../../util/geometries";
import { forEach, orElse } from "../../util/option";
import { KaartChildComponentBase } from "../kaart-child-component-base";
import * as ke from "../kaart-elementen";
import { VeldInfo } from "../kaart-elementen";
import { KaartInternalMsg, kaartLogOnlyWrapper, tekenWrapper } from "../kaart-internal-messages";
import * as prt from "../kaart-protocol";
import { KaartComponent } from "../kaart.component";
import { asStyleSelector, toStylish } from "../stijl-selector";

export const TekenenUiSelector = "Kaarttekenen";
export const TekenLaagNaam = "Tekenen van geometrie";
const defaultlaagStyle = new ol.style.Style({
  fill: new ol.style.Fill({
    color: "rgba(255, 255, 255, 0.2)"
  }),
  stroke: new ol.style.Stroke({
    color: "#ffcc33",
    width: 2
  }),
  image: new ol.style.Circle({
    radius: 7,
    fill: new ol.style.Fill({
      color: "#ffcc33"
    })
  })
});
const defaultDrawStyle = new ol.style.Style({
  fill: new ol.style.Fill({
    color: "rgba(255, 255, 255, 0.2)"
  }),
  stroke: new ol.style.Stroke({
    color: "rgba(0, 0, 0, 0.5)",
    lineDash: [10, 10],
    width: 2
  }),
  image: new ol.style.Circle({
    radius: 5,
    stroke: new ol.style.Stroke({
      color: "rgba(0, 0, 0, 0.7)"
    }),
    fill: new ol.style.Fill({
      color: "rgba(255, 255, 255, 0.2)"
    })
  })
});
@Component({
  selector: "awv-kaart-teken-laag",
  template: "<ng-content></ng-content>",
  styleUrls: ["./kaart-teken-laag.component.scss"],
  encapsulation: ViewEncapsulation.None
})
export class KaartTekenLaagComponent extends KaartChildComponentBase implements OnInit, OnDestroy {
  private changedGeometriesSubj: Subject<ke.TekenResultaat>;

  private source: ol.source.Vector;
  private drawInteraction: ol.interaction.Draw;
  private modifyInteraction: ol.interaction.Modify;
  private snapInteraction: ol.interaction.Snap;
  private overlays: Array<ol.Overlay> = [];

  constructor(parent: KaartComponent, zone: NgZone) {
    super(parent, zone);
  }

  protected kaartSubscriptions(): prt.Subscription<KaartInternalMsg>[] {
    return [prt.TekenenSubscription(tekenWrapper)];
  }

  ngOnInit(): void {
    super.ngOnInit();

    this.bindToLifeCycle(
      this.kaartModel$.pipe(
        distinctUntilChanged((k1, k2) => k1.geometryChangedSubj === k2.geometryChangedSubj), //
        map(kwi => kwi.geometryChangedSubj)
      )
    ).subscribe(gcSubj => (this.changedGeometriesSubj = gcSubj));

    this.bindToLifeCycle(
      this.kaartModel$.pipe(
        map(kwi => kwi.tekenSettingsSubj.getValue()), //
        distinctUntilChanged(),
        skipWhile(settings => settings.isNone()) // De eerste keer willen we startMetTekenen emitten
      )
    ).subscribe(settings => {
      settings.foldL(
        () => this.stopMetTekenen(), //
        ts => this.startMetTekenen(ts) //
      );
    });
  }

  ngOnDestroy(): void {
    this.stopMetTekenen();
    super.ngOnDestroy();
  }

  private startMetTekenen(tekenSettings: ke.TekenSettings): void {
    this.source = new ol.source.Vector();
    this.dispatch({
      type: "VoegLaagToe",
      positie: 0,
      laag: this.createLayer(this.source, tekenSettings),
      magGetoondWorden: true,
      laaggroep: "Tools",
      legende: none,
      stijlInLagenKiezer: none,
      wrapper: kaartLogOnlyWrapper
    });

    this.drawInteraction = this.createDrawInteraction(this.source, tekenSettings);
    this.dispatch(prt.VoegInteractieToeCmd(this.drawInteraction));

    this.modifyInteraction = new ol.interaction.Modify({ source: this.source });
    this.dispatch(prt.VoegInteractieToeCmd(this.modifyInteraction));

    this.snapInteraction = new ol.interaction.Snap({ source: this.source });
    this.dispatch(prt.VoegInteractieToeCmd(this.snapInteraction));
  }

  private stopMetTekenen(): void {
    this.dispatch(prt.VerwijderInteractieCmd(this.drawInteraction));
    this.dispatch(prt.VerwijderInteractieCmd(this.modifyInteraction));
    this.dispatch(prt.VerwijderInteractieCmd(this.snapInteraction));
    this.dispatch(prt.VerwijderOverlaysCmd(this.overlays));
    this.dispatch(prt.VerwijderLaagCmd(TekenLaagNaam, kaartLogOnlyWrapper));
  }

  private createLayer(source: ol.source.Vector, tekenSettings: ke.TekenSettings): ke.VectorLaag {
    return {
      type: ke.VectorType,
      titel: TekenLaagNaam,
      source: source,
      styleSelector: orElse(tekenSettings.laagStyle, () => asStyleSelector(defaultlaagStyle)),
      selectieStyleSelector: none,
      hoverStyleSelector: none,
      selecteerbaar: false,
      hover: false,
      minZoom: 2,
      maxZoom: 15,
      offsetveld: none,
      velden: OrderedMap<string, VeldInfo>()
    };
  }

  private createMeasureTooltip(): [HTMLDivElement, ol.Overlay] {
    const measureTooltipElement: HTMLDivElement = document.createElement("div");
    measureTooltipElement.className = "tooltip tooltip-measure";
    const measureTooltip = new ol.Overlay({
      element: measureTooltipElement,
      offset: [0, -15],
      positioning: "bottom-center"
    });

    this.dispatch({
      type: "VoegOverlayToe",
      overlay: measureTooltip
    });

    this.overlays.push(measureTooltip);

    return [measureTooltipElement, measureTooltip];
  }

  private createDrawInteraction(source: ol.source.Vector, tekenSettings: ke.TekenSettings): ol.interaction.Draw {
    const draw = new ol.interaction.Draw({
      source: source,
      type: tekenSettings.geometryType,
      style: tekenSettings.drawStyle.map(toStylish).getOrElse(defaultDrawStyle)
    });

    draw.on(
      "drawstart",
      (event: ol.interaction.Draw.Event) => {
        const [measureTooltipElement, measureTooltip] = this.createMeasureTooltip();
        const feature = (event as ol.interaction.Draw.Event).feature;
        const volgnummer = this.volgendeVolgnummer();
        feature.set("volgnummer", volgnummer);
        feature.setId(uuid.v4());
        feature.getGeometry().on(
          "change",
          evt => {
            const geometry = evt.target as ol.geom.Geometry;
            this.changedGeometriesSubj.next(ke.TekenResultaat(geometry, volgnummer, feature.getId()));
            measureTooltipElement.innerHTML = this.tooltipText(volgnummer, geometry);
            forEach(this.tooltipCoord(geometry), coord => measureTooltip.setPosition(coord));
          },
          this
        );
      },
      this
    );

    draw.on(
      "drawend", //
      () => {
        // TODO: als configuratie zegt dat we maar 1 geometry mogen hebben.
        // this.dispatch(prt.VerwijderInteractieCmd(this.drawInteraction));
      },
      this
    );

    return draw;
  }

  private volgendeVolgnummer(): number {
    const maxVolgNummer = this.source
      .getFeatures()
      .map(feature => fromNullable(feature.get("volgnummer")))
      .filter(optional => optional.isSome())
      .map(optional => optional.toNullable())
      .reduce((maxVolgNummer: number, volgNummer: number) => Math.max(maxVolgNummer, volgNummer), 0);
    return maxVolgNummer + 1;
  }

  tooltipText(volgnummer: number, geometry: ol.geom.Geometry): string {
    return volgnummer + ": " + dimensieBeschrijving(geometry, false);
  }

  tooltipCoord(geometry: ol.geom.Geometry): Option<ol.Coordinate> {
    switch (geometry.getType()) {
      case "Polygon":
        return some((geometry as ol.geom.Polygon).getInteriorPoint().getCoordinates());
      case "LineString":
        return some((geometry as ol.geom.LineString).getLastCoordinate());
      default:
        return none;
    }
  }
}
