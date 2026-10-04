import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

// Lithuanian is the source of truth: every other language must provide the same keys.
const lt = {
  'app.title': 'LumaMap – vaizdo projektavimas ant sienų',
  'app.tagline': 'Šviesos piešimas ant sienų',

  'lang.label': 'Kalba',

  'common.save': 'Išsaugoti',
  'common.load': 'Atidaryti',
  'common.help': 'Pagalba',
  'common.close': 'Uždaryti',
  'common.more': 'Daugiau nustatymų',

  'step.setup.title': 'Paruošk',
  'step.setup.desc': 'Nuotrauka ir projektorius',
  'step.map.title': 'Pritaikyk',
  'step.map.desc': 'Uždėk paveikslėlius',
  'step.live.title': 'Rodyk',
  'step.live.desc': 'Pasirodymas!',

  'setup.hint': 'Įkelk sienos ar daikto nuotrauką. Ji padės matyti, kur dėti paveikslėlius.',
  'setup.photo.title': 'Sienos nuotrauka',
  'setup.photo.upload': 'Spustelk ir pasirink nuotrauką',
  'setup.photo.change': 'Pakeisti nuotrauką',
  'setup.photo.optional': 'Nebūtina, bet labai padeda',
  'setup.photo.move': 'Stumdyti nuotrauką pele',
  'setup.photo.moveStop': 'Baigti stumdyti',
  'setup.photo.showInLive': 'Rodyti nuotrauką pasirodyme',
  'setup.photo.size': 'Dydis',
  'setup.photo.posX': 'Padėtis X',
  'setup.photo.posY': 'Padėtis Y',
  'setup.projector.title': 'Projektorius',
  'setup.projector.open': 'Atidaryti projektoriaus langą',
  'setup.projector.openHint': 'Nutempk šį langą į projektoriaus ekraną ir paspausk F11.',
  'setup.projector.width': 'Plotis (px)',
  'setup.projector.height': 'Aukštis (px)',
  'setup.fullscreen': 'Visas ekranas',
  'setup.keys.title': 'Klaviatūros mygtukai',
  'setup.keys.hint': 'Spustelk mygtuką ir paspausk naują klavišą.',
  'setup.keys.press': 'Spausk...',
  'setup.keys.next': 'Kitas paveikslėlis',
  'setup.keys.prev': 'Ankstesnis paveikslėlis',
  'setup.keys.blackout': 'Užtemdyti / grąžinti',
  'setup.keys.toggleUi': 'Slėpti / rodyti valdymą',
  'setup.keys.toggleFrame': 'Projektoriaus kraštų rėmelis (pasirodyme)',
  'setup.keys.numbers': 'Skaičiai 1–9 įjungia ir išjungia sluoksnius.',
  'setup.next': 'Toliau: uždėk paveikslėlius',

  'map.hint': 'Tempk spalvotus taškus, kad paveikslėlis tiksliai uždengtų sieną.',
  'map.tip.drag': 'Tempk tašką, kad pakeistum formą',
  'map.tip.move': 'Tempk paveikslėlį, kad jį perkeltum',
  'map.tip.add': 'Dukart spustelk, kad pridėtum tašką',
  'map.tip.remove': 'Dešiniu pelės mygtuku ištrink tašką',
  'map.tip.zoom': 'Pelės ratuku priartink ar atitolink',
  'map.layers.title': 'Sluoksniai',
  'map.layers.add': 'Naujas sluoksnis',
  'map.layers.empty': 'Dar nėra sluoksnių. Paspausk „Naujas sluoksnis“.',
  'map.layers.show': 'Rodyti',
  'map.layers.hide': 'Slėpti',
  'map.layers.up': 'Aukštyn',
  'map.layers.down': 'Žemyn',
  'map.layers.copy': 'Kopijuoti',
  'map.layers.delete': 'Ištrinti',
  'map.layers.defaultName': 'Sluoksnis {n}',
  'map.layers.copySuffix': '(kopija)',
  'map.selected.title': 'Ką rodyti šiame sluoksnyje?',
  'map.selected.name': 'Pavadinimas',
  'map.selected.upload': 'Paveikslėlis ar vaizdo įrašas',
  'map.selected.grid': 'Langelių tinklelis',
  'map.selected.current': 'Dabar rodoma: {name}',
  'map.selected.none': 'Nieko nepasirinkta',
  'map.selected.opacity': 'Ryškumas',
  'map.selected.lock': 'Užrakinti (negalima tempti)',
  'map.selected.unlock': 'Atrakinti',
  'map.ai.title': 'Sukurti paveikslėlį su DI',
  'map.ai.placeholder': 'Pvz.: žvaigždėtas dangus',
  'map.ai.generate': 'Sukurti',
  'map.ai.generating': 'Kuriama...',
  'map.ai.failed': 'Nepavyko sukurti paveikslėlio. Šioje versijoje DI gali būti neprieinamas.',
  'map.next': 'Toliau: rodyk!',
  'map.selected.library': 'Iš video bibliotekos',
  'map.playlist.title': 'Grojaraštis: {n} iš {total}',
  'map.playlist.prev': 'Ankstesnis video',
  'map.playlist.next': 'Kitas video',
  'map.playlist.loop': 'Kartoti iš naujo',
  'map.playlist.stopped': 'Grojaraštis baigėsi',

  'library.title': 'Video biblioteka',
  'library.cat.halloween': 'Helovinas',
  'library.cat.other': 'Kita',
  'library.add': 'Pridėti video iš kompiuterio',
  'library.addHint': 'Pridėti video lieka šioje naršyklėje ir veikia net be interneto.',
  'library.adding': 'Pridedama...',
  'library.loading': 'Kraunama...',
  'library.preparing': 'Ruošiama {n} iš {total}...',
  'library.empty': 'Šioje kategorijoje dar nėra video. Paspausk „Pridėti video iš kompiuterio“ ir pasirink parsisiųstus failus (pvz. su scripts/download-media.sh).',
  'library.selectAll': 'Pažymėti visus',
  'library.selectNone': 'Nužymėti visus',
  'library.selectHint': 'Pažymėk vieną video arba kelis: jie gros iš eilės ta tvarka, kuria pažymėjai.',
  'library.onDevice': 'naršyklėje',
  'library.inFolder': 'aplanke',
  'library.delete': 'Pašalinti iš bibliotekos',
  'library.deleteConfirm': 'Pašalinti „{name}“ iš šios naršyklės bibliotekos?',
  'library.loop': 'Pabaigus kartoti iš naujo',
  'library.playOne': 'Rodyti šį video',
  'library.playMany': 'Groti {n} video iš eilės',
  'library.failed': 'Nepavyko atidaryti video. Patikrink, ar failas dar yra.',
  'library.addFailed': 'Nepavyko pridėti video. Gal baigėsi vieta diske?',
  'source.grid': 'Langelių tinklelis',

  'grid.title': 'Tinklelio nustatymai',
  'grid.useDefault': 'Bendri visiems',
  'grid.useOwn': 'Tik šiam elementui',
  'grid.defaultHint': 'Keiti bendrus nustatymus: jie tinka visiems elementams, kurie neturi savų.',
  'grid.ownHint': 'Šis elementas turi savus nustatymus. Bendri jo nebekeičia.',
  'grid.size': 'Elemento dydis',
  'grid.unit.m': 'metrai',
  'grid.unit.cm': 'centimetrai',
  'grid.width': 'Plotis ↔',
  'grid.height': 'Aukštis ↕',
  'grid.cells': 'Langeliai',
  'grid.mode.size': 'Nurodau langelio dydį',
  'grid.mode.count': 'Nurodau langelių skaičių',
  'grid.cellWidth': 'Langelio plotis',
  'grid.cellHeight': 'Langelio aukštis',
  'grid.columns': 'Langelių per plotį',
  'grid.rows': 'Langelių per aukštį',
  'grid.result.count': 'Išeis {columns} × {rows} langelių',
  'grid.result.size': 'Vienas langelis: {width} × {height} cm',
  'grid.result.partial': 'Paskutinis langelis netilps visas, jis bus nukirptas ties kraštu.',
  'grid.frame': 'Rėmelis aplink visą elementą',
  'grid.cellsTouch': 'Langelių kraštai liečiasi ir susikerta',
  'grid.cellsTouch.on': 'Kaimyniniai langeliai dalinasi viena linija.',
  'grid.cellsTouch.off': 'Kiekvienas langelis turi savo rėmelį su tarpeliu.',

  'live.frame.show': 'Rodyti projektoriaus kraštus',
  'live.frame.hide': 'Slėpti projektoriaus kraštus',

  'live.hint': 'Pasirodymas vyksta! Valdymas paslėptas.',
  'live.showControls': 'Rodyti valdymą',
  'live.keysHint': '{prev} {next} keičia paveikslėlius, {blackout} užtemdo, {ui} rodo ar slepia valdymą.',

  'zoom.in': 'Priartinti',
  'zoom.out': 'Atitolinti',
  'zoom.reset': 'Grąžinti vaizdą',
  'video.play': 'Groti',
  'video.pause': 'Pauzė',
  'video.mute': 'Garsas',
  'canvas.editingBackground': 'Stumdai sienos nuotrauką',

  'welcome.title': 'Sveikas atvykęs į LumaMap!',
  'welcome.intro': 'Čia gali „nupiešti“ šviesą ant sienos, dėžės ar bet kokio daikto. Tai daroma trimis žingsniais:',
  'welcome.step1': 'Įkelk sienos nuotrauką ir prijunk projektorių.',
  'welcome.step2': 'Pasirink paveikslėlį ir tempk jo kampus, kad tiktų ant sienos.',
  'welcome.step3': 'Spausk „Rodyk“ ir mėgaukis pasirodymu!',
  'welcome.start': 'Pradėkime!',

  'receiver.waiting': 'Projektoriaus langas • Laukiama valdymo lango...',
  'receiver.noEditor': 'Valdymo langas nerastas. Šis langas rodo tik tai, kas atidaryta LumaMap kitame šios pačios naršyklės lange. Atidaryk LumaMap ir spausk „Atidaryti projektoriaus langą“. Kad pasirodymas rodytųsi ir be valdymo lango, paspausk „Išsaugoti“.',
  'receiver.savedShow': 'Rodomas išsaugotas pasirodymas • Valdymo langas neprijungtas',
  'receiver.fullscreenHint': 'Dukart spustelėk arba spausk F, kad būtų visas ekranas',

  'show.title': 'Automatinis pasirodymas',
  'show.hint': 'Pirma paspausk „Išsaugoti“. Tada atidarius nuorodą žemiau, pasirodymas prasidės pats, be jokio valdymo. Failu gali perkelti pasirodymą su visais vaizdo įrašais į kitą įrenginį.',
  'show.export': 'Atsisiųsti failą',
  'show.import': 'Įkelti failą',
  'show.link': 'Pasirodymo nuoroda',
  'show.loading': 'Kraunamas pasirodymas...',
  'show.retrying': 'Nepavyko atsisiųsti pasirodymo. Bandoma dar kartą...',
  'show.missing': 'Išsaugoto pasirodymo nerasta. Atidaryk LumaMap šiame įrenginyje ir paspausk „Išsaugoti“ arba įkelk pasirodymo failą.',
  'alert.saved': 'Projektas išsaugotas!',
  'alert.saveFailed': 'Nepavyko išsaugoti projekto.',
  'alert.noSaved': 'Išsaugoto projekto nerasta.',
  'alert.loaded': 'Projektas atidarytas.',
  'alert.loadFailed': 'Nepavyko atidaryti projekto.',

  'key.space': 'Tarpas',
  'key.left': '←',
  'key.right': '→',
  'key.up': '↑',
  'key.down': '↓',

  'help.title': 'Kaip naudotis LumaMap',
  'help.open': 'Pagalba ir klavišai',
  'help.tab.start': 'Pradžia',
  'help.tab.mouse': 'Pelė',
  'help.tab.keys': 'Klaviatūra',
  'help.tab.tips': 'Patarimai',
  'help.start.what': 'LumaMap leidžia projektoriumi rodyti paveikslėlius ir vaizdo įrašus tiksliai ant sienos, dėžės ar kito daikto.',
  'help.start.s1': '„Paruošk“: įkelk sienos nuotrauką ir paspausk „Atidaryti projektoriaus langą“. Nutempk tą langą į projektoriaus ekraną ir dukart jį spustelėk (arba spausk F), kad būtų visas ekranas.',
  'help.start.s2': '„Pritaikyk“: pasirink sluoksnį, įkelk paveikslėlį ar vaizdo įrašą ir tempk taškus, kol vaizdas tiks ant sienos. Kiekvienas sluoksnis yra atskiras paveikslėlis.',
  'help.start.s3': '„Rodyk“: valdymas pasislepia ir prasideda pasirodymas. Klavišais keisk paveikslėlius.',
  'help.start.s4': 'Paspausk „Išsaugoti“, kad kitą kartą nereikėtų visko daryti iš naujo.',
  'help.mouse.dragDot': 'Tempk spalvotą tašką',
  'help.mouse.dragDotDo': 'Keičia paveikslėlio formą',
  'help.mouse.dragPic': 'Tempk patį paveikslėlį',
  'help.mouse.dragPicDo': 'Perkelia visą sluoksnį',
  'help.mouse.dragEmpty': 'Tempk tuščią vietą',
  'help.mouse.dragEmptyDo': 'Pastumia visą vaizdą',
  'help.mouse.wheel': 'Pelės ratukas',
  'help.mouse.wheelDo': 'Priartina arba atitolina',
  'help.mouse.dbl': 'Dukart spustelk',
  'help.mouse.dblDo': 'Prideda naują tašką (tiksliau išlenkti)',
  'help.mouse.right': 'Dešinys pelės mygtukas ant taško',
  'help.mouse.rightDo': 'Ištrina tašką (lieka bent 3)',
  'help.mouse.click': 'Spustelk tašką',
  'help.mouse.clickDo': 'Pažymi tašką ir parodo jo U/V nustatymus',
  'help.keys.nudge': 'Rodyklės (pritaikymo žingsnyje)',
  'help.keys.nudgeDo': 'Po truputį stumia pažymėtą tašką arba visą sluoksnį',
  'help.keys.shift': 'Shift + rodyklės',
  'help.keys.shiftDo': 'Stumia 10 kartų greičiau',
  'help.keys.numbersDo': 'Įjungia arba išjungia 1–9 sluoksnį',
  'help.keys.changeHint': 'Klavišus gali pakeisti žingsnyje „Paruošk“ → „Daugiau nustatymų“.',
  'help.keys.note': 'Klavišai neveikia, kai rašai teksto laukelyje.',
  'help.keys.escDo': 'Uždaro šį pagalbos langą',
  'help.tips.t1': 'Pradėk nuo langelių tinklelio: jį lengviausia tiksliai uždėti ant sienos.',
  'help.tips.t2': 'Užrakink sluoksnį (spynelė), kai jis jau gerai uždėtas, kad netyčia nepajudintum.',
  'help.tips.t3': 'Projektoriaus langas rodo tą patį, ką matai čia. Valdyk viską iš šio lango.',
  'help.tips.t4': 'Išsaugotas projektas su visomis nuotraukomis ir vaizdo įrašais laikomas šioje naršyklėje. Į kitą įrenginį jį perkelsi „Rodyk“ žingsnyje atsisiuntęs pasirodymo failą.',
  'help.tips.t5': 'Pasimetei pasirodymo metu? Paspausk {ui} arba pajudink pelę ir spausk „Rodyti valdymą“.',
};

