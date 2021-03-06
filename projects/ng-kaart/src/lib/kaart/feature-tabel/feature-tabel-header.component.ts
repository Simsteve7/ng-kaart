import {
  ChangeDetectionStrategy,
  Component,
  Input,
  NgZone,
} from "@angular/core";
import * as rx from "rxjs";
import {
  distinctUntilChanged,
  map,
  mapTo,
  share,
  switchMap,
  tap,
} from "rxjs/operators";

import { collectOption } from "../../util/operators";
import { KaartChildDirective } from "../kaart-child.directive";
import { kaartLogOnlyWrapper } from "../kaart-internal-messages";
import * as cmd from "../kaart-protocol-commands";
import { KaartComponent } from "../kaart.component";

import { FeatureTabelOverzichtComponent } from "./feature-tabel-overzicht.component";
import { TableHeader } from "./table-header-model";
import { TableModel } from "./table-model";

@Component({
  selector: "awv-feature-tabel-header",
  templateUrl: "./feature-tabel-header.component.html",
  styleUrls: ["./feature-tabel-header.component.scss"],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeatureTabelHeaderComponent extends KaartChildDirective {
  header$: rx.Observable<TableHeader>;

  @Input()
  laagTitel: string;

  constructor(
    kaart: KaartComponent,
    overzicht: FeatureTabelOverzichtComponent,
    ngZone: NgZone
  ) {
    super(kaart, ngZone);

    const model$ = overzicht.tableModel$;

    const laag$ = this.viewReady$.pipe(
      // De input is pas beschikbaar nadat de view klaar is
      switchMap(() =>
        model$.pipe(
          collectOption(TableModel.laagForTitel(this.laagTitel)),
          share()
        )
      )
    );

    this.header$ = laag$.pipe(
      map(TableHeader.toHeader),
      distinctUntilChanged(TableHeader.setoidTableHeader.equals),
      share()
    );

    const toggleActivityCmd$ = this.header$.pipe(
      switchMap((header) =>
        this.actionFor$("toggleFilterActive").pipe(
          mapTo(
            cmd.ActiveerFilter(
              header.titel,
              !header.filterIsActive,
              kaartLogOnlyWrapper
            )
          )
        )
      )
    );

    this.runInViewReady(
      toggleActivityCmd$.pipe(tap((cmd) => this.dispatch(cmd)))
    );
  }
}
