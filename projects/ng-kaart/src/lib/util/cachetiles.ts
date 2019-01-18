import * as ol from "openlayers";
import * as url from "url";

const resolutions = [1024.0, 512.0, 256.0, 128.0, 64.0, 32.0, 16.0, 8.0, 4.0, 2.0, 1.0, 0.5, 0.25, 0.125, 0.0625, 0.03125];
const lambert72 = "EPSG:31370";
const extentDienstkaart: [number, number, number, number] = [18000.0, 152999.75, 280144.0, 415143.75];

const decodeURLParams = search => {
  const hashes = search.slice(search.indexOf("?") + 1).split("&");
  return hashes.reduce((params, hash) => {
    const split = hash.indexOf("=");

    if (split < 0) {
      return Object.assign(params, {
        [hash]: null
      });
    }

    const key = hash.slice(0, split).toLowerCase();
    const val = hash.slice(split + 1);

    return Object.assign(params, { [key]: decodeURIComponent(val) });
  }, {});
};

const fetchUrls = (urls: string[]) => {
  const interval = 20; //  = 20 ms
  let timeout = interval;
  urls.forEach(url => {
    setTimeout(function() {
      fetch(new Request(url, { credentials: "include" }), { keepalive: true, mode: "cors" }).then(response => ({ response, cache: true }));
    }, timeout);
    timeout += interval;
  });
};

export const cacheTiles = (source: ol.source.Source, startZoom: number, stopZoom: number, wkt: string) => {
  const geometry: ol.geom.Geometry = new ol.format.WKT()
    .readFeature(wkt, {
      dataProjection: lambert72,
      featureProjection: lambert72
    })
    .getGeometry();

  const extent: ol.Extent = geometry.getExtent();

  if (isNaN(startZoom)) {
    throw new Error("Start zoom is geen getal");
  }

  if (isNaN(stopZoom)) {
    throw new Error("Stop zoom is geen getal");
  }

  const tileGrid = new ol.tilegrid.TileGrid({
    extent: extentDienstkaart,
    resolutions: resolutions
  });

  // source.getProjection() lijkt niet te werken?
  const projection: ol.proj.Projection = ol.proj.get(lambert72);
  projection.setExtent(extentDienstkaart); // zet de extent op die van de dienstkaart

  let queue = [];

  const tileUrlFunction = (source as ol.source.UrlTile).getTileUrlFunction();

  for (let z = startZoom; z < stopZoom + 1; z++) {
    // Tilecoord: [z, x, y]
    const minTileCoord = tileGrid.getTileCoordForCoordAndZ([extent[0], extent[1]], z);
    const maxTileCoord = tileGrid.getTileCoordForCoordAndZ([extent[2], extent[3]], z);

    const tileRangeMinX = minTileCoord[1];
    const tileRangeMinY = minTileCoord[2];

    const tileRangeMaxX = maxTileCoord[1];
    const tileRangeMaxY = maxTileCoord[2];

    const queueByZ = [];
    for (let x = tileRangeMinX; x <= tileRangeMaxX; x++) {
      for (let y = tileRangeMinY; y <= tileRangeMaxY; y++) {
        const tileCoord: [number, number, number] = [z, x, y];
        const tileUrl = tileUrlFunction(tileCoord, ol.has.DEVICE_PIXEL_RATIO, projection);
        const queryParams = url.parse(tileUrl).search;
        const bbox = decodeURLParams(queryParams)["bbox"];
        if (bbox) {
          // left,bottom,right,top
          const coordinatesBbox = bbox.split(",");

          const left = coordinatesBbox[0];
          const bottom = coordinatesBbox[1];
          const right = coordinatesBbox[2];
          const top = coordinatesBbox[3];

          const ltCoord: [number, number] = [left, top];
          const lbCoord: [number, number] = [left, bottom];
          const rtCoord: [number, number] = [right, top];
          const rbCoord: [number, number] = [right, bottom];

          if (
            geometry.intersectsCoordinate(ltCoord) ||
            geometry.intersectsCoordinate(lbCoord) ||
            geometry.intersectsCoordinate(rtCoord) ||
            geometry.intersectsCoordinate(rbCoord)
          ) {
            queueByZ.push(tileUrl);
          }
        } else {
          alert(`Geen bbox parameter in URL ${queryParams}`);
        }
      }
    }

    console.log("Aantal tiles voor zoomniveau " + z + ": " + queueByZ.length);
    queue = queue.concat(queueByZ);
  }

  fetchUrls(queue);
};
