# Video biblioteka ir grojaraščiai

Kiekvienas sluoksnis gali rodyti video iš **bibliotekos**: pasirenki sluoksnį žingsnyje „Pritaikyk“ ir spaudi
**„🎃 Iš video bibliotekos“**. Video suskirstyti kategorijomis (pirma yra **Helovinas**).

- **Vienas video**: spausk ▶ prie jo. Jis kartojasi be galo.
- **Grojaraštis**: pažymėk kelis video (jie gros ta tvarka, kuria pažymėjai), palik pažymėtą
  „Pabaigus kartoti iš naujo“ ir spausk **„Groti N video iš eilės“**. Po paskutinio video vėl prasideda pirmas.
  Sluoksnio nustatymuose matysi „Grojaraštis: 2 iš 8“, mygtukus ⏮ ⏭ ir „Kartoti iš naujo“.
- Paspaudus **„Išsaugoti“**, pasirodymas išsaugomas kartu su video, todėl `?show` ir projektoriaus langas
  groja tą patį grojaraštį ir be interneto.

## Iš kur bibliotekoje atsiranda video

1. **Iš šios naršyklės.** „Pridėti video iš kompiuterio“ → pažymi failus (galima visus iš karto).
   Jie lieka šios naršyklės atmintyje ir veikia be interneto, tiek `https://tautiz.github.io/LumaMap/`, tiek
   kitoje LumaMap kopijoje. Kiekviena naršyklė (ir kiekvienas įrenginys) turi savo biblioteką.
2. **Iš media aplanko šalia programos** (`media/library.json`). Taip veikia, kai LumaMap paleista iš šios
   repozitorijos kopijos (`npm run dev`) arba kai video įkelti į repozitoriją (žr. žemiau).

## Kaip parsisiųsti Helovino grojaraštį

Raspberry Pi (arba kompiuterio) terminale:

```bash
curl -fsSL https://raw.githubusercontent.com/tautiz/LumaMap/main/scripts/download-media.sh | bash
```

Skriptas įsidiegia `yt-dlp` ir `ffmpeg`, parsiunčia grojaraštį į `~/LumaMap-media/halloween/` (repozitorijos kopijoje:
į `public/media/halloween/`) ir sukuria `library.json`. Video išsaugomi kaip MP4 (H.264, iki 1080p): tokius
Raspberry Pi groja sklandžiausiai. Paleidus dar kartą, parsiunčiami tik nauji grojaraščio video.

Kitas grojaraštis ar kategorija: `bash download-media.sh "<grojaraščio nuoroda>" <kategorija>`.

Tada LumaMap Pi naršyklėje: „Iš video bibliotekos“ → „Pridėti video iš kompiuterio“ → aplankas
`LumaMap-media/halloween` → pažymėk visus failus.

## Be interneto

Atidarius LumaMap bent kartą su internetu, naršyklė išsaugo programą ir kitą kartą ją atidaro net be interneto.
Bibliotekos video ir išsaugotas pasirodymas jau yra naršyklėje, tad Raspberry Pi be Wi-Fi rodo pasirodymą kaip įprastai
(`scripts/raspberry-pi-kiosk.sh`, žr. [automatinis-pasirodymas.md](automatinis-pasirodymas.md)).

## Kodėl video nėra repozitorijoje

Repozitorija ir svetainė yra viešos, todėl įkėlus video į repozitoriją jie būtų viešai platinami iš mūsų svetainės.
Tai galima tik su video, kuriuos turi teisę platinti (pvz. savo sukurtus). Be to, GitHub nepriima didesnių nei 100 MB failų,
o didelė repozitorija lėtai atsisiunčia. Jei video tavo, ištrink `public/media/*` eilutę iš `.gitignore`, paleisk skriptą
repozitorijos kopijoje ir įkelk `public/media/` į `main`: svetainė juos parodys bibliotekoje.
