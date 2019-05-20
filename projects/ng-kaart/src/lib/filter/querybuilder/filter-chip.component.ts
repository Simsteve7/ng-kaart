import { Component, EventEmitter, Input, Output } from "@angular/core";
import { Endomorphism } from "fp-ts/lib/function";

import { FilterEditor as fed } from "../filter-builder";

@Component({
  selector: "awv-filter-chip",
  templateUrl: "./filter-chip.component.html",
  styleUrls: ["./filter-chip.component.scss"]
})
export class FilterChipComponent {
  @Input()
  editor: fed.TermEditor;

  @Input()
  expressionEditor: fed.ExpressionEditor;

  @Output()
  expressionEditorUpdate: EventEmitter<Endomorphism<fed.ExpressionEditor>> = new EventEmitter();

  setCurrent() {
    this.expressionEditorUpdate.emit(fed.setCurrent(this.editor));
  }

  isCurrentStyle(): string {
    return this.expressionEditor && fed.isCurrent(this.expressionEditor)(this.editor) ? "selected" : "";
  }

  asOperatorSelection(): fed.OperatorSelection {
    return this.editor as fed.OperatorSelection;
  }

  asValueSelection(): fed.ValueSelection {
    return this.editor as fed.ValueSelection;
  }

  asCompleted(): fed.Completed {
    return this.editor as fed.Completed;
  }
}