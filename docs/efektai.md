# Efektai

Kiekvienas elementas (sluoksnis) susideda iš **turinio** ir **efektų sąrašo**. Turinys nebūtinas: elementą gali
sudaryti vien efektai. Efektai niekada nekeičia paties turinio, todėl bet kurį efektą gali išjungti, perkelti,
pakeisti ar ištrinti.

## Turinys

Žingsnyje „Pritaikyk“ → „Ką rodyti šiame sluoksnyje?“: paveikslėlis ar video, langelių tinklelis, vientisa
spalva, spalvų perėjimas arba **„Tuščias (tik efektai)“**.

## Efektų sąrašas

Skiltis **„Efektai“** rodo sąrašą ta tvarka, kuria jis piešiamas: pirma turinys, tada 1, 2, 3... efektas.
Kiekvieno efekto rezultatas tampa kito efekto vaizdu, todėl efektus galima jungti kaip nori
(pvz. Žiežirbos → Švytėjimas: švyti ir žiežirbos).

Efektų rūšys (spalvotas taškelis prie pavadinimo):

| Rūšis | Ką daro | Pavyzdžiai |
| --- | --- | --- |
| Piešia pats | Kuria savo vaizdą, turinio nereikia | Žiežirbos, Dalelės, Ugnis, Dūmai, Sniegas, Žaibai, Judantis triukšmas, Vandens atšvaitai |
| Keičia vaizdą | Keičia tai, kas yra aukščiau sąraše | Vandens raibuliai, Lėta banga, Trikdžiai, Spalvų išsiskyrimas, Kvadratėliai, Suliejimas, Spalvų keitimas, Pulsavimas |
| Sluoksnis viršuje | Piešia papildomą sluoksnį ant vaizdo | Elektrinis kraštas, Švytintis kraštas, Švytėjimas, Šviesos banga, Ekrano linijos, Blyksnis, Smūgio banga |
| Sluoksnis apačioje | Piešia už elemento, ir už jo krašto | Aura |
| Slepia ir atidengia | Nusprendžia, kuri vaizdo dalis matoma | Atidengimas ratu, Nuvalymas, Ištirpimas |
| Tarp elementų | Veikia projektoriaus erdvėje | Lazeris, Elektros lankas (iki kito elemento ar taško) |

Kiekvienas efektas turi bendrus nustatymus: **Stiprumas**, **Matomumas**, **Kaip sumaišyti** (Įprastai, Sudėti,
Ekranas, Dauginti, Perdanga, Šviesesnis, Tamsesnis, Skirtumas), **Kur piešti** (ant viršaus ar po apačia),
**Spalva** ir **Kada veikia**.

Jei efektui reikia vaizdo, bet prieš jį nieko nėra, prie jo atsiranda geltonas ženklas su paaiškinimu.

### Spalva

- **Sava spalva**: efektas turi savo spalvą.
- **Elemento spalva**: efektas seka elemento spalvą (skilties apačioje „Elemento spalva“). Vientisos spalvos
  ar spalvų perėjimo turiniui tai yra pati turinio spalva: pakeitus mėlyną į raudoną, elektrinis kraštas irgi
  tampa raudonas.
- **Paimti iš vaizdo prieš jį** ir **Paimti iš turinio**: vidutinė vaizdo spalva.
- **Spalvų ratas**: spalva lėtai keičiasi.

### Signalai (vienkartiniai efektai)

„Kada veikia“ → **„Tik gavus signalą“**: efektas nerodomas, kol negauna signalo, tada suveikia vieną kartą ir
dingsta (Blyksnis, Smūgio banga, Žiežirbos tampa sprogimu). Signalą siunčia mygtukas **T** (pakeičiamas
„Daugiau nustatymų“), mygtukas „Paleisti signalą“ arba `LumaAPI.triggerEffects()` (be argumento visiems
matomiems sluoksniams, `triggerEffects(0)` tik apatiniam sluoksniui). T veikia ir projektoriaus lange.

## Efektų rinkiniai

„Efektų rinkiniai“ turi paruoštus derinius: Elektrinis paviršius, Po vandeniu, Magiška energija, Sugedęs
ekranas, Ugnis, Audra, Sprogimas (signalu). Savo efektus gali išsaugoti kaip rinkinį ir pritaikyti bet kuriam
kitam elementui. Savi rinkiniai laikomi šioje naršyklėje; patys efektai išsaugomi kartu su pasirodymu
(„Išsaugoti“ ir `.lumamap` failas).

## Programuotojams

- `effects/types.ts`: duomenų modelis (`EffectInstance`, `EffectDefinition` su `role`, `inputMode`, `space`).
- `effects/registry.ts`: efektų registras. Naujas efektas: `registerEffect({...})` faile `effects/library/`.
- `effects/graph.ts`: sąrašas paverčiamas render grafu; įtraukiami tik įjungti ir veikiantys efektai.
- `effects/pipeline.ts`: vykdo grafą ir grąžina elemento vaizdą, kuris uždedamas ant tinklelio kaip tekstūra.
  Vykdytojas priima bet kokį grafą, kurio mazgai surikiuoti pagal priklausomybes, todėl vėliau galima pridėti
  mazgų redaktorių nekeičiant efektų.
- Elementas be efektų piešiamas kaip anksčiau, be jokių papildomų žingsnių. Nejudantys efektai piešiami vieną
  kartą ir laikomi atmintyje; kadrai perpiešiami tik kai kas nors juda.
- Atsitiktinumas skaičiuojamas iš efekto id ir laiko (`Date.now()`), todėl redaktorius ir projektoriaus langas
  piešia lygiai tą patį.
