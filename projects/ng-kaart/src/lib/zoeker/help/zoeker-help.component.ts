import { Component, NgZone, ViewEncapsulation } from "@angular/core";
import { DomSanitizer, SafeHtml } from "@angular/platform-browser";
import { none, Option, some } from "fp-ts/lib/Option";
import * as rx from "rxjs";
import { map } from "rxjs/operators";

import { KaartChildComponentBase } from "../../kaart/kaart-child-component-base";
import { KaartComponent } from "../../kaart/kaart.component";
import { ZoekerHelpBoom, ZoekerMetPrioriteiten } from "../zoeker";

interface ZoekHelpNode {
  readonly titel: string;
  readonly children: Map<string, ZoekHelpNode>;
  readonly text: Option<string>;
}

interface HelpContent {
  readonly titel: string;
  readonly text?: SafeHtml;
  readonly isLeaf: boolean;
}

class ZoekerHelpBoomImpl implements ZoekerHelpBoom {
  private root: ZoekHelpNode = {
    titel: "Ik zoek",
    children: new Map(),
    text: none
  };

  voegItemToe(text: string, ...titles: string[]) {
    let parent: ZoekHelpNode = this.root;

    titles.forEach((title, index) => {
      if (!parent.children.has(title)) {
        parent.children.set(title, {
          titel: title,
          children: new Map(),
          text: index === titles.length - 1 ? some(text) : none
        });
      }
      parent = parent.children.get(title)!;
    });
  }

  boom(): ZoekHelpNode {
    return this.root;
  }
}

const bouwZoekBoom = (zoekers: ZoekerMetPrioriteiten[]) => {
  const visitor = new ZoekerHelpBoomImpl();
  // We laten iedere zoeker de helpBoom verder opbouwen.
  zoekers.forEach(zoeker => zoeker.zoeker.help(visitor));
  return visitor.boom();
};

const zoekHelpNodeToHelpContent = (domSanitizer: DomSanitizer, node: ZoekHelpNode) => {
  return { titel: node.titel, text: node.text.map(domSanitizer.bypassSecurityTrustHtml).toNullable(), isLeaf: node.children.size === 0 };
};

const selecteerUitBoom = (domSanitizer: DomSanitizer, node: ZoekHelpNode, subPath: string[]) => {
  if (subPath.length === 0) {
    return some(Array.from(node.children.values()).map(child => zoekHelpNodeToHelpContent(domSanitizer, child)));
  } else {
    const childNode = node.children.get(subPath[0]);
    if (childNode) {
      return selecteerUitBoom(domSanitizer, childNode, subPath.slice(1));
    } else {
      return none;
    }
  }
};

@Component({
  selector: "awv-zoeker-help",
  templateUrl: "./zoeker-help.component.html",
  styleUrls: ["./zoeker-help.component.scss"],
  encapsulation: ViewEncapsulation.None
})
export class ZoekerHelpComponent extends KaartChildComponentBase {
  private pad: rx.BehaviorSubject<string[]> = new rx.BehaviorSubject(["Ik zoek"]);
  selectie$: rx.Observable<HelpContent[] | undefined>;

  constructor(parent: KaartComponent, zone: NgZone, private domSanitizer: DomSanitizer) {
    super(parent, zone);

    const tree$ = parent.modelChanges.zoekerServices$.pipe(map(bouwZoekBoom));

    this.selectie$ = rx.combineLatest(tree$, this.pad$).pipe(
      map(([root, selectiePad]) => selecteerUitBoom(this.domSanitizer, root, selectiePad.slice(1))),
      map(optionalSelectie => optionalSelectie.getOrElse(undefined))
    );
  }

  get pad$(): rx.Observable<string[]> {
    return this.pad.asObservable();
  }

  selecteer(pad: string, index?: number) {
    this.pad.next(
      this.pad
        .getValue()
        .slice(0, index)
        .concat(pad)
    );
  }
}