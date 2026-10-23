/**
 * Vocabulario de Pokémon y de Pokémon competitivo que Whisper suele escribir mal. Los nombres de Pokémon y la jerga
 * se corrigen con un parecido más exigente que el de las palabras propias del usuario (ver FUZZY_STRICT en vocab.ts),
 * para no cambiar palabras corrientes del español.
 */

/** Jerga de VGC, Locke y combate competitivo. */
export const COMPETITIVE_TERMS = [
  'VGC', 'competitivo', 'locke', 'nuzlocke', 'Nuzlocke', 'speed tie', 'Trick Room', 'Tailwind', 'Fake Out', 'Protect', 'Intimidate',
  'Terastal', 'teratipo', 'Teracristalización', 'Dynamax', 'Gigamax', 'Mega Evolución', 'Choice Scarf', 'Choice Band', 'Choice Specs',
  'Assault Vest', 'Focus Sash', 'Life Orb', 'Leftovers', 'Booster Energy', 'Sitrus Berry', 'EVs', 'IVs', 'Smogon', 'Showdown',
  'Pokémon Showdown', 'Pokédex', 'Pokéball', 'shiny', 'Worlds', 'Regional', 'Internacional', 'Regulación', 'doubles', 'Tier List',
  'Pokémon Espada y Escudo', 'Pokémon Escarlata y Púrpura', 'Pokémon Go',
];

/** Pokémon habituales en VGC y en las partidas de Locke (Galar incluida). */
export const POKEMON_NAMES = [
  'Archaludon', 'Pelipper', 'Torkoal', 'Incineroar', 'Rillaboom', 'Urshifu', 'Flutter Mane', 'Iron Hands', 'Amoonguss', 'Farigiraf',
  'Indeedee', 'Gholdengo', 'Landorus', 'Tornadus', 'Thundurus', 'Raging Bolt', 'Iron Bundle', 'Chien-Pao', 'Chi-Yu', 'Ting-Lu',
  'Wo-Chien', 'Ogerpon', 'Terapagos', 'Calyrex', 'Miraidon', 'Koraidon', 'Kyogre', 'Groudon', 'Rayquaza', 'Zacian', 'Zamazenta',
  'Eternatus', 'Dragonite', 'Garchomp', 'Tyranitar', 'Hydreigon', 'Dragapult', 'Baxcalibur', 'Kingambit', 'Annihilape', 'Palafin',
  'Whimsicott', 'Grimmsnarl', 'Sinistcha', 'Hatterene', 'Dondozo', 'Tatsugiri', 'Ursaluna', 'Heatran', 'Volcarona', 'Primarina',
  'Basculegion', 'Gastrodon', 'Corviknight', 'Excadrill', 'Scizor', 'Gyarados', 'Salamence', 'Metagross', 'Lucario', 'Blaziken',
  'Gardevoir', 'Gallade', 'Pikachu', 'Charizard', 'Venusaur', 'Blastoise', 'Greninja', 'Mimikyu', 'Tinkaton', 'Armarouge',
  'Ceruledge', 'Lokix', 'Pawmot', 'Kommo-o', 'Bronzong', 'Rotom', 'Latios', 'Latias', 'Meowscarada', 'Skeledirge', 'Quaquaval',
  'Sylveon', 'Umbreon', 'Espeon', 'Glimmora', 'Houndstone', 'Maushold', 'Sneasler', 'Typhlosion', 'Samurott', 'Decidueye',
  'Zoroark', 'Goodra', 'Avalugg', 'Cinderace', 'Inteleon', 'Dubwool', 'Toxtricity', 'Morpeko', 'Eiscue', "Sirfetch'd", 'Obstagoon',
  'Perrserker', 'Cursola', 'Runerigus', 'Mr. Rime', 'Copperajah', 'Drednaw', 'Coalossal', 'Flapple', 'Appletun', 'Sandaconda',
  'Polteageist', 'Falinks', 'Pincurchin', 'Frosmoth', 'Stonjourner', 'Dracozolt', 'Arctozolt', 'Dracovish', 'Arctovish', 'Duraludon',
  'Drakloak', 'Kubfu', 'Zarude', 'Regieleki', 'Regidrago', 'Glastrier', 'Spectrier', 'Arcanine', 'Gengar', 'Machamp', 'Snorlax',
  'Dragalge', 'Mamoswine', 'Weavile', 'Togekiss', 'Kartana', 'Celesteela', 'Tapu Koko', 'Tapu Fini', 'Tapu Lele', 'Tapu Bulu',
  'Necrozma', 'Lunala', 'Solgaleo', 'Marshadow', 'Magearna', 'Naganadel', 'Pheromosa', 'Xurkitree', 'Ditto', 'Staraptor', 'Azumarill',
];

/** Cómo escribe Whisper a veces estas cosas → lo correcto (el parecido de sonido no basta). */
export const POKEMON_CORRECTIONS: { from: string; to: string }[] = [
  { from: 'be ge ce', to: 'VGC' },
  { from: 'v g c', to: 'VGC' },
  { from: 'nuzlock', to: 'Nuzlocke' },
  { from: 'nos locke', to: 'Nuzlocke' },
  { from: 'nus locke', to: 'Nuzlocke' },
  { from: 'espid tai', to: 'speed tie' },
  { from: 'espid tay', to: 'speed tie' },
  { from: 'trick rum', to: 'Trick Room' },
];

/** Los que se incluyen en la pista a Whisper cuando el directo va de Pokémon (los más habituales). */
export const POKEMON_PROMPT_TERMS = [...COMPETITIVE_TERMS.slice(0, 14), ...POKEMON_NAMES.slice(0, 24)];

/** ¿El directo parece de Pokémon? Por el título y los juegos que muestra Twitch. */
export const looksLikePokemon = (context: string[]): boolean => /pok[eé]mon|\bvgc\b|nuzlocke|\blocke\b|poke-?survivor/i.test(context.join(' '));
