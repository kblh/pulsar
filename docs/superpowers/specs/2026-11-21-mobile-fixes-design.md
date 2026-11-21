# Opravy 21/11: slidery, hlasitost vln, envelope — design

Zdroj: `instructions.md`, sekce „21/11 bugs“. Velikost: střední změna (jedna nová komponenta, tři menší opravy).

## Proč

Aplikace se má dát dobře ovládat z mobilu. Na telefonu se špatně trefují slidery (zvlášť volume), −/+ označují okolní text, v detailu je volume úzký, vlny jsou nestejně hlasité a obálka v grafu reaguje příliš prudce.

## Cíle

- Slider jde na dotykovém displeji přesně trefit i tahat a nerozhodí scroll stránky.
- Dvojitý tap na −/+ ani tah po sliderech neoznačí text.
- Volume slider v detailu je přes celou šířku, ve sbalené kartě je použitelně široký.
- Sine, triangle, saw a square mají podobnou vnímanou hlasitost při stejném nastavení.
- Tažení uzlů obálky mění hodnoty jemně a poslední hodnotu pořád lze dosáhnout.

## Ne-cíle

- Žádné nové funkce, nový vzhled ani změna formátu scén a modulů (`version` zůstává 1).
- Žádné multitouch gesto, žádné zoomování grafu.
- Skutečný telefon neověřím. Ověřím v Chrome simulovanými dotyky a skutečnou myší. Reálný dotyk a zvuk z reproduktoru zůstávají na uživateli.

## Přístupy

1. **Zvětšit dnešní nativní `input[type=range]`.** Nejmenší zásah, ale palec musí trefit dráhu s posuvníkem o šířce 1 px a chování se liší mezi iOS Safari a Androidem. Neověřitelné, zamítnuto.
2. **Vlastní komponenta na Pointer Events (zvoleno).** Chování je stejné všude, dá se řídit výběr tap vs. tah vs. scroll a testovat čistou logiku.
3. **Slider jen z tlačítek −/+.** Odporuje požadavku na graficky pěkné slidery.

## Design

### 1. Slider (`js/controls.js`, `js/hud.js`, `css/style.css`)

Veřejné API `createSlider({ min, max, step, value, scale, format, onInput, ariaLabel, nudge })` a návratové `{ node, set }` zůstává, všechna volání (`ui.js`, `sequence-ui.js`) se nemění.

- Nativní `input[type=range]` zmizí. Dráha `.hud-track` je `div` s `role="slider"`, `tabindex="0"`, `aria-valuemin/max/now/valuetext`, `aria-label`.
- **Pointer Events** na dráze, `setPointerCapture`, absolutní mapování: zlomek = `(x − left) / šířka` dráhy, převedený přes existující `fromFraction` a `snap` (lineární i log).
  - **Myš a pero:** hodnota se nastaví hned při stisku a sleduje tah.
  - **Dotyk:** při stisku se nic nezmění. Hodnota se nastaví buď při zvednutí, pokud se prst posunul méně než 8 px (tap skočí na hodnotu), nebo jakmile vodorovný posun přesáhne 8 px (tah, potom hodnota sleduje prst). Svislý pohyb nechá stránku scrollovat (`touch-action: pan-y`), prohlížeč pošle `pointercancel` a hodnota zůstane beze změny.
  - `pointercancel` a ztráta zachycení ukončí tah. `onInput` se volá jen při změně hodnoty (jako dnes).
- **Klávesnice** na dráze: šipky, PageUp/PageDown (×10), Home/End. Lineární slider se hýbe o `step`. Log slider drží dnešní pravidlo (5 % hodnoty, nejméně `step`). Logika kroků se přesune do čisté funkce v `hud.js`, aby šla testovat.
- **Vzhled:** pruh je vyšší (20 px místo 14 px), dotyková plocha dál 44 px na výšku. Beze změny cyan HUD stylu.
- **Volume layout:**
  - ve sbalené kartě je `.card-volume` `flex: 1 1 110px; max-width: 45%` místo pevných 90 px,
  - v detailu (`.card.open`) je na vlastním řádku hlavičky přes celou šířku (`flex: 1 1 100%`).
