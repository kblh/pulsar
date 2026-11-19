# Pulsar

- budeme stavět aplikaci SPA (vanilla js, css, html), možná PWA, pokud to bude mít smysl

- hudební sekvencer - generování náhodných melodických sekvencí
- Web Audio API
- největší inspirací je https://strudel.cc/, bude to ale mnohem jednodušší

Na začátku je prázdná stránka, pomocí tlačítka [+] přidám "modul" sekvenceru, kde se bude nastatvovat:

- druh oscilátoru (wave, saw, triangle, ...)
- obálka
- BPM
- výčet konkrétních tónů nebo stupnice (C dur,a moll, atp.) + počet oktáv
- startovní rytmus
- swing
- randomize [1 - 10] - jak moc a jak rychle se bude měnit základní sekvence
- rytmická modulace [1 - 10] - jak moc a jak rychle se bude měnit/vyvíjet rytmus základní sekvence

Účelem aplikace je několik souběžně hrajících sekvencí, kde každá z nich bude mít jiné tempo a bude se sama postupně vyvíjet melodicky (randomize) i rytmicky. V aplikaci neexistuje globální BPM, chci, aby sekvence byly asynchronní.

Kromě těchto melodických modulů budou v aplikaci i rytmické moduly. Budou mít podobmné randomizační parametry.

## vzhled aplikace

Aplikace by měla připomínat terminálovou CLI aplikaci - jednoduché, dark.

