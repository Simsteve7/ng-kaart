import { array, option, ord, tuple } from "fp-ts";
import { Function1 } from "fp-ts/lib/function";
import { pipe } from "fp-ts/lib/pipeable";

import * as arrays from "../util/arrays";
import { PartialFunction2 } from "../util/function";
import { distance } from "../util/geometries";
import * as ol from "../util/openlayers-compat";

/// ///////////////////////////////////////////////////////////////////////////////
// Functies om bij een select de dichtstbijzijnde feature te selecteren.
//
// Dit is op basis van een OL multi select waarvan we alle behalve 1 feature (de
// dichtste) weerhouden. Het probleem met de native select van OL is dat die de
// eerste feature (volgens een of andere arbitraire volgorde) selecteert.

const distanceFromPointOrd: Function1<
  ol.Coordinate,
  ord.Ord<tuple.Tuple<ol.Feature, ol.geom.Geometry>>
> = (coord) =>
  tuple.getOrd(
    ord.fromCompare((_) => 0),
    ord.contramap(
      (geometry) => distance(coord, geometry.getClosestPoint(coord)),
      ord.ordNumber
    )
  );

export const findClosest: PartialFunction2<
  ol.Feature[],
  ol.Coordinate,
  ol.Feature
> = (features, clickLoc) => {
  return pipe(
    features,
    array.filterMap((f) =>
      pipe(
        f.getGeometry(),
        option.fromNullable,
        option.map((g) => new tuple.Tuple(f, g))
      )
    ),
    arrays.findFirstBy(distanceFromPointOrd(clickLoc)),
    option.map(tuple.fst)
  );
};
