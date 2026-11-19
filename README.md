# Pulsar

Generativní hudební sekvencer v prohlížeči (Web Audio API) s vzhledem terminálové aplikace. Několik souběžných modulů, každý s vlastním tempem, které se samy melodicky i rytmicky vyvíjejí. Žádné globální BPM.

**Živá verze:** https://kblh.github.io/pulsar/

## Co umí

- **Moduly** přidáváš tlačítkem `[+]`: melodic, rhythmic a drone. Každý má vlastní tempo a hodiny a sám se vyvíjí.
- **Mix:** hlasitost a pan pro každý modul, globální `[stop all]` / `[play all]`.
- **Efekty:** reverb a delay jako instance, každý modul má až 3 sendy.
- **Scény:** `[save]` / `[load]` uloží nastavení do prohlížeče (localStorage). Scény jdou přejmenovat, smazat a exportovat nebo importovat jako JSON soubor.
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

Používá vestavěný `node --test`, žádné závislosti.

## Nasazení (GitHub Pages)

Web se servíruje přímo z kořene větve `main` (*Settings → Pages → Deploy from a branch*). Soubor `.nojekyll` vypíná zpracování Jekyllem. Při změně souborů aplikace zvyš `CACHE` v `sw.js` a nové soubory přidej do jeho seznamu `FILES`, jinak stávající návštěvníci uvidí starou verzi.

## Licence

Viz [LICENSE](LICENSE).
