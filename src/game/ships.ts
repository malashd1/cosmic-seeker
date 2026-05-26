import type { ShipSpec, WeaponSpec } from './types';

export const SHIPS: ShipSpec[] = [
  {
    id: 'scout',
    name: 'Scout',
    tier: 0,
    hp: 1, speed: 200, fireRate: 4,
    weaponSlots: 1, utilitySlots: 0, shieldSlots: 0,
    priceEth: 0, priceStrk: 0,
    color: '#00d4ff',
    description: 'Default ship. Free for every player.',
  },
  {
    id: 'striker',
    name: 'Striker',
    tier: 1,
    hp: 2, speed: 210, fireRate: 5,
    weaponSlots: 1, utilitySlots: 1, shieldSlots: 0,
    priceEth: 0.005, priceStrk: 5000,
    color: '#4cff7a',
    description: 'Balanced. Extra hit point and utility slot.',
  },
  {
    id: 'vanguard',
    name: 'Vanguard',
    tier: 2,
    hp: 3, speed: 180, fireRate: 6,
    weaponSlots: 2, utilitySlots: 1, shieldSlots: 0,
    priceEth: 0.015, priceStrk: 15000,
    color: '#ffd84d',
    description: 'Dual-weapon platform. Heavy assault.',
  },
  {
    id: 'phantom',
    name: 'Phantom',
    tier: 3,
    hp: 2, speed: 280, fireRate: 7,
    weaponSlots: 1, utilitySlots: 2, shieldSlots: 0,
    priceEth: 0.04, priceStrk: 40000,
    color: '#ff3df0',
    description: 'Glass-cannon. Hard to hit, dies fast.',
  },
  {
    id: 'titan',
    name: 'Titan',
    tier: 4,
    hp: 5, speed: 150, fireRate: 5,
    weaponSlots: 2, utilitySlots: 2, shieldSlots: 1,
    priceEth: 0.12, priceStrk: 120000,
    color: '#0052ff',
    description: 'Slow fortress. Shield slot exclusive.',
  },
];

export const WEAPONS: WeaponSpec[] = [
  { id: 'single', name: 'Single Cannon', rarity: 'common', damage: 1, fireRate: 5, pattern: 'single', priceUsdc: 0.5, priceStrk: 500, color: '#00d4ff' },
  { id: 'double', name: 'Double Barrel',  rarity: 'common', damage: 1, fireRate: 4, pattern: 'double', priceUsdc: 1.5, priceStrk: 1500, color: '#4cff7a' },
  { id: 'triple', name: 'Triple Burst',   rarity: 'uncommon', damage: 1, fireRate: 4, pattern: 'triple', priceUsdc: 5, priceStrk: 5000, color: '#ffd84d' },
  { id: 'spread', name: 'Spread Shot',    rarity: 'rare', damage: 1, fireRate: 3, pattern: 'spread', priceUsdc: 15, priceStrk: 15000, color: '#ff8c1a' },
  { id: 'laser',  name: 'Pulse Laser',    rarity: 'epic', damage: 2, fireRate: 8, pattern: 'laser', priceUsdc: 25, priceStrk: 25000, color: '#ff3df0' },
  { id: 'plasma', name: 'Plasma Lance',   rarity: 'epic', damage: 3, fireRate: 3, pattern: 'plasma', priceUsdc: 40, priceStrk: 40000, color: '#9d4dff' },
  { id: 'homing', name: 'Hunter Missile', rarity: 'legendary', damage: 2, fireRate: 2, pattern: 'homing', priceUsdc: 100, priceStrk: 100000, color: '#ff0044' },
];

export function getShip(id: string): ShipSpec {
  return SHIPS.find((s) => s.id === id) ?? SHIPS[0];
}

export function getWeapon(id: string): WeaponSpec {
  return WEAPONS.find((w) => w.id === id) ?? WEAPONS[0];
}
