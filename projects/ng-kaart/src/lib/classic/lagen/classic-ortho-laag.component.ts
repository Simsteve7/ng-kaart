import { HttpClient } from "@angular/common/http";
import { Component, Inject, Input, NgZone, ViewEncapsulation } from "@angular/core";
import { fromNullable } from "fp-ts/lib/Option";

import { KAART_CFG, KaartConfig } from "../../kaart/kaart-config";
import { TiledWmsType, WmsLaag } from "../../kaart/kaart-elementen";
import { KaartClassicComponent } from "../kaart-classic.component";

import * as arrays from "../../util/arrays";

import { ClassicWmsLaagComponent } from "./classic-wms-laag.component";

@Component({
  selector: "awv-kaart-ortho-laag",
  template: "<ng-content></ng-content>",
  encapsulation: ViewEncapsulation.None
})
export class ClassicOrthoLaagComponent extends ClassicWmsLaagComponent {
  constructor(kaart: KaartClassicComponent, @Inject(KAART_CFG) private readonly config: KaartConfig, zone: NgZone, http: HttpClient) {
    super(kaart, zone, http);
  }

  createLayer(): WmsLaag {
    const urls = arrays.isArray(this.urls) && arrays.isNonEmpty(this.urls) ? this.urls : this.config.orthofotomozaiek.urls;
    const laagnaam = this.laagNaam || this.config.orthofotomozaiek.naam;
    return {
      type: TiledWmsType,
      titel: this.titel,
      naam: laagnaam,
      urls: urls,
      versie: fromNullable(this.versie),
      tileSize: fromNullable(this.tileSize),
      format: fromNullable(this.format),
      opacity: fromNullable(this.opacity),
      backgroundUrl: this.backgroundUrl(urls, laagnaam),
      minZoom: this.minZoom,
      maxZoom: this.maxZoom,
      verwijderd: false
    };
  }
}
