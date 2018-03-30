import { Component, OnDestroy, OnInit } from "@angular/core";

import { KaartClassicComponent } from "./kaart-classic.component";
import { kaartLogOnlyWrapper } from "./kaart-internal-messages";

@Component({
  selector: "awv-kaart-schaal",
  template: "<ng-content></ng-content>"
})
export class KaartSchaalComponent implements OnInit, OnDestroy {
  constructor(private readonly kaart: KaartClassicComponent) {}

  ngOnInit(): void {
    this.kaart.dispatch({ type: "VoegSchaalToe", wrapper: kaartLogOnlyWrapper });
  }

  ngOnDestroy(): void {
    this.kaart.dispatch({ type: "VerwijderSchaal", wrapper: kaartLogOnlyWrapper });
  }
}
