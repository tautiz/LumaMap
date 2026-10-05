# Video eksportas ciklui

Žingsnyje „Rodyk“ mygtukas **Eksportuoti video ciklui** išsaugo tai, ką rodo projektorius, kaip MP4 failą.
Failą galima groti ratu (pvz. Raspberry Pi su `loop`), ir pabaiga sklandžiai pereina į pradžią.

Kadras yra toks pat kaip LIVE: 1920×1080 (arba 1280×720), elementai toje pačioje vietoje. Sienos nuotrauka ir
projektoriaus kraštų rėmelis į video nepatenka. Garsas neeksportuojamas.

## Kaip parenkamas ilgis

Kiekvienas video sukasi tik pilnais ratais, todėl video ilgis yra mažiausias bendras visų video ilgių kartotinis
(LCM). Pvz. 10 s, 5 s ir 15 s prie 30 kadrų/s: 300, 150 ir 450 kadrų → LCM = 900 kadrų = 30 s; ratai 3, 6 ir 2.

Skaičiuojama tik sveikaisiais skaičiais (`services/loopTiming.ts`), ne slankiojo kablelio sekundėmis:

1. Video ilgis skaitomas iš paties failo laiko žymų: (paskutinio kadro PTS + jo trukmė − pirmo kadro PTS) /
   timescale. Paskutinis kadras trunka vieną kadrą, kaip ir visi kiti, todėl N kadrų prie r kadrų/s trunka N / r.
2. Kadrų dažnis laikomas trupmena: 29.97 = 30000/1001, 23.976 = 24000/1001, 59.94 = 60000/1001.
3. Bendra laiko bazė (ticks per sekundę) = visų ilgių ir eksporto kadro trukmės vardiklių LCM. Joje kiekvienas
   ilgis yra sveikas skaičius.
4. Bendras ilgis = LCM(kiekvieno video ticks, kadro ticks), todėl jis yra ir sveikas kadrų skaičius.
5. Ratų skaičius = bendras ilgis / video ilgis, visada sveikas.

Skaičiai yra BigInt, todėl perpildymo nebūna. Jei ilgis viršija 10 min, eksportas nepradedamas, o langas parodo,
kiek truktų video. Tada verta parinkti video, kurių ilgiai geriau dera (pvz. 10 s ir 10.01 s duotų beveik 3 val.).

Kai video nėra, ilgį pasirenki pats (apvalinama iki sveiko kadrų skaičiaus).

## Ciklo riba

Kadras i prasideda ties i / fps. Kiekvienas video tuo metu rodo kadrą, kurio PTS yra paskutinis ne vėlesnis už
(i × kadro ticks) mod (video ticks). Kadras N būtų vėl kadras 0, todėl jis neįrašomas: pirmas kadras
nesidubliuoja, o paskutinis yra paskutinis kiekvieno video rato kadras.

## Efektai

- **Nejudantys** efektai (blur, glow...) tinka visada.
- **Loop** efektai (pulse, ripple, light sweep, shockwave, caustics...) gauna ciklo ilgį, o jų greitis nežymiai
  pakoreguojamas, kad per video jie apsuktų sveiką ratų skaičių ir grįžtų į pradžią.
- **Random** efektai (kibirkštys, ugnis, žaibai, glitch...) išlaiko atsitiktinumą ir seed, o atsitiktinė seka
  kartojasi kas ratą, todėl ciklo riba atrodo kaip įprastas atsitiktinis pokytis.
- **Perspėjimas** rodomas, kai efektas negali suktis ratu: jis neturi ciklo palaikymo, yra per lėtas tokiam
  ilgiui (greitį reikėtų keisti daugiau nei 1,5 karto) arba veikia tik gavęs signalą (klavišas T). Tada gali
  efektą išjungti, atidaryti elementą ir jį pakeisti, ignoruoti ir eksportuoti arba atšaukti. Ignoravus kiti
  efektai vis tiek sukasi ratu, o neloopinamas efektas piešiamas toks, koks yra.

## Kaip veikia viduje

- `services/videoExport.ts`: video atidaromi su [mediabunny](https://mediabunny.dev) (WebCodecs). Kadrai
  dekoduojami tiksliai ir užkoduojami į MP4 (H.264, o jei naršyklė jo nemoka, VP9 / AV1). MP4 timescale lygus
  kadrų dažnio vardikliui (30000 prie 29.97), todėl laiko žymos tikslios. Biblioteka įkeliama tik eksportuojant.
- `utils/scene.ts`: tas pats piešimas, kurį naudoja redaktorius, projektoriaus langas ir eksportas.
- `effects/loop.ts`: efektų patikra prieš eksportą.
- `services/exportFlow.ts`: lango žingsniai (perspėjimas, ignoruoti, atšaukti).
