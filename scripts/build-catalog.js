// Génère data/catalog.json + public/img/*.png à partir de minecraft-data / minecraft-assets.
// Usage : node scripts/build-catalog.js
const fs = require('fs');
const path = require('path');
const mcData = require('minecraft-data')('1.21.4');
const assetsLib = require('minecraft-assets');
// Plusieurs versions de textures : la 1.21.8 n'a pas les items récents (pale oak, résine...), la 26.1/1.21.5 oui.
const ASSET_VERSIONS = ['1.21.8', '26.1', '1.21.5', '1.21.1'];
const assetSets = ASSET_VERSIONS.map(v => assetsLib(v));

const ROOT = path.join(__dirname, '..');
const IMG = path.join(ROOT, 'public', 'img');
fs.mkdirSync(IMG, { recursive: true });

// ---------- Items NON obtenables en survie (best effort, modifiable via le panneau admin : "masqué") ----------
const UNOBTAINABLE = new Set([
  'bedrock','barrier','command_block','chain_command_block','repeating_command_block','command_block_minecart',
  'structure_block','structure_void','jigsaw','light','debug_stick','knowledge_book','spawner','trial_spawner','vault',
  'end_portal_frame','reinforced_deepslate','budding_amethyst','farmland','petrified_oak_slab','chorus_plant',
  'frogspawn','player_head','written_book','filled_map','potion','splash_potion','lingering_potion','tipped_arrow',
  'suspicious_stew','firework_star','ominous_bottle','enchanted_book','test_block','test_instance_block',
  'diamond','diamond_block' // monnaie de la boutique : non vendus
]);
const isUnobtainable = n =>
  UNOBTAINABLE.has(n) || n.endsWith('_spawn_egg') || n.startsWith('infested_') || n === 'air';

// ---------- Catégories ----------
const ARMOR_RE = /_(helmet|chestplate|leggings|boots)$/;
function categorize(n) {
  if (ARMOR_RE.test(n) || n === 'wolf_armor' || n.endsWith('_horse_armor') || n === 'elytra' || n === 'shield') return 'armures';
  if (/_sword$|^bow$|^crossbow$|^trident$|^mace$|^arrow$|^spectral_arrow$/.test(n)) return 'armes';
  if (/_(pickaxe|axe|shovel|hoe)$|^fishing_rod$|^shears$|^flint_and_steel$|^brush$|^spyglass$|^compass$|^clock$|bucket$/.test(n)) return 'outils';
  if (mcData.foodsByName && mcData.foodsByName[n]) return 'nourriture';
  if (/(^|_)(ingot|nugget|scrap)$|^raw_|^(coal|charcoal|diamond|emerald|lapis_lazuli|redstone|quartz|amethyst_shard|netherite_scrap|copper_ingot|resin_clump)$/.test(n)) return 'ressources';
  if (/redstone|repeater|comparator|piston|observer|hopper|dropper|dispenser|lever|_button$|_pressure_plate$|tripwire|daylight|target|lectern|note_block|rail$|tnt|crafter|sculk_(sensor|shrieker)|lightning_rod/.test(n)) return 'redstone';
  if (mcData.blocksByName && mcData.blocksByName[n]) return 'blocs';
  return 'divers';
}

// ---------- Prix (en diamants) ----------
// BARÈME
//  - Prix donnés par le client : livres 2 (Wind Burst / Swift Sneak 20), armure diamant 2/2/3/4, autres armures 1,
//    trou profond 25, fer / émeraude / charbon 1 le stack, or 2 le stack, netherite 10 le lingot, masse 25.
//  - Le reste suit la même échelle : ressources brutes 1 le stack ; bois et blocs travaillés 2 le stack ;
//    un bloc de minerai (9 lingots) = 9 × le prix du stack ; les objets rares ou difficiles à obtenir se vendent à la pièce.
//  - Un objet de netherite = l'objet en diamant + 10 (le lingot nécessaire à l'amélioration).
const ARMOR_DIAMOND = { helmet: 2, boots: 2, leggings: 3, chestplate: 4 };
const TOOL_DIAMOND = { sword: 2, pickaxe: 2, axe: 2, shovel: 1, hoe: 1 };
const NETHERITE_UPGRADE = 10;
const WOOD = '(?:oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak|bamboo|crimson|warped)';