export type TranslationKey = keyof typeof lt;
type Dictionary = Record<TranslationKey, string>;

const en: Dictionary = {
  'app.title': 'LumaMap – projection mapping',
  'app.tagline': 'Paint walls with light',

  'lang.label': 'Language',

  'common.save': 'Save',
  'common.load': 'Open',
  'common.help': 'Help',
  'common.close': 'Close',
  'common.more': 'More settings',

  'step.setup.title': 'Prepare',
  'step.setup.desc': 'Photo and projector',
  'step.map.title': 'Fit',
  'step.map.desc': 'Place your pictures',
  'step.live.title': 'Show',
  'step.live.desc': 'Showtime!',

  'setup.hint': 'Upload a photo of your wall or object. It helps you see where to put pictures.',
  'setup.photo.title': 'Wall photo',
  'setup.photo.upload': 'Click to choose a photo',
  'setup.photo.change': 'Change photo',
  'setup.photo.optional': 'Optional, but really helps',
  'setup.photo.move': 'Move photo with the mouse',
  'setup.photo.moveStop': 'Done moving',
  'setup.photo.showInLive': 'Show photo during the show',
  'setup.photo.size': 'Size',
  'setup.photo.posX': 'Position X',
  'setup.photo.posY': 'Position Y',
  'setup.projector.title': 'Projector',
  'setup.projector.open': 'Open projector window',
  'setup.projector.openHint': 'Drag this window to the projector screen and press F11.',
  'setup.projector.width': 'Width (px)',
  'setup.projector.height': 'Height (px)',
  'setup.fullscreen': 'Fullscreen',
  'setup.keys.title': 'Keyboard buttons',
  'setup.keys.hint': 'Click a button, then press a new key.',
  'setup.keys.press': 'Press...',
  'setup.keys.next': 'Next picture',
  'setup.keys.prev': 'Previous picture',
  'setup.keys.blackout': 'Black out / restore',
  'setup.keys.toggleUi': 'Hide / show controls',
  'setup.keys.toggleFrame': 'Projector edge frame (during the show)',
  'setup.keys.numbers': 'Number keys 1–9 turn layers on and off.',
  'setup.next': 'Next: place pictures',

  'map.hint': 'Drag the colored dots so the picture covers the wall exactly.',
  'map.tip.drag': 'Drag a dot to change the shape',
  'map.tip.move': 'Drag the picture to move it',
  'map.tip.add': 'Double-click to add a dot',
  'map.tip.remove': 'Right-click a dot to remove it',
  'map.tip.zoom': 'Use the mouse wheel to zoom',
  'map.layers.title': 'Layers',
  'map.layers.add': 'New layer',
  'map.layers.empty': 'No layers yet. Press “New layer”.',
  'map.layers.show': 'Show',
  'map.layers.hide': 'Hide',
  'map.layers.up': 'Up',
  'map.layers.down': 'Down',
  'map.layers.copy': 'Copy',
  'map.layers.delete': 'Delete',
  'map.layers.defaultName': 'Layer {n}',
  'map.layers.copySuffix': '(copy)',
  'map.selected.title': 'What should this layer show?',
  'map.selected.name': 'Name',
  'map.selected.upload': 'Picture or video',
  'map.selected.grid': 'Grid pattern',
  'map.selected.current': 'Showing now: {name}',
  'map.selected.none': 'Nothing selected',
  'map.selected.opacity': 'Brightness',
  'map.selected.lock': 'Lock (no dragging)',
  'map.selected.unlock': 'Unlock',
  'map.ai.title': 'Create a picture with AI',
  'map.ai.placeholder': 'E.g.: starry sky',
  'map.ai.generate': 'Create',
  'map.ai.generating': 'Creating...',
  'map.ai.failed': 'Could not create the picture. AI may not be available in this version.',
  'map.next': 'Next: show it!',
  'map.selected.library': 'From the video library',
  'map.playlist.title': 'Playlist: {n} of {total}',
  'map.playlist.prev': 'Previous video',
  'map.playlist.next': 'Next video',
  'map.playlist.loop': 'Repeat from the start',
  'map.playlist.stopped': 'The playlist has ended',

  'library.title': 'Video library',
  'library.cat.halloween': 'Halloween',
  'library.cat.other': 'Other',
  'library.add': 'Add videos from this computer',
  'library.addHint': 'Added videos stay in this browser and work even without internet.',
  'library.adding': 'Adding...',
  'library.loading': 'Loading...',
  'library.preparing': 'Preparing {n} of {total}...',
  'library.empty': 'No videos in this category yet. Press “Add videos from this computer” and pick the downloaded files (e.g. from scripts/download-media.sh).',
  'library.selectAll': 'Select all',
  'library.selectNone': 'Clear selection',
  'library.selectHint': 'Pick one video or several: they play one after another in the order you picked them.',
  'library.onDevice': 'browser',
  'library.inFolder': 'folder',
  'library.delete': 'Remove from the library',
  'library.deleteConfirm': 'Remove “{name}” from this browser’s library?',
  'library.loop': 'Start again after the last one',
  'library.playOne': 'Show this video',
  'library.playMany': 'Play {n} videos in a row',
  'library.failed': 'Could not open the video. Check that the file is still there.',
  'library.addFailed': 'Could not add the videos. Is the disk full?',
  'source.grid': 'Grid pattern',

  'grid.title': 'Grid settings',
  'grid.useDefault': 'Shared by all',
  'grid.useOwn': 'This element only',
  'grid.defaultHint': 'You are changing the shared settings: they apply to every element without its own.',
  'grid.ownHint': 'This element has its own settings. The shared ones no longer change it.',
  'grid.size': 'Element size',
  'grid.unit.m': 'metres',
  'grid.unit.cm': 'centimetres',
  'grid.width': 'Width ↔',
  'grid.height': 'Height ↕',
  'grid.cells': 'Cells',
  'grid.mode.size': 'I set the cell size',
  'grid.mode.count': 'I set the number of cells',
  'grid.cellWidth': 'Cell width',
  'grid.cellHeight': 'Cell height',
  'grid.columns': 'Cells across',
  'grid.rows': 'Cells down',
  'grid.result.count': 'That makes {columns} × {rows} cells',
  'grid.result.size': 'One cell: {width} × {height} cm',
  'grid.result.partial': 'The last cell does not fit whole; it is cut off at the edge.',
  'grid.frame': 'Frame around the whole element',
  'grid.cellsTouch': 'Cell borders touch and cross',
  'grid.cellsTouch.on': 'Neighbouring cells share one line.',
  'grid.cellsTouch.off': 'Every cell has its own frame with a small gap.',

  'live.frame.show': 'Show projector edges',
  'live.frame.hide': 'Hide projector edges',

  'live.hint': 'The show is on! Controls are hidden.',
  'live.showControls': 'Show controls',
  'live.keysHint': '{prev} {next} switch pictures, {blackout} blacks out, {ui} shows or hides the controls.',

  'zoom.in': 'Zoom in',
  'zoom.out': 'Zoom out',
  'zoom.reset': 'Reset view',
  'video.play': 'Play',
  'video.pause': 'Pause',
  'video.mute': 'Sound',
  'canvas.editingBackground': 'Moving the wall photo',

  'welcome.title': 'Welcome to LumaMap!',
  'welcome.intro': 'Here you can “paint” light onto a wall, a box or any object. It takes three steps:',
  'welcome.step1': 'Upload a photo of the wall and connect a projector.',
  'welcome.step2': 'Pick a picture and drag its corners to fit the wall.',
  'welcome.step3': 'Press “Show” and enjoy the show!',
  'welcome.start': 'Let’s start!',

  'receiver.waiting': 'Projector window • Waiting for the control window...',
  'receiver.noEditor': 'No control window found. This window only shows what LumaMap has open in another window of this same browser. Open LumaMap and press “Open projector window”. To have the show play without a control window, press “Save”.',
  'receiver.savedShow': 'Showing the saved show • No control window connected',
  'receiver.fullscreenHint': 'Double-click or press F for full screen',

  'show.title': 'Automatic show',
  'show.hint': 'Press “Save” first. Opening the link below then starts the show by itself, with no controls. The file moves a show, videos included, to another device.',
  'show.export': 'Download file',
  'show.import': 'Upload file',
  'show.link': 'Show link',
  'show.loading': 'Loading the show...',
  'show.retrying': 'Could not download the show. Trying again...',
  'show.missing': 'No saved show found. Open LumaMap on this device and press “Save”, or upload a show file.',
  'alert.saved': 'Project saved!',
  'alert.saveFailed': 'Could not save the project.',
  'alert.noSaved': 'No saved project found.',
  'alert.loaded': 'Project opened.',
  'alert.loadFailed': 'Could not open the project.',

  'key.space': 'Space',
  'key.left': '←',
  'key.right': '→',
  'key.up': '↑',
  'key.down': '↓',

  'help.title': 'How to use LumaMap',
  'help.open': 'Help and shortcuts',
  'help.tab.start': 'Start',
  'help.tab.mouse': 'Mouse',
  'help.tab.keys': 'Keyboard',
  'help.tab.tips': 'Tips',
  'help.start.what': 'LumaMap lets you use a projector to show pictures and videos exactly on a wall, a box or another object.',
  'help.start.s1': '“Prepare”: upload a photo of the wall and press “Open projector window”. Drag that window to the projector screen and double-click it (or press F) for full screen.',
  'help.start.s2': '“Fit”: pick a layer, upload a picture or video and drag the dots until it fits the wall. Each layer is a separate picture.',
  'help.start.s3': '“Show”: the controls hide and the show begins. Use the keys to switch pictures.',
  'help.start.s4': 'Press “Save” so you don’t have to start over next time.',
  'help.mouse.dragDot': 'Drag a colored dot',
  'help.mouse.dragDotDo': 'Changes the picture’s shape',
  'help.mouse.dragPic': 'Drag the picture itself',
  'help.mouse.dragPicDo': 'Moves the whole layer',
  'help.mouse.dragEmpty': 'Drag an empty area',
  'help.mouse.dragEmptyDo': 'Moves the whole view',
  'help.mouse.wheel': 'Mouse wheel',
  'help.mouse.wheelDo': 'Zooms in or out',
  'help.mouse.dbl': 'Double-click',
  'help.mouse.dblDo': 'Adds a new dot (for finer bending)',
  'help.mouse.right': 'Right-click a dot',
  'help.mouse.rightDo': 'Removes the dot (at least 3 stay)',
  'help.mouse.click': 'Click a dot',
  'help.mouse.clickDo': 'Selects it and shows its U/V settings',
  'help.keys.nudge': 'Arrow keys (in the Fit step)',
  'help.keys.nudgeDo': 'Nudge the selected dot or the whole layer',
  'help.keys.shift': 'Shift + arrows',
  'help.keys.shiftDo': 'Nudge 10 times faster',
  'help.keys.numbersDo': 'Turns layer 1–9 on or off',
  'help.keys.changeHint': 'You can change the keys in “Prepare” → “More settings”.',
  'help.keys.note': 'Keys don’t work while you are typing in a text box.',
  'help.keys.escDo': 'Closes this help window',
  'help.tips.t1': 'Start with the grid pattern: it is the easiest to line up with the wall.',
  'help.tips.t2': 'Lock a layer (padlock) once it fits, so you don’t move it by accident.',
  'help.tips.t3': 'The projector window shows the same thing you see here. Control everything from this window.',
  'help.tips.t4': 'A saved project, with all its photos and videos, is kept in this browser. To move it to another device, download the show file in the “Show” step.',
  'help.tips.t5': 'Lost during the show? Press {ui}, or move the mouse and click “Show controls”.',
};

