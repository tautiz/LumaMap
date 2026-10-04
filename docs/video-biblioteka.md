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

## Kaip papildyti biblioteką (video į repozitoriją)

Biblioteka yra aplankas `public/media/`: kiekviena kategorija yra atskiras poaplankis (`halloween/`, ...), o
`library.json` yra jų sąrašas. Kas įkelta į `main`, tas atsiranda bibliotekoje svetainėje
`https://tautiz.github.io/LumaMap/`. Pasirinktas video išsaugomas kartu su pasirodymu, todėl veikia ir be interneto.

Repozitorijos kopijoje:

```bash
bash scripts/download-media.sh                                    # Helovino grojaraštis
bash scripts/download-media.sh "<grojaraščio nuoroda>" <kategorija>   # kitas grojaraštis ar kategorija
git add public/media && git commit -m "Pridėti video" && git push
```

Savo failus gali tiesiog įmesti į `public/media/<kategorija>/` ir paleisti `python3 scripts/build-media-library.py public/media`.
Repozitorija vieša, tad kelk tik video, kuriuos turi teisę platinti. GitHub nepriima didesnių nei 100 MB failų
(skriptas juos praleidžia).

## Parsiųsti tiesiai į Raspberry Pi (be repozitorijos)

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