// Vendus À LA PIÈCE (même quand l'objet est empilable)
const PIECE_PRICES = {
  elytra: 20, totem_of_undying: 8, enchanted_golden_apple: 10, golden_apple: 2, nether_star: 10, beacon: 12, conduit: 10,
  dragon_egg: 40, dragon_head: 15, wither_skeleton_skull: 8, skeleton_skull: 3, zombie_head: 3, creeper_head: 3, piglin_head: 3,
  heart_of_the_sea: 8, nautilus_shell: 3, trident: 8, mace: 25, netherite_ingot: 10, netherite_scrap: 3, ancient_debris: 3,
  netherite_block: 90, netherite_upgrade_smithing_template: 5, echo_shard: 4, recovery_compass: 6, saddle: 4, name_tag: 3,
  shulker_shell: 2, ender_chest: 3, enchanting_table: 3, jukebox: 2, anvil: 2, chipped_anvil: 2, damaged_anvil: 2,
  lodestone: 12, respawn_anchor: 5, end_crystal: 4, ghast_tear: 2, phantom_membrane: 1, breeze_rod: 1, heavy_core: 6,
  trial_key: 2, ominous_trial_key: 4, sniffer_egg: 4, turtle_egg: 2, creaking_heart: 5, wither_rose: 2, dragon_breath: 2,
  turtle_scute: 1, armadillo_scute: 1, wolf_armor: 2, diamond_horse_armor: 3, golden_horse_armor: 2, mojang_banner_pattern: 5,
  goat_horn: 3, diamond_ore: 2, deepslate_diamond_ore: 2, experience_bottle: 1, sponge: 2, wet_sponge: 2
};
const PIECE_RULES = [
  [/_armor_trim_smithing_template$/, 3],
  [/_pottery_sherd$/, 1],
  [/^music_disc_(pigstep|otherside|5|relic|creator|creator_music_box|precipice)$/, 8],
  [/^music_disc_/, 4],
  [/(^|_)shulker_box$/, 3],
  [/_banner_pattern$/, 2]
];
// Vendus AU STACK (prix d'un stack complet)
const STACK_RULES = [
  [/^(gold_ingot|raw_gold|gold_ore|deepslate_gold_ore|nether_gold_ore)$/, 2],
  [/^(gold_block|raw_gold_block)$/, 18],
  [/^(iron_block|raw_iron_block|coal_block|emerald_block|lapis_block|redstone_block|raw_copper_block)$/, 9],
  [/^(copper_ingot|raw_copper|copper_ore|deepslate_copper_ore)$/, 1],
  [/^lightning_rod$/, 2],
  [/copper_(door|trapdoor|bulb)/, 4],
  [/copper/, 6],
  [new RegExp(`^(stripped_)?${WOOD}_(log|wood|stem|hyphae|block)$`), 2],
  [new RegExp(`^${WOOD}_(planks|slab|stairs|fence|fence_gate|door|trapdoor|button|pressure_plate|sign|hanging_sign|boat|chest_boat|raft|chest_raft)$`), 2],
  [/^bamboo_mosaic/, 2],
  [/^(crafting_table|chest|trapped_chest|barrel|loom|lectern|smithing_table|fletching_table|cartography_table|grindstone)$/, 2],
  [/^bookshelf$/, 4], [/^chiseled_bookshelf$/, 3],
  [/^obsidian$/, 3], [/^crying_obsidian$/, 4],
  [/^tinted_glass$/, 4], [/(^|_)glass(_pane)?$/, 2],
  [/_glazed_terracotta$/, 3], [/_terracotta$/, 2], [/_concrete(_powder)?$/, 2], [/_wool$/, 2], [/_carpet$/, 1],
  [/^prismarine_(shard|crystals)$/, 2], [/prismarine/, 3],
  [/purpur|^(chiseled_|smooth_)?quartz_(block|bricks|pillar|slab|stairs)|^(chiseled_quartz_block|smooth_quartz.*)$/, 3],
  [/sandstone/, 2],
  [/(^|_)bricks?(_|$)|^polished_|^smooth_|^chiseled_|^cracked_|^mossy_(stone|cobblestone)/, 2],
  [/^(magma_block|glowstone_dust|shroomlight|packed_ice|honeycomb_block|slime_ball|mycelium|podzol|cobweb|end_rod|chorus_flower)$/, 2],
  [/^(glowstone|slime_block|honey_block|blue_ice|bee_nest|sculk|sculk_vein|sculk_catalyst|spore_blossom|pitcher_plant|amethyst_block|open_eyeblossom|closed_eyeblossom)$/, 3],
  [/^(sea_lantern|sculk_sensor|_froglight)$|_froglight$/, 4],
  [/^(calibrated_sculk_sensor|sculk_shrieker)$/, 5],
  [/coral/, 3],
  [/^(small_amethyst_bud|medium_amethyst_bud|large_amethyst_bud|amethyst_cluster|torchflower|torchflower_seeds|pitcher_pod|beehive)$/, 2],
  [/^(ender_pearl|blaze_rod)$/, 3], [/^ender_eye$/, 8], [/^blaze_powder$/, 2],
  [/^(hopper)$/, 4], [/^(sticky_piston|daylight_detector|redstone_lamp|tnt|crafter)$/, 3],
  [/^(piston|observer|dropper|dispenser|comparator|target|note_block|powered_rail|hopper_minecart|lava_bucket)$/, 2],
  [/^tnt_minecart$/, 3],
  [/^cooked_/, 2], [/^golden_carrot$/, 6], [/^glistering_melon_slice$/, 3],
  [/^(fermented_spider_eye|magma_cream|nether_wart|rabbit_foot)$/, 2]
];

