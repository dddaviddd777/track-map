# Track Map

App per seguir tracks de Wikiloc (GPX/KML) sobre mapes de l'ICGC, al mòbil Android, també sense cobertura.

## Què fa

- **Afegir tracks**: botó de la línia ➜ *Afegir track* ➜ tria el fitxer GPX o KML (per exemple, de Descàrregues). Si no el veus, toca *Mostra tots els fitxers*.
- **Obrir des de WhatsApp o altres apps**: amb l'app instal·lada, al fitxer GPX toca *Compartir* ➜ *Track Map*.
- **Mapes**: topogràfic de l'ICGC (corriols i corbes de nivell), satèlit (ortofoto) i un topogràfic lleuger.
- **Noms al satèlit**: amb el satèlit posat, el botó *Aa* mostra o amaga els noms de pobles, cims, masies i camins. Per tenir-los sense cobertura, descarrega també «Satèlit amb noms» (ocupa unes 5 vegades més).
- **La teva posició**: botó gran de baix. Un toc et centra i et segueix; si mous el mapa, deixa de seguir-te.
- **Orientació del mapa**: el botó de la brúixola (a sobre del de posició) fa girar el mapa segons cap on apunta el mòbil. Torna-hi a tocar per posar el nord a dalt.
- **Seguiment**: a la barra de baix veus els km fets i els que falten, la pujada i la baixada que queden, i un avís si t'allunyes més de 40 m del track.
- **Perfil d'altitud**: toca'l o arrossega-hi el dit per veure aquell punt al mapa.
- **Plegar la barra del track**: toca el nom del track (o la fletxa) per deixar només una línia amb el que falta i veure més mapa.
- **Google Maps**: mantén el dit premut sobre un punt del mapa per obrir-lo a Google Maps o demanar com arribar-hi (et porta a la carretera o pista més propera).
- **Compartir la meva ubicació**: toca el punt blau per enviar on ets per WhatsApp, SMS, etc.
- **Pantalla encesa**: botó del sol. Evita que la pantalla s'apagui mentre camines.
- **Sense cobertura**: en afegir un track, l'app pregunta si vols guardar *només el track* o *el track amb mapes*. També pots descarregar els mapes després amb la fletxa avall. A la llista, cada track indica *Offline* (amb el que ocupa) o *Sense mapes*. Descarrega-ho **a casa, amb wifi**; el GPS funciona sense dades mòbils.
- **Espai ocupat**: a *Els meus tracks* ➜ *Espai ocupat i mapes guardats* veus quant ocupa cada track, cada zona i els mapes vistos navegant, i pots esborrar-ne els mapes o el track.

## Consells

- Descarrega els mapes de cada ruta a casa. El *Topogràfic* ocupa molt (uns 300 kB per tessel·la); si vas just d'espai, tria *Topogràfic lleuger*.
- Sense cobertura, el mapa només es veu fins al nivell de detall que hagis descarregat. Si t'hi apropes més, es veurà en blanc.
- L'app només segueix la teva posició amb la pantalla encesa i l'app oberta.

## Instal·lar-la al mòbil

1. Obre l'adreça de l'app amb **Chrome** a l'Android.
2. Menú ⋮ ➜ **Afegeix a la pantalla d'inici** (o *Instal·la l'aplicació*).
3. Obre-la des de la icona i accepta el permís d'ubicació.

## Mapes

Mapes de l'[Institut Cartogràfic i Geològic de Catalunya](https://www.icgc.cat), llicència CC BY 4.0. Només cobreixen Catalunya.

## Per a qui modifiqui el codi

- Web estàtica sense compilar: HTML, CSS i JavaScript, amb [Leaflet](https://leafletjs.com) 1.9.4 a `vendor/`.
- Prova local: `py -m http.server 8080` i obre `http://localhost:8080`.
- Quan canviïs fitxers, puja `APP_CACHE` a `sw.js` (per exemple `app-v2`) perquè els mòbils agafin la versió nova.
