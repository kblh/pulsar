# Pulsar – návrh

Datum: 2026-11-19. Zdroj zadání: `instructions.md`.

## Záměr a proč

Pulsar je generativní hudební sekvencer běžící v prohlížeči. Uživatel přidává nezávislé moduly (melodické a rytmické), z nichž každý hraje vlastním tempem a sám se postupně vyvíjí – melodicky i rytmicky. Cílem je poslouchat několik asynchronních, neustále se proměňujících sekvencí, které spolu vytvářejí živou, nikdy se neopakující texturu. Inspirace: strudel.cc, ale výrazně jednodušší.

## Cíle

- SPA, vanilla JS + CSS + HTML, Web Audio API, bez build kroku a bez frameworku (ES moduly, statické soubory).
- Prázdná stránka; tlačítko `[+]` přidá modul (melodický / rytmický).
- Žádné globální BPM. Každý modul má vlastní tempo a vlastní hodiny; moduly jsou záměrně asynchronní.
- Melodický modul nastavuje: druh oscilátoru (sine, square, saw, triangle…), obálku (ADSR), BPM, tóny (výčet konkrétních tónů, nebo stupnice + tónika + počet oktáv), startovní rytmus, swing, *randomize* 1–10, *rytmická modulace* 1–10, **mód vývoje** (`drift` / `walk`).
- Rytmický modul má obdobné randomizační parametry (rytmická modulace, randomize) a vlastní syntetizované zvuky.
- Vzhled: tmavá terminálová CLI estetika, jednoduchá.
- PWA (manifest + service worker) jako doplněk na konci, pokud zůstane úsilí.

## Non-cíle

- Žádný globální transport/synchronizace, žádné sdílené BPM.
- Žádné samply, žádné nahrávání/export zvuku, žádné MIDI (v první verzi).
- Žádný live-coding jazyk jako ve Strudelu.
- Žádný backend, žádné účty.

## Anti-cíle (selhání i při technicky fungujícím kódu)

- Moduly, které se přes hodiny „slepí" do společného rytmu nebo začnou hrát v nějaké sdílené mřížce.
- Hudba, která se při přepnutí záložky na pozadí rozpadne nebo zastaví.
- Mutace, které po čase skončí v šumu bez melodického smyslu (mimo stupnici, extrémní skoky) nebo ve stagnaci.

## Omezení

- Žádné závislosti, žádný bundler. Spustitelné přes jakýkoli statický server (AudioContext vyžaduje uživatelské gesto → start po prvním kliknutí).
- Čisté logické funkce oddělené od zvuku, aby šly testovat bez prohlížeče.

## Přístupy (zvažované)

- **A) Lookahead scheduler na hlavním vlákně** (`setInterval` ~25 ms, plánování ~100 ms dopředu přes `AudioContext.currentTime`). Jednoduché, ale prohlížeč přiškrcuje timery v záložkách na pozadí.
- **B) Scheduler s tikáním z Web Workeru** – jako A, ale „tik" generuje Worker, který se nepřiškrcuje. Hraje spolehlivě na pozadí; cena je jeden soubor navíc. **Vybráno uživatelem.**
- **C) Sekvencování v AudioWorkletu.** Sample-přesné, ale zbytečně složité pro tuto aplikaci a bez build kroku nepohodlné. Zamítnuto.

## Rozhodnutí uživatele

- Vývoj sekvence má dva módy volitelné **per modul**:
  - `drift` – startovní sekvence je „domov"; mutace se od ní vzdalují, ale melodie se k ní občas vrací; vývoj zůstává v mezích.
  - `walk` – každá mutace se stane novým základem; sekvence putuje bez návratu.
- Síla a frekvence mutací se řídí *randomize* (melodie) a *rytmickou modulací* (rytmus), obojí 1–10.
- Architektura B (scheduler + Worker tik).

## Architektura (rozhodnutí autora návrhu – ke kontrole)

- `index.html`, `css/`, `js/` jako ES moduly.
- **Worker clock**: jediný Worker posílá tik (~25 ms) hlavnímu vláknu. Každý modul při tiku naplánuje své události do ~100–150 ms dopředu podle vlastního tempa; moduly nemají společnou časovou mřížku.
- **Modul** = objekt se stavem (parametry, aktuální sekvence, základní sekvence, pozice, čas příští noty). Typy: `melodic`, `rhythmic`.
- **Mutační logika** = čisté funkce (vstup: sekvence + parametry + RNG → nová sekvence): melodická mutace (posun tónu v rámci stupnice, malé intervaly, oktávy), rytmická mutace (přidání/odebrání/posun úderů), pravidla `drift` vs. `walk`. RNG injektovatelné (seed) kvůli testům.
- **Zvuk**: oscilátor + ADSR obálka a master gain pro melodiku; rytmické moduly syntetizují kick/snare/hat z oscilátorů a šumu.
- **UI**: sloupec/seznam panelů ve stylu terminálu (monospace, tmavé pozadí), každý panel s parametry a vizualizací sekvence (textová mřížka kroků s aktuální pozicí), tlačítka start/stop a odebrání modulu, `[+]` pro přidání.

## Ponecháno na tvůrci

- Přesné ladění mutačních pravidel (pravděpodobnosti, rozsahy skoků, jak často se `drift` vrací domů).
- Délka sekvence (počet kroků) a rozsah tempa, výchozí hodnoty parametrů.
- Konkrétní seznam stupnic a druhů oscilátorů, tvar syntetizovaných bicích.
- Přesné rozložení a barvy UI v rámci terminálové estetiky.
- Ukládání stavu (localStorage) – nepožadováno; zařadit jen pokud je to levné.
- PWA detaily.