export const LANGUAGES = {
  lt: { label: 'Lietuvių', short: 'LT', dict: lt as Dictionary },
  en: { label: 'English', short: 'EN', dict: en },
} as const;

export type Language = keyof typeof LANGUAGES;

const DEFAULT_LANGUAGE: Language = 'lt';
const STORAGE_KEY = 'lumaMapLanguage';

const readStoredLanguage = (): Language => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && stored in LANGUAGES) return stored as Language;
  } catch {
    // Storage can be blocked (private mode); fall back to the default.
  }
  return DEFAULT_LANGUAGE;
};

type TranslateFn = (key: TranslationKey, params?: Record<string, string | number>) => string;

interface I18nContextValue {
  lang: Language;
  setLang: (lang: Language) => void;
  t: TranslateFn;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<Language>(readStoredLanguage);

  const setLang = useCallback((next: Language) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ignore: the choice still applies for this session.
    }
  }, []);

  const t = useCallback<TranslateFn>((key, params) => {
    let text = LANGUAGES[lang].dict[key] ?? lt[key] ?? key;
    if (params) {
      for (const [name, value] of Object.entries(params)) {
        text = text.split(`{${name}}`).join(String(value));
      }
    }
    return text;
  }, [lang]);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = LANGUAGES[lang].dict['app.title'];
  }, [lang]);

  // Keep other tabs (e.g. the projector window) in the same language.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue && e.newValue in LANGUAGES) {
        setLangState(e.newValue as Language);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useI18n = (): I18nContextValue => {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <LanguageProvider>');
  return ctx;
};

/** Human-friendly label for a KeyboardEvent.key value. */
export const formatKey = (key: string, t: TranslateFn): string => {
  switch (key) {
    case ' ': return t('key.space');
    case 'ArrowRight': return t('key.right');
    case 'ArrowLeft': return t('key.left');
    case 'ArrowUp': return t('key.up');
    case 'ArrowDown': return t('key.down');
    default: return key.length === 1 ? key.toUpperCase() : key;
  }
};
