var fs = require("fs");
var package = JSON.parse(fs.readFileSync("dist/ng-kaart/package.json", "utf8"));

if ( process.argv[2] ) {
  package["publishConfig"]["registry"] = process.argv[2];
  delete package["publishConfig"]["access"];  
} else {
  package["publishConfig"]["registry"] = "https://registry.npmjs.org/";
  package["publishConfig"]["access"] = "public";
}

fs.writeFileSync("dist/ng-kaart/package.json", JSON.stringify(package), "utf8");
