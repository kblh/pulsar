# Pulsar

Generativní hudební sekvencer v prohlížeči (Web Audio API) s vzhledem terminálové aplikace. Několik souběžných modulů, každý s vlastním tempem, které se samy melodicky i rytmicky vyvíjejí. Žádné globální BPM.

**Živá verze:** https://kblh.github.io/pulsar/

## Co umí

- **Moduly** přidáváš tlačítkem `[+]`: melodic, rhythmic a drone. Každý má vlastní tempo a hodiny a sám se vyvíjí. Melodic a drone mají **dva oscilátory** (vlna, poměr `mix` a rozladění `detune`). Jednotlivé vlny mají korekci hlasitosti (`WAVE_GAIN` v `js/synth.js`), aby square a saw nepřehlušily sine.
- **Rytmus a tóny se klepají.** Rhythmic se edituje mřížkou 4×4 spínačů (16 kroků): přepínačem kick / snare / hat vybereš stopu a každá stopa má vlastní mute (zmutovaná stopa se dál vyvíjí, jen nehraje). Stopu lze úplně vyprázdnit a zůstane prázdná. Melodic má stejnou mřížku pro rytmus a jednooktávovou klaviaturu, která vybírá, které tóny smí generátor hrát (rozloží se přes slider `octaves`). Klepnutí na klávesu ve scale módu přepne na notes a převezme tóny stupnice.
- **Karty:** efekty nahoře, moduly pod nimi, sekvence dole. Všechno je sbalené (jméno, play/stop a hlasitost, u efektu bypass); klik otevře detail na celou obrazovku, zavře ho Esc, tlačítko nebo Zpět.
- **Ovládání:** HUD slidery na Pointer Events (s tlačítky −/+ pro přesné hodnoty; myš nastaví hodnotu hned, prst při tapu nebo po vodorovném tahu a svislý swipe jen scrolluje), přepínače a ADSR obálka s tlumeným tažením uzlů (uzel se hýbe 0,4× pohybu prstu); vše jde ovládat dotykem i klávesnicí od šířky 320 px. Textová pole jsou jen pro `notes` a `rhythm`.
- **Tlačítka a menu:** všechny akce jsou grafické ikony. V headeru je jen název, `+` (menu s moduly, efekty, sekvencí a importem modulu) a hamburger (new scene, load, save, theme).
- **Transport bar:** dole, stále viditelný: play/stop všeho (na desktopu i mezerník, mimo textová pole) a **globální BPM**. Přepínač zapne společné tempo pro všechny tempové moduly (drone ho nemá), vypnutý nechá každý modul hrát vlastním BPM. Globální BPM se ukládá do scény.
- **Theme:** v hamburgeru jde vybrat barevný akcent (cyan, zelená, jantar, magenta, fialová, červená); volba se pamatuje v zařízení.
- **Mix:** hlasitost a pan pro každý modul, globální `play all` / `stop all`.
- **Efekty** (instance přes menu `+`, až 3 sendy na modul, každý jde obejít): reverb (algoritmický, Freeverb: stojí asi 4 % výkonu bez ohledu na `decay`, parametry se jen plynule rampují, nic se nepřestavuje; `width`), delay (`pingpong`), třípásmový equalizer, chorus (`rate`, `depth`, `width`; dva krátké delaye rozkývané jedním LFO, pravý kanál proti levému), vibrato (`speed`, `peek`, `depth`; jeden krátký delay rozkývaný sinusovým LFO, stereo zůstává stereo), tremolo (`speed`, `peek`, `depth`; `peek` = za jak dlouho po začátku noty `speed` klesne na 0 (50 % = 5 s, 80 % = 3 s, 0 = drží) a zůstane tam do další noty (potřebuje worklet, `js/slide.js`); sinusový LFO mění hlasitost, zisk zůstává mezi 0 a 1), overdrive/distortion (`drive`, `shape` měkký tanh ↔ tvrdý clip, `tone`; WaveShaper, hlasitost se vyrovnává, nepotřebuje worklet) a bitcrusher (potřebuje `AudioWorklet`, jinak se nenabídne). EQ je send, upraví jen přimíchanou kopii. Efekty vypadají jako kytarová šlapka: box v barvách motivu, rotační knob na každý parametr (tah nahoru/doprava zvyšuje, Shift = jemně, kolečko a šipky, dvojklik = výchozí hodnota; `js/knob.js`), LED a footswitch pro bypass (`js/pedal.js`). Master drží součet pod plnou škálou měkkým limiterem (pod prahem beze změny). Zvuk běží i při zhasnutém displeji: tichá `<audio>` smyčka, `audioSession = playback` a Media Session (`js/background.js`).
- **Sekvence:** řada částí, v každé zní vybrané moduly po zadanou dobu (1–600 s), volitelně dokola. Částí se dá poskládat skladba, i tak, že tlačítkem „use running“ zapíšeš moduly, které právě hrají.
- **Scény:** `save` / `load` v hamburgeru uloží nastavení (včetně sekvence) do prohlížeče (localStorage); scény jdou přejmenovat, smazat a exportovat nebo importovat jako JSON.
- **Moduly do souboru:** ikona export v detailu modulu stáhne `<jméno>.pulsar-module.json`, `import module` v menu `+` je přidá zpět (sendy se neukládají).
- **PWA:** jde nainstalovat a funguje offline.

Zvuk se spustí až po prvním kliknutí, to vyžaduje prohlížeč.

## Spuštění lokálně

Je to statický web bez build kroku, stačí ho servírovat přes HTTP (service worker a ES moduly nefungují ze `file://`):

```sh
python3 -m http.server 8000
# http://localhost:8000
```

## Testy

```sh
npm test
```

Používá vestavěný `node --test`, žádné závislosti. Testy pokrývají čistou logiku (hudba, scény, soubory, sekvence, ovladače a geometrii obálky, zapojení efektů na nahrávacím stubu). UI a skutečný zvuk se ověřují v prohlížeči.

## Struktura

- `js/` — aplikace (ES moduly bez build kroku): `engine.js` (zvuk, transport, hodiny), `module.js` a `synth.js` (moduly a hlasy), `fx.js` (registr efektů), `sequence.js` (sekvence), `scene*.js` a `module-file.js` (scény a soubory), `ui.js`, `card.js`, `controls.js`, `envelope.js`, `sequence-ui.js` (rozhraní).
- `docs/superpowers/` — návrhy (`specs/`) a plány (`plans/`) jednotlivých kroků.
- `tests/` — Node testy.

## Nasazení (GitHub Pages)

Web se servíruje přímo z kořene větve `main` (*Settings → Pages → Deploy from a branch*). Soubor `.nojekyll` vypíná zpracování Jekyllem. Při změně souborů aplikace zvyš `CACHE` v `sw.js` a nové soubory přidej do jeho seznamu `FILES` (musí odpovídat obsahu `js/`, včetně `bitcrusher.worklet.js`), jinak stávající návštěvníci uvidí starou verzi; po vydání je potřeba stránku obnovit dvakrát.

Při vývoji se service worker a HTTP cache chovají jako cache-first: po změně souborů smaž v prohlížeči service worker i cache (nebo použij čistý původ, např. `127.0.0.1` místo `localhost`), jinak uvidíš starý kód.

## Licence

Viz [LICENSE](LICENSE).
