import type { LevelMeta } from './base';
import { LsdLevel } from './lsd';
import { ShroomLevel } from './shroom';
import { KetamineLevel } from './ketamine';
import { DmtLevel } from './dmt';
import { DaturaLevel } from './datura';

export const LEVELS: LevelMeta[] = [
  {
    id: 'lsd', name: 'LSD', title: 'Die Tapete atmet', intensity: 2,
    tagline: 'Ein Flur ohne Ende. Etwas lächelt – solange du hinsiehst.',
    desc: 'Die Wände atmen, die Farben kippen. Sammle vier Realitätsanker, damit der Flur wieder stillhält.',
    hints: ['Die Lächelnden bewegen sich nur, wenn du NICHT hinsiehst.', 'Dein Blinzeln kannst du nicht kontrollieren.', 'Jeder Anker beruhigt die Welt – und macht sie schneller.'],
    tags: ['Blickkontakt', 'Labyrinth'], color: '#ff4fd8', color2: '#ffb347',
    create: (g) => new LsdLevel(g),
  },
  {
    id: 'shroom', name: 'PILZE', title: 'Myzel', intensity: 3,
    tagline: 'Der Wald ist wach. Nur im Licht bist du allein.',
    desc: 'Dunkelheit frisst deinen Verstand. Leuchtende Pilzkreise schützen dich – aber sie pulsieren. Erwecke fünf Mutterpilze.',
    hints: ['Bleib im Licht der Pilze. Im Dunkeln jagt dich der Gehörnte.', 'Pilzkreise verlöschen in Wellen. Warte nicht zu lange.', 'Sprint kostet Ausdauer – teile sie dir ein.'],
    tags: ['Licht & Dunkel', 'Verfolger'], color: '#4dffb8', color2: '#2a7bff',
    create: (g) => new ShroomLevel(g),
  },
  {
    id: 'ketamine', name: 'KETAMIN', title: 'K-Hole', intensity: 3,
    tagline: 'Dein Körper liegt irgendwo da unten. Du nicht.',
    desc: 'Stege über dem Nichts. Deine Beine gehorchen verzögert, Kacheln lösen sich auf. Folge dem Piepen der Monitore.',
    hints: ['Du rutschst nach. Bremse früh – der Abgrund verzeiht nicht.', 'Wenn es in den Ohren klingelt: NICHT BEWEGEN.', 'Flackernde Kacheln lösen sich gleich auf.'],
    tags: ['Trägheit', 'Stillstehen'], color: '#9fb8ff', color2: '#e8f0ff',
    create: (g) => new KetamineLevel(g),
  },
  {
    id: 'dmt', name: 'DMT', title: 'Durchbruch', intensity: 4,
    tagline: 'Vier Minuten. Sie wollen dir etwas zeigen.',
    desc: 'Ein Tempel aus Licht. Das Totem zeigt Farbfolgen – wiederhole sie an den Obelisken, bevor die Zeit abläuft.',
    hints: ['Merke dir die Farbfolge des Totems. Drei Runden.', 'Ein Fehler kostet Zeit und ruft einen weiteren Wächter.', 'Wächter töten nicht sofort – aber ihre Nähe zerreißt dich.'],
    tags: ['Gedächtnis', 'Zeitdruck'], color: '#ffe14a', color2: '#ff2bd6',
    create: (g) => new DmtLevel(g),
  },
  {
    id: 'datura', name: 'DATURA', title: 'Delirium', intensity: 5,
    tagline: 'Du kannst nicht mehr unterscheiden, was da ist.',
    desc: 'Ein dunkles Haus, eine sterbende Taschenlampe. Sechs Schlüssel – nur drei davon existieren. Und er trägt einen Hut.',
    hints: ['Echte Dinge flackern nicht. Sieh genau hin.', 'Ducke dich unter Tische, um dich zu verstecken.', 'Wenn er dich sieht: Sichtlinie brechen, dann verstecken.'],
    tags: ['Verstecken', 'Täuschung'], color: '#ff3b30', color2: '#7a5cff',
    create: (g) => new DaturaLevel(g),
  },
];
