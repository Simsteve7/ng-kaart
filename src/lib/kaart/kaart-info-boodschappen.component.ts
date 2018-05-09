import { animate, state, style, transition, trigger } from "@angular/animations";
import { Component, NgZone, OnInit } from "@angular/core";
import { List } from "immutable";

import { observeOnAngular } from "../util/observe-on-angular";
import { ofType } from "../util/operators";
import { InfoBoodschap } from "./kaart-with-info-model";
import { KaartChildComponentBase } from "./kaart-child-component-base";
import { InfoBoodschappenMsg, infoBoodschappenMsgGen, KaartInternalMsg } from "./kaart-internal-messages";
import * as prt from "./kaart-protocol";
import { KaartComponent } from "./kaart.component";
import { Option } from "fp-ts/lib/Option";
import { SluitInfoBoodschapCmd } from "./kaart-protocol-commands";
import { Observable } from "rxjs/Observable";

@Component({
  selector: "awv-kaart-info-boodschappen",
  templateUrl: "./kaart-info-boodschappen.component.html",
  styleUrls: ["./kaart-info-boodschappen.component.scss"],
  animations: [
    trigger("fadeIn", [
      state("visible", style({ opacity: 1 })),
      transition(":enter", [style({ opacity: 0 }), animate(200)]),
      transition(":leave", animate(0, style({ opacity: 0 })))
    ])
  ]
})
export class KaartInfoBoodschappenComponent extends KaartChildComponentBase implements OnInit {
  infoBoodschappen$: Observable<List<InfoBoodschap>> = Observable.empty();

  constructor(parent: KaartComponent, zone: NgZone) {
    super(parent, zone);
  }

  protected kaartSubscriptions(): prt.Subscription<KaartInternalMsg>[] {
    return [prt.InfoBoodschappenSubscription(infoBoodschappenMsgGen)];
  }

  ngOnInit(): void {
    super.ngOnInit();

    this.infoBoodschappen$ = this.internalMessage$
      .pipe(
        ofType<InfoBoodschappenMsg>("InfoBoodschappen"), //
        observeOnAngular(this.zone)
      )
      .map(msg => msg.infoBoodschappen.reverse().toList()); // laatste boodschap bovenaan
  }

  verwijder(id: string, verwijderBoodschapMsgGen: () => Option<KaartInternalMsg>): void {
    this.dispatch(SluitInfoBoodschapCmd(id, verwijderBoodschapMsgGen));
  }
}