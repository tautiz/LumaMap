# Automatinis pasirodymas: įjungi į elektrą, ir LumaMap pats rodo

LumaMap turi **pasirodymo režimą**: atidarius nuorodą su `?show`, programa iš karto užkrauna išsaugotą
pasirodymą (sluoksnius, vaizdo įrašus, taškus, raiškos ir klavišų nustatymus) ir rodo jį per visą ekraną,
be valdymo skydelio ir be pelės žymeklio.

| Nuoroda | Ką rodo |
| --- | --- |
| `https://tautiz.github.io/LumaMap/?show` | Pasirodymą, išsaugotą **šio įrenginio** naršyklėje mygtuku „Išsaugoti“. |
| `https://tautiz.github.io/LumaMap/?show=mano-pasirodymas.lumamap` | Pasirodymo failą iš interneto (santykinis kelias skaičiuojamas nuo programos adreso). Jei tinklas dar neįsijungęs, bandoma kas 5 sekundes. |

Pasirodymo failą (`.lumamap`) atsisiunti ir įkeli žingsnyje **„Rodyk“** → **„Automatinis pasirodymas“**.
Jame yra visi nustatymai ir visi vaizdo įrašai, todėl pasirodymą gali paruošti kompiuteryje ir perkelti į kitą įrenginį.

## Rekomenduojama: Raspberry Pi prie projektoriaus (be Chromecast)

Paprasčiausias ir patikimiausias būdas. Raspberry Pi jungiamas HDMI kabeliu tiesiai į projektorių
ir maitinamas iš to paties prailgintuvo. Įjungus elektrą Pi pasileidžia ir atidaro pasirodymą per visą ekraną.

Reikės: Raspberry Pi 4 arba 5 (2 GB RAM pakanka), microSD kortelės, maitinimo bloko, micro-HDMI–HDMI kabelio.

1. Įrašyk **Raspberry Pi OS (with desktop)** į kortelę su „Raspberry Pi Imager“. Imager'yje iškart nustatyk Wi-Fi ir naudotoją.
2. Pi prijunk prie projektoriaus, klaviatūros ir pelės (tik šiam paruošimui).
3. Pi naršyklėje (Chromium) atidaryk `https://tautiz.github.io/LumaMap/`, žingsnyje „Paruošk“ nustatyk projektoriaus raišką
   (pvz. 1920 × 1080), pritaikyk sluoksnius tiesiai ant sienos ir paspausk **„Išsaugoti“**.
   Arba įkelk kompiuteryje paruoštą pasirodymo failą („Rodyk“ → „Įkelti failą“) ir paspausk „Išsaugoti“.
4. Pi terminale paleisk:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/tautiz/LumaMap/main/scripts/raspberry-pi-kiosk.sh | bash
   ```

5. Perkrauk Pi. Nuo šiol kiekvieną kartą įjungus elektrą pasirodymas prasidės pats.

Išjungti automatinį paleidimą: `rm ~/.config/autostart/lumamap-show.desktop`. Uždaryti pasirodymą dabar: `Alt+F4`.
Klaviatūra ar Bluetooth pultelis pasirodymo metu veikia kaip įprastai (rodyklės, 0, skaičiai 1–9).

## Valdymas Raspberry Pi su monitoriumi ir projektoriumi

Raspberry Pi 4 ir 5 turi du HDMI lizdus: į vieną junk monitorių, į kitą projektorių.

1. Monitoriuje atidaryk LumaMap ir spausk **„Atidaryti projektoriaus langą“**. Jei Chromium paklaus leidimo
   valdyti langus, leisk: tada langas pats atsidarys projektoriaus ekrane.
2. Projektoriaus lange dukart spustelėk (arba spausk `F`), kad būtų visas ekranas.
3. Viską, ką darai monitoriuje, projektorius rodo iš karto, o vaizdo įrašai abiejuose languose groja sinchroniškai.
   Klavišai, paspausti projektoriaus lange (rodyklės, 0, 1–9), valdo pasirodymą taip pat, kaip valdymo lange.

Projektoriaus langas mato tik tos pačios naršyklės langus tame pačiame įrenginyje. Jei jis atidarytas be valdymo lango,
jis parodo šioje naršyklėje išsaugotą pasirodymą (arba užrašą, ką daryti, jei nieko neišsaugota).

## Su Chromecast (1 kartos): galima, bet nerekomenduojama

- **Chromecast pats nieko nepaleidžia.** Įjungtas į elektrą jis tik rodo užsklandą ir laukia, kol kitas įrenginys
  (telefonas, kompiuteris, Raspberry Pi) jam ką nors nusiųs. Taigi visada reikia dar vieno, nuolat įjungto įrenginio.
  O jei toks įrenginys vis tiek reikalingas, paprasčiau jį jungti tiesiai į projektorių (žr. aukščiau).
- **1 kartos Chromecast silpnas ir nebeatnaujinamas.** LumaMap kiekvieną kadrą perpiešia vaizdo įrašą ant iškreipto tinklelio;
  tikėtina, kad šis įrenginys to nespės ir vaizdas trūkčios (nepatikrinta su tikru įrenginiu).
- **Chromecast nemato tavo naršyklės išsaugoto pasirodymo.** Jam reikia pasirodymo failo internete.

Jei vis tiek nori išbandyti:

1. Atsisiųsk pasirodymo failą ir įdėk jį į šios repozitorijos aplanką `public/` (pvz. `public/mano-pasirodymas.lumamap`).
   Po įkėlimo į `main` jis bus pasiekiamas `https://tautiz.github.io/LumaMap/mano-pasirodymas.lumamap`.
   GitHub neleidžia didesnių nei 100 MB failų.
2. Nuolat įjungtame kompiuteryje ar Raspberry Pi, tame pačiame Wi-Fi tinkle kaip Chromecast, įdiek `catt`
   (`pip install catt`) ir paleisk:

   ```bash
   catt -d "Chromecast pavadinimas" cast_site "https://tautiz.github.io/LumaMap/?show=mano-pasirodymas.lumamap"
   ```

3. Kad tai vyktų automatiškai, šią komandą reikia įdėti į to įrenginio paleidimą (pvz. `cron` su `@reboot`),
   palaukus, kol Chromecast pasileis.
