// ---------------------------------------------------------------------------
// data.js — static game definitions: buildings, miracles, creatures, tribute
// unlocks and the campaign lands. Numbers here are the main tuning knobs.
// ---------------------------------------------------------------------------
(function (BW) {
  'use strict';

  BW.BUILDINGS = {
    center:  { name: 'New Temple', w: 9, d: 9, hp: 2500, cost: { wood: 250, ore: 50 }, impress: 40, capacity: 8, buildTime: 60, unlock: 'g_settle', storage: 600, desc: 'Found a new settlement far from your temple. Drop villagers on it to move them there.' },
    house:   { name: 'House', w: 4, d: 4, hp: 250, cost: { wood: 40 }, impress: 4, capacity: 5, buildTime: 18, desc: '+5 population. Villagers sleep here and breeders raise children.' },
    field:   { name: 'Field', w: 6, d: 6, hp: 120, cost: { wood: 15 }, impress: 2, buildTime: 8, walkable: true, desc: 'Farmers grow food here. Rain makes crops grow fast.' },
    altar:   { name: 'Altar', w: 5, d: 5, hp: 350, cost: { wood: 90 }, impress: 10, buildTime: 30, desc: 'Worshippers pray here and generate Prayer Power for miracles.' },
    armory:  { name: 'Armoury', w: 6, d: 6, hp: 600, cost: { wood: 160, ore: 60 }, impress: 8, buildTime: 40, unlock: 'b_armory', desc: 'Train villagers into platoons of soldiers.' },
    tower:   { name: 'Watchtower', w: 3, d: 3, hp: 500, cost: { wood: 90, ore: 50 }, impress: 6, buildTime: 25, unlock: 'b_tower', desc: 'Shoots arrows at hostile soldiers and creatures nearby.' },
    storehouse: { name: 'Storehouse', w: 5, d: 5, hp: 400, cost: { wood: 120 }, impress: 5, buildTime: 25, storage: 500, desc: '+500 storage for food, wood and ore. Your temple alone holds 600 of each.' },
    road:    { name: 'Road', w: 4, d: 4, hp: 60, cost: { wood: 3 }, impress: 1, buildTime: 2, walkable: true, road: true, line: true, desc: 'Villagers and soldiers move 40% faster on roads. Drag to lay a stretch.' },
    wall:    { name: 'Wall', w: 2.5, d: 2.5, hp: 900, cost: { wood: 8, ore: 4 }, impress: 1, buildTime: 4, line: true, unlock: 'b_wall', desc: 'Blocks everyone. Soldiers must smash through. Drag to build a stretch.' },
    gate:    { name: 'Gate', w: 5, d: 2.5, hp: 700, cost: { wood: 40, ore: 20 }, impress: 2, buildTime: 12, unlock: 'b_wall', desc: 'A wall segment your own people can pass through.' },
    wonder:  { name: 'Wonder', w: 9, d: 9, hp: 1200, cost: { wood: 450, ore: 180 }, impress: 90, buildTime: 120, unlock: 'b_wonder', desc: 'A monument of enormous impressiveness. Converts nearby towns through awe.' },
  };
  BW.BUILDING_HEIGHT = { center: 12, house: 4.5, field: 1, altar: 3.2, armory: 5, tower: 11, wonder: 12, storehouse: 4, road: 0.2, wall: 3.5, gate: 4.5 };
  BW.BUILD_ORDER = ['house', 'field', 'altar', 'storehouse', 'road', 'armory', 'tower', 'wall', 'gate', 'wonder', 'center'];

  BW.MIRACLES = {
    water:     { name: 'Water', cost: 60, align: +0.02, radius: 9, key: '1', color: 0x55aaff, desc: 'Rain on an area. Grows crops, puts out fires, heals trees.' },
    heal:      { name: 'Heal', cost: 110, align: +0.04, radius: 9, key: '2', color: 0xffee88, unlock: 'm_heal', desc: 'Heal every villager, soldier and creature in the area.' },
    food:      { name: 'Food', cost: 90, align: +0.03, radius: 4, key: '3', color: 0xd9b24c, unlock: 'm_food', desc: 'Conjure a heap of grain. Drop it in a temple to store it.' },
    fire:      { name: 'Fireball', cost: 130, align: -0.05, radius: 6, key: '4', color: 0xff5522, unlock: 'm_fire', desc: 'A blazing sphere. Burns trees, buildings and people.' },
    lightning: { name: 'Lightning', cost: 190, align: -0.06, radius: 4, key: '5', color: 0xccddff, unlock: 'm_lightning', desc: 'Strike a point with a bolt. Devastating to buildings.' },
    shield:    { name: 'Shield', cost: 240, align: 0, radius: 18, duration: 45, key: '6', color: 0x88ffee, unlock: 'm_shield', desc: 'A dome that blocks hostile miracles and soldiers for a while.' },
    siren:     { name: 'Siren', cost: 320, align: +0.05, radius: 15, key: '7', color: 0xff88ff, unlock: 'm_siren', desc: 'A hypnotic song. Enemy villagers in range join your town.' },
    hurricane: { name: 'Hurricane', cost: 360, align: -0.03, radius: 13, key: '8', color: 0xaaccdd, unlock: 'm_hurricane', desc: 'A violent storm that flings people and trees around.' },
    meteor:    { name: 'Meteor', cost: 520, align: -0.10, radius: 15, key: '9', color: 0xff9933, unlock: 'm_meteor', desc: 'Call a rock from the heavens. Nothing survives the impact.' },
  };
  BW.MIRACLE_ORDER = ['water', 'heal', 'food', 'fire', 'lightning', 'shield', 'siren', 'hurricane', 'meteor'];

  BW.UNLOCKS = {
    b_armory:    { name: 'Armoury', cost: 2, cat: 'Buildings', desc: 'Lets you build an Armoury and train soldiers.' },
    b_tower:     { name: 'Watchtower', cost: 3, cat: 'Buildings', desc: 'Defensive towers that shoot at attackers.' },
    b_wonder:    { name: 'Wonder', cost: 6, cat: 'Buildings', desc: 'A colossal monument. Massive impressiveness.' },
    b_wall:      { name: 'Walls and gates', cost: 3, cat: 'Buildings', desc: 'Fortify your town. Enemy soldiers must breach the walls.' },
    a_archers:   { name: 'Archers', cost: 2, cat: 'Army', desc: 'Ranged platoons that shoot from a distance.' },
    a_siege:     { name: 'Battering rams', cost: 4, cat: 'Army', desc: 'Slow, tough engines that wreck walls and buildings.' },
    m_heal:      { name: 'Heal miracle', cost: 2, cat: 'Miracles', desc: 'Heal villagers and your creature.' },
    m_food:      { name: 'Food miracle', cost: 2, cat: 'Miracles', desc: 'Conjure grain from nothing.' },
    m_fire:      { name: 'Fireball miracle', cost: 3, cat: 'Miracles', desc: 'Set the world ablaze.' },
    m_lightning: { name: 'Lightning miracle', cost: 4, cat: 'Miracles', desc: 'Smite from the sky.' },
    m_shield:    { name: 'Shield miracle', cost: 4, cat: 'Miracles', desc: 'Protect an area with a dome.' },
    m_siren:     { name: 'Siren miracle', cost: 6, cat: 'Miracles', desc: 'Lure enemy villagers into your fold.' },
    m_hurricane: { name: 'Hurricane miracle', cost: 6, cat: 'Miracles', desc: 'Unleash a storm.' },
    m_meteor:    { name: 'Meteor miracle', cost: 8, cat: 'Miracles', desc: 'The ultimate destruction.' },
    c_growth:    { name: 'Creature growth', cost: 3, cat: 'Creature', desc: 'Your creature grows faster and larger.' },
    c_strength:  { name: 'Creature strength', cost: 4, cat: 'Creature', desc: 'Your creature hits twice as hard.' },
    c_miracles:  { name: 'Creature miracles', cost: 5, cat: 'Creature', desc: 'Your creature can learn to cast miracles it sees you cast.' },
    c_armour:    { name: 'Creature armour', cost: 4, cat: 'Creature', desc: '+50% creature health.' },
    g_settle:    { name: 'Settlements', cost: 4, cat: 'Divine', desc: 'Build new temples to found extra towns.' },
    g_influence: { name: 'Wider influence', cost: 3, cat: 'Divine', desc: '+30% influence radius.' },
    g_prayer:    { name: 'Devotion', cost: 3, cat: 'Divine', desc: 'Worshippers generate +60% prayer power.' },
    g_fertility: { name: 'Fertility', cost: 3, cat: 'Divine', desc: 'Your villagers breed 50% faster.' },
  };

  BW.UNITS = {
    melee:  { name: 'Swordsmen', hp: 60, dmg: 9, bdmg: 7, range: 1.6, speed: 5.5, cost: { ore: 30 }, count: 6, desc: 'Solid all-round fighters.' },
    archer: { name: 'Archers', hp: 40, dmg: 6, bdmg: 2, range: 14, speed: 5.5, cost: { ore: 20, wood: 40 }, count: 6, unlock: 'a_archers', desc: 'Shoot from range. Weak up close and against walls.' },
    siege:  { name: 'Battering ram', hp: 300, dmg: 4, bdmg: 55, range: 2.6, speed: 3.2, cost: { wood: 120, ore: 50 }, count: 2, unlock: 'a_siege', desc: 'Crushes walls and buildings. Needs escort.' },
  };
  BW.UNIT_ORDER = ['melee', 'archer', 'siege'];
  BW.SEASONS = ['spring', 'summer', 'autumn', 'winter'];
  BW.TRAITS = { strong: 'Strong: works 30% faster', pious: 'Pious: 50% more prayer', fertile: 'Fertile: more children', coward: 'Coward: flees easily', hardy: 'Hardy: hunger grows slowly', chosen: 'Chosen one: inspires awe in all who see them' };
  BW.NEED_NAMES = { food: 'Hungry', home: 'Needs a home', worship: 'Wants to worship', safety: 'Afraid', rest: 'Exhausted', sick: 'Sick', cold: 'Freezing' };
  BW.NEED_COLORS = { food: 0xf2c94c, home: 0xa0674b, worship: 0xffffff, safety: 0xff4040, rest: 0x5d8fff, sick: 0x69d84f, cold: 0x9fe8ff };
  BW.SPECIES = {
    ape:      { name: 'Ape', color: 0x6b4a2e, accent: 0xd8b48a, speed: 7.5, strength: 1.0, hp: 320, desc: 'Clever and balanced. Learns quickly.' , learnRate: 1.3 },
    lion:     { name: 'Lion', color: 0xc8963c, accent: 0x8a5a1c, speed: 9, strength: 1.4, hp: 300, desc: 'A fierce fighter. Loves meat.', learnRate: 0.9 },
    cow:      { name: 'Cow', color: 0xf2f2f2, accent: 0x222222, speed: 6, strength: 0.9, hp: 400, desc: 'Gentle and sturdy. Great at farming.', learnRate: 1.0 },
    wolf:     { name: 'Wolf', color: 0x777788, accent: 0xdddddd, speed: 10, strength: 1.2, hp: 260, desc: 'Fast and aggressive. Prone to mischief.', learnRate: 1.0 },
    tortoise: { name: 'Tortoise', color: 0x5a7a3a, accent: 0x3a4a2a, speed: 5, strength: 1.1, hp: 520, desc: 'Slow, but nearly unkillable.', learnRate: 0.8 },
  };

  BW.JOBS = ['idle', 'farmer', 'forester', 'miner', 'builder', 'breeder', 'worshipper', 'soldier'];
  BW.JOB_NAMES = { idle: 'Idle', farmer: 'Farmer', forester: 'Forester', miner: 'Miner', builder: 'Builder', breeder: 'Breeder', worshipper: 'Worshipper', soldier: 'Soldier' };

  BW.TEAM_COLORS = [0xf0c040, 0x3f6fd8, 0xc83c3c, 0x9c4fd0, 0x2fa86a];

  // Campaign. Each land is procedurally generated from its seed.
  BW.LANDS = [
    {
      name: 'The Land of Beginnings', seed: 1107, size: 300,
      intro: 'A quiet island. A small tribe to the east does not yet believe in you. Grow your town, raise your creature, and win them over: by awe, or by force.',
      player: { x: -70, z: 45, pop: 12 },
      enemies: [
        { name: 'Aztec', x: 70, z: -45, pop: 14, aggression: 0.15, color: 2 },
      ],
      objectives: ['Reach 30 villagers', 'Convert or conquer the Aztec town'],
      treeDensity: 1.0,
    },
    {
      name: 'Twin Shores', seed: 2389, size: 330,
      intro: 'Two tribes share this land. The Norse raid whoever looks weak. Build towers, or make your creature strong.',
      player: { x: -90, z: 10, pop: 16 },
      enemies: [
        { name: 'Norse', x: 95, z: 60, pop: 18, aggression: 0.55, color: 1 },
        { name: 'Greek', x: 60, z: -95, pop: 16, aggression: 0.25, color: 3 },
      ],
      objectives: ['Convert or conquer both towns'],
      treeDensity: 1.1,
    },
    {
      name: 'The Titan', seed: 3571, size: 350,
      intro: 'The Japanese god here has a creature of its own, a great wolf. It will not tolerate you near its towns.',
      player: { x: -95, z: -20, pop: 18 },
      enemies: [
        { name: 'Japanese', x: 90, z: 70, pop: 22, aggression: 0.5, color: 3, creature: { species: 'wolf', size: 2.4 } },
        { name: 'Egyptian', x: 70, z: -100, pop: 18, aggression: 0.35, color: 4 },
      ],
      objectives: ['Convert or conquer both towns', 'Survive the wolf'],
      treeDensity: 1.2,
    },
    {
      name: 'Reckoning', seed: 4813, size: 390,
      intro: 'Three gods rule this land, and one of them commands both a lion and fire from the sky. This is the final test.',
      player: { x: -120, z: 0, pop: 20 },
      enemies: [
        { name: 'Norse', x: 100, z: 95, pop: 26, aggression: 0.75, color: 1, creature: { species: 'lion', size: 2.8 }, godMiracles: true },
        { name: 'Aztec', x: 130, z: -70, pop: 22, aggression: 0.55, color: 2, godMiracles: true },
        { name: 'Greek', x: -20, z: -130, pop: 20, aggression: 0.4, color: 4 },
      ],
      objectives: ['Convert or conquer all three towns'],
      treeDensity: 1.2,
    },
  ];
})(window.BW);