function priceInfo(n) {
  const arm = n.match(ARMOR_RE);
  if (arm) {
    if (n.startsWith('diamond_')) return { price: ARMOR_DIAMOND[arm[1]] };
    if (n.startsWith('netherite_')) return { price: ARMOR_DIAMOND[arm[1]] + NETHERITE_UPGRADE };
    return { price: 1 }; // cuir, mailles, fer, or, tortue : 1 par pièce (demande du client)
  }
  const tool = n.match(/^(diamond|netherite)_(sword|pickaxe|axe|shovel|hoe)$/);
  if (tool) return { price: TOOL_DIAMOND[tool[2]] + (tool[1] === 'netherite' ? NETHERITE_UPGRADE : 0) };
  if (n in PIECE_PRICES) return { price: PIECE_PRICES[n], piece: true };
  for (const [re, p] of PIECE_RULES) if (re.test(n)) return { price: p, piece: true };
  for (const [re, p] of STACK_RULES) if (re.test(n)) return { price: p };
  return { price: 1 }; // défaut : 1 diamant le stack (ou la pièce si non empilable)
}

const textureByName = new Map();
// Certaines entrées sont en double avec texture = null : on ne garde que les valeurs valides (1ère version gagnante).
for (const a of assetSets) {
  for (const t of a.textureContentArray || Object.values(a.textureContent)) {
    if (t && typeof t.texture === 'string' && t.texture.startsWith('data:') && !textureByName.has(t.name)) textureByName.set(t.name, t.texture);
  }
}
// Repli : fichiers PNG bruts (blocs puis items) des mêmes versions.
const DATA_DIR = path.join(path.dirname(require.resolve('minecraft-assets')), 'minecraft-assets', 'data');
function diskTexture(name) {
  for (const v of ASSET_VERSIONS) {
    for (const sub of ['items', 'blocks']) {
      for (const suf of ['', '_top', '_front', '_side', '_stage0', '_empty', '_bottom']) {
        const f = path.join(DATA_DIR, v, sub, name + suf + '.png');
        if (fs.existsSync(f)) return 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
      }
    }
  }
  return null;
}
const _get = textureByName.get.bind(textureByName);
textureByName.get = k => _get(k) || diskTexture(k) || undefined;
let imgMiss = [];
function writeImg(id, texName) {
  const candidates = [texName, texName + '_top', texName + '_front', texName.replace(/_(?:slab|stairs|wall|fence|fence_gate|button|pressure_plate|sign|hanging_sign)$/, '')];
  for (const c of candidates) {
    const data = textureByName.get(c);
    if (data) { fs.writeFileSync(path.join(IMG, id + '.png'), Buffer.from(data.split(',')[1], 'base64')); return true; }
  }
  return false;
}