- **Označování textu:** `user-select: none` a `-webkit-touch-callout: none` na `.hud-slider`, `.nudge`, `.hud-seg`, `.card`, tlačítka a jejich okolí. Textová pole (`input[type=text]`, `textarea`) dostanou zpět `user-select: text`. `-webkit-tap-highlight-color` zůstane průhledné.
- Pokud existují selektory `.hud-input` (CSS, testy, ruční skripty), nahradí se.

### 2. Hlasitost vln (`js/synth.js`)

- Nová konstanta `WAVE_GAIN` (sine, triangle, sawtooth, square) a funkce `waveGain(wave)`. Neznámá vlna vrací 1.
- Zisk se aplikuje na úroveň každého oscilátoru. U jednoho oscilátoru (mix 0) se strukturu grafu nemění: zisk se promítne do špičky obálky (`0.6 × waveGain(wave)`). U dvou oscilátorů se násobí úrovně A a B vlastní vlnou (`wave` a `wave2`).
- Drone: změna vlny nebo `wave2` za běhu zisk plynule přepočítá (stejná rampa jako `setMix`, žádné kliknutí).
- **Hodnoty:** sine zůstává na dnešní úrovni (1), ostatní se ztlumí, aby nic nepřekročilo dnešní špičku a nehrozilo přebuzení. Konkrétní čísla se nastaví měřením efektivní hodnoty (RMS) vykreslené noty v `OfflineAudioContext` tak, aby všechny čtyři vlny měly podobné RMS (výchozí odhad: triangle ≈ 0,85, saw ≈ 0,6, square ≈ 0,45). Výsledek se přezkouší sluchem uživatele. Pokud celé nastavení zní tiše, upraví se jediná konstanta master.
- Čisté funkce a testy: `waveGain` vrací hodnoty v rozsahu (0, 1], sine je největší, RMS vykreslených not se liší nejvýše o malou toleranci.

### 3. Obálka (`js/hud.js`, `js/envelope.js`)

- **Tlumené tažení:** při stisku uzlu se uloží poloha ukazatele a poloha uzlu. Při pohybu se uzel posune o `K × (posun ukazatele)`, `K = 0.4` (konstanta `ENV_DRAG_GAIN`), a výsledek se omezí do rozsahu segmentu. Uzel tedy nesleduje prst 1:1, ale pohybuje se jemně. Aby se dalo dosáhnout celého rozsahu, tažení pokračuje i mimo graf (pointer capture to už dnes umí).
- Čistá funkce `dampedDrag(startPoint, startNode, point, gain)` s testy: nulový posun nemění nic, malý posun změní hodnotu o `K ×` méně než dnes, výsledek je vždy v rozsahu, nečíselný vstup vrací původní polohu.
- Mapování času (sqrt) a klávesové ovládání uzlů beze změny. Zaokrouhlení na 0,01 s zůstává.
- Zobrazená poloha uzlu odpovídá skutečné hodnotě, ne prstu.

## Co je na staviteli

- Přesné číslo prahu tapu (8 px) a `ENV_DRAG_GAIN` se může ladit v Chrome, pokud se ukáže, že je moc citlivé nebo moc líné. Změna se zapíše do plánu.
- Konkrétní hodnoty `WAVE_GAIN` podle měření.
- Pořadí práce a velikost commitů. Service worker se zvedne na `pulsar-v18`.

## Ověření

- `node --test`: nové čisté funkce (`fractionFromX`/kroky klávesnice, `dampedDrag`, `waveGain`, RMS test) a celá dosavadní sada musí zůstat zelená.
- Chrome (skutečná myš plus `PointerEvent` s `pointerType: 'touch'`): tap skočí na hodnotu, vodorovný tah mění, svislý tah hodnotu nemění, dvojitý tap na + neoznačí text, volume v detailu přes celou šířku při 320 px, tažení obálky je jemné a dosáhne obou konců.
- Nelze ověřit: reálný dotyk na telefonu, zvuk z reproduktoru.
