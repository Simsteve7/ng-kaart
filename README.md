# AWV angular kaart component

[![Build Status](https://travis-ci.org/WegenenVerkeer/ng-kaart.svg?branch=master)](https://travis-ci.org/WegenenVerkeer/ng-kaart)

Angular kaart component gebaseerd op open layers voor gebruik bij AWV.

## Waar te vinden?

Deze component is gepubliceerd als `@wegenenverkeer/ng-kaart` op [NPM](https://www.npmjs.com/package/@wegenenverkeer/ng-kaart).

## Hoe werkt het?

We gebruiken de library support van angular cli, zie ook [https://github.com/angular/angular-cli/wiki/stories-create-library]()

## Beperkingen

Deze component is enkel ontwikkeld om gebruikt te worden op Google Chrome. Om in Firefox te werken bijvoorbeeld zijn een aantal shims nodig. Zie ook de openlayers website.

## Material fonts

De component gaat ervan uit dat de materialfonts beschikbaar zijn.

Dit kan door de fonts rechtstreeks te laden. Dit wordt door Google aangeraden, maar in sommige gevallen wordt dit blijbaar door een adblocker gestopt.

```html
<link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet" />
```

Een andere manier is om op het "material-design-icons" npm package te dependen en dit ergens in een globale stijl te includen:

```scss
@import "~material-design-icons/iconfont/material-icons.css";
```


## Development

Deze component is gebaseerd op de source code van de kaartcomponent gebruikt door district center.
Nog niet alle features van de oorspronkelijke component zijn geïmplementeerd. Gelieve voor noodzakelijke features een featurerequest in github aan te maken.

### Zoom niveau's en resoluties

Er worden op de AWV dienstkaart standaard 16 zoomniveau's voorzien.
Het hoogste zoomniveau (gans Vlaanderen) is zoomniveau 0 (enkel districtkleuren en nummers te zien).
Standaard starten we alle applicaties met een kaart op zoomniveau 2 (de hoofdsnelwegen en districtkleuren zichtbaar).
Het diepste zoomniveau is zoom niveau 15. Dit is aanpasbaar door de minZoom en maxZoom parameters aan te passen in het kaart object.

Traditioneel gebruikt OpenLayers zoomniveaus en resoluties door elkaar, maar in de kaartcomponent streven we ernaar om enkel met zoomniveau te werken.
Ter referentie de overeenkomstige resoluties van onze kaart zijn [1024, 512, 256, 128, 64, 32, 16, 8, 4, 2, 1, 0.5, 0.25, 0.125, 0.0625, 0.03125].
Dwz standaard start de kaart op zoom niveau 2, resolutie 256.

### Volgorde van lagen

Lagen worden toegevoegd aan de kaart in de volgorde die waarin ze gedefinieerd zijn in de html code. De eerste laag wordt onderaan getoond, alle volgende lagen erboven. Zorg
er daarom voor dat je eerst achtergrondlagen toevoegt en dan pas vectorlagen, vermits achtergrondlagen meestal
opaak zijn en de vectorlagen anders niet zichtbaar zullen zijn.

### Slepen van lagen

Om het slepen van lagen op mobiele toestellen te ondersteunen, dient de oproepende applicatie gebruik te maken van een polyfill die touch events voor draggable componenten omzet in drag events (mobiele toestellen doen dit standaard niet).

Voeg dit toe in polyfills.ts:

    import "drag-drop-touch/DragDropTouch"; // translates touch events into standard HTML5 drag drop events

En dit in package.json:

    "drag-drop-touch": "1.3.0",


### Motion sensors.

Om de mobiele-tracking te doen werken op alle browsers, hebben we een polyfill nodig.

Voeg dit toe in polyfills.ts:

    import "motion-sensors-polyfill/src/motion-sensors.js";

En dit in package.json:

    "motion-sensors-polyfill": "0.3.1",


### Code testen

Deze component library is voorzien van een test Angular app. Omdat de build van de library en de testApp volledig gescheiden zijn, moet je eerst de library builden en watchen voor changes:

    npm run watch
    
Dan kan je de testApp runnen:

    npm start

Deze is dan te bereiken via http://localhost:4220/ng-kaart

Alle veranderingen in de library code zullen door de watch opgemerkt worden en (uiteindelijk) tot een reload van de testApp leiden.

In `src/app/testApp` kan je je module toevoegen en op de pagina plaatsen om zo door te testen.

Dit laat je ook toe om protractors te schrijven.

Tot slot vormt de source code van deze pagina de gebruiksaanwijzing van de componenten.

### CORS requests

#### Locatiezoeker

* Zet chrome open zonder web security om dit te testen.

    macos:

        open -a Google\ Chrome --args --disable-web-security --user-data-dir

    *nix:

        chromium-browser --disable-web-security --user-data-dir

#### NosqlFs laag

Ook de NosqlFs laag demo maakt een verbinding met een server die niet op op localhost:4420 draait. CORS requestvalidatie afzetten is hier eveneens de oplossing.


### Offline caching

#### Service worker security

Er zijn enkele security issues die het lokaal ontwikkelen van de service worker (ter implementatie van de offline caching van kaarten) bemoeilijken. 
Daarom dient via een docker stack gewerkt te worden. Deze heeft echter het nadeel dat live reload niet werkt vanachter een proxy (socksjs wordt niet gevonden). Een manuele refresh is dus nodig 
om de code te verversen. 

De security issues:

1. Service workers worden enkel ingeladen indien de applicatie opgeroepen wordt via localhost óf indien via een **https:** url
2. De service worker onderschept URL's relatief tot zijn eigen domein, doch de dienstkaart wordt geserved door een apart docker VM, dus we moeten met het lokaal apigateway domain werken

Om lokaal de applicatie te draaien dient de docker stack gestart te worden via 

    docker-compose up -d

Start vervolgens de applicatie op via 

    npm run start-apigateway

De demo pagina is vervolgens te bereiken via **https://apigateway/ng-kaart**

Het https certificaat is geen geldig certificaat, dus Chrome dient opgestart te worden met extra parameters, anders wordt de service worker niet ingeladen:

MacOS:

        open -a Google\ Chrome --args --disable-web-security --user-data-dir --ignore-certificate-errors --unsafely-treat-insecure-origin-as-secure 

Linux:

        chromium-browser --disable-web-security --user-data-dir --ignore-certificate-errors --unsafely-treat-insecure-origin-as-secure 

Ga vervolgens naar de applicatie via https://apigateway/ng-kaart en voeg een uitzondering voor een niet geldig certificaat.

Opgepast: doe geen shift-reload in Chrome om de applicatie te refreshen. Deze actie zorgt er immers voor dat de service worker volledig genegeerd wordt (cfr https://developers.google.com/web/fundamentals/primers/service-workers/lifecycle#shift-reload)

#### Offline kaarten ondersteunen

Om het *@Input offline* attribuut van de kaart lagen te kunnen gebruiken dient de service worker geinstalleerd te worden. 

Kopieer ng-kaart-service-worker.js naar de root van je applicatie. Registreer deze zoals gedaan werd in App.Module.ts

```
  ServiceWorkerModule.register("<context>/ng-kaart-service-worker.js", {
      enabled: true
    }),
```

En voeg deze toe als een asset in angular.json

```
  "assets": [
              "src/favicon.ico",
              "src/ng-kaart-service-worker.js",
              "src/assets"
            ],
```

Om het debuggen te vergemakkelijken neem je volgend uit commentaar in ng-kaart-service-worker.js:

```
  workbox.setConfig({
    debug: true
  });
```

### Code style

De code style wordt automatisch afgedwongen via tslint + prettier. Deze is ingesteld dat de code wordt herschreven on commit, tenzij er brekende wijzigingen zijn (zoals foute typering en dergelijke meer).

## Publish

We gebruiken [travis-ci](https://travis-ci.org/WegenenVerkeer/ng-kaart) als CI tool.
Travis wordt automatisch gestart bij een push naar github.

## Filestructuur

### Componenten

We hebben twee grote categorieën van componenten:
1. componenten die de nodig zijn voor de werking van ng-kaart ongeacht af die aangestuurd wordt door de API of de `awv-kaart-classic` tag
2. componenten die dienen om ng-kaart aan te sturen op de traditionele Angularmanier.

De eerste komen in directories onder `projects/ng-kaart/src/lib/kaart/<component>` en de naam begint met `Kaart`. 

De tweede soort komt in directories onder `projects/ng-kaart/src/lib/classic/<component>` en de naam begint met `Classic`.

We hebben dan bijv.:

```
projects
  ng-kaart
    src
      lib
        kaart
          schaal
            kaart-schaal.component.ts
            kaart-schaal.component.html
            kaart-schaal.component.scss
          ...
        classic
          lagenkiezer
            classic-lagenkiezer.component.ts
            classic-lagenkiezer.component.html
            classic-lagenkiezer.component.scss
          ...
        ...
      ...  
```

`kaart-schaal.component.ts` bevat `KaartSchaalComponent` en `classic-lagenkiezer.component` bevat `ClassicLagenkiezerComponent`.

### Reducers e.d.

Voorlopig kunnen die direct onder `projects/ng-kaart/src/lib/kaart` blijven.

# Resources

* [Angular Package Format v4.0](https://goo.gl/AMOU5G)
* [NGConf 2017 presentatie](https://www.youtube.com/watch?v=unICbsPGFIA)

* [https://github.com/jasonaden/simple-ui-lib]()
* [https://github.com/filipesilva/angular-quickstart-lib]()