const items = [];
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

for (const it of mcData.itemsArray) {
  const n = it.name;
  const stackable = it.stackSize > 1;
  const info = priceInfo(n);
  const hasImg = writeImg(n, n);
  if (!hasImg) imgMiss.push(n);
  // minecraft-data nomme tous les disques « Music Disc » : on ajoute le titre pour les distinguer.
  const title = w => w.charAt(0).toUpperCase() + w.slice(1);
  const displayName = (n.startsWith('music_disc_') && it.displayName === 'Music Disc')
    ? 'Music Disc — ' + n.slice('music_disc_'.length).split('_').map(title).join(' ')
    : it.displayName;
  items.push({
    id: n,
    name: displayName,
    cat: categorize(n),
    price: info.price,
    unit: (stackable && !info.piece) ? 'stack' : 'piece',
    stackSize: it.stackSize,
    img: hasImg ? `img/${n}.png` : 'img/_unknown.png',
    hidden: isUnobtainable(n)
  });
}

// ---------- Livres enchantés : un par enchantement ET par niveau ----------
const PRICEY = new Set(['wind_burst', 'swift_sneak']); // 20 diamants (demande du client)
writeImg('enchanted_book', 'enchanted_book');
for (const e of mcData.enchantmentsArray) {
  for (let lvl = 1; lvl <= e.maxLevel; lvl++) {
    const id = `book__${e.name}__${lvl}`;
    items.push({
      id,
      name: `Enchanted Book — ${e.displayName}${e.maxLevel > 1 ? ' ' + ROMAN[lvl] : ''}`,
      cat: 'livres',
      price: PRICEY.has(e.name) ? 20 : 2,
      unit: 'piece',
      stackSize: 1,
      img: 'img/enchanted_book.png',
      hidden: false,
      enchant: e.name,
      level: lvl
    });
  }
}

// ---------- Service : trou profond ----------
items.push({
  id: 'service_trou_profond',
  name: 'Trou profond (coordonnées précises)',
  cat: 'services',
  price: 25,
  unit: 'service',
  stackSize: 1,
  img: 'img/service_trou_profond.png',
  hidden: false,
  service: 'deep_hole'
});

// icône du service + image inconnue (SVG convertis en PNG évités : on réutilise des textures existantes)
const copyFrom = (srcName, dest) => { const d = textureByName.get(srcName); if (d) fs.writeFileSync(path.join(IMG, dest + '.png'), Buffer.from(d.split(',')[1], 'base64')); };
copyFrom('diamond_pickaxe', 'service_trou_profond');
copyFrom('barrier', '_unknown');

fs.writeFileSync(path.join(ROOT, 'data', 'catalog.json'), JSON.stringify(items));
const visible = items.filter(i => !i.hidden);
const byCat = {};
for (const i of visible) byCat[i.cat] = (byCat[i.cat] || 0) + 1;
console.log('Total:', items.length, '| visibles:', visible.length, '| masqués:', items.length - visible.length);
console.log('Par catégorie:', byCat);
console.log('Sans image (' + imgMiss.length + '):', imgMiss.slice(0, 40).join(', '));
