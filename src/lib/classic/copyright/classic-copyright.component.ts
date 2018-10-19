import { Component, Input, NgZone } from "@angular/core";

import { CopyrightOpties, CopyrightUISelector } from "../../kaart/copyright/kaart-copyright.component";
import { ClassicUIElementSelectorComponentBase } from "../common/classic-ui-element-selector-component-base";
import { KaartClassicComponent } from "../kaart-classic.component";

@Component({
  selector: "awv-kaart-copyright",
  template: ""
})
export class ClassicCopyrightComponent extends ClassicUIElementSelectorComponentBase {
  @Input()
  copyright = "\u00A9 Agentschap Wegen en Verkeer";

  constructor(kaart: KaartClassicComponent, zone: NgZone) {
    super(CopyrightUISelector, kaart, zone);
  }

  protected opties(): CopyrightOpties {
    return {
      copyright: this.copyright
    };
  }
}
