export type Vec = { x: number; y: number };

export type EnemyKind =
  | 'grunt' | 'drone' | 'scout' | 'sniper' | 'bomber'
  | 'splitter' | 'phantom' | 'swarmer' | 'turret'
  | 'reaper' | 'mirror' | 'voidling';

export type BossKind =
  | 'carrier' | 'hive' | 'warden' | 'inquisitor' | 'leviathan'
  | 'architect' | 'devourer' | 'echo' | 'cataclysm' | 'sovereign';

export interface EnemySpec {
  kind: EnemyKind;
  hp: number;
  speed: number;
  fireRate: number;        // shots/sec
  bulletSpeed: number;
  reward: number;          // score
  color: string;
  size: number;            // radius for collision
  behavior: 'formation' | 'dive' | 'weave' | 'stationary' | 'kamikaze' | 'teleport';
}

export interface BossSpec {
  kind: BossKind;
  level: number;
  hp: number;
  reward: number;
  phases: number;
}

export interface ShipSpec {
  id: string;
  name: string;
  tier: number;
  hp: number;
  speed: number;
  fireRate: number;
  weaponSlots: number;
  utilitySlots: number;
  shieldSlots: number;
  priceEth: number;        // ETH
  priceStrk: number;       // SKR
  color: string;
  description: string;
}

export interface WeaponSpec {
  id: string;
  name: string;
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
  damage: number;
  fireRate: number;
  pattern: 'single' | 'double' | 'triple' | 'spread' | 'laser' | 'plasma' | 'homing';
  priceUsdc: number;       // USDC (cents → dollars)
  priceStrk: number;       // SKR
  color: string;
}

export interface LevelSpec {
  id: number;             // 1..100
  tier: 'tutorial' | 'normal' | 'hard' | 'expert' | 'master' | 'legendary';
  waves: WaveSpec[];
  background: number;     // 0..6 palette index
  music: string;
  rewardStrk: number;
  isBoss: boolean;
  boss?: BossKind;
  difficulty: number;     // 0..1, smooth
  seedSalt: number;
}

export interface WaveSpec {
  delayMs: number;
  enemies: EnemyPlacement[];
}

export interface EnemyPlacement {
  kind: EnemyKind;
  x: number;              // 0..480
  y: number;              // 0..640 (negative = spawn off-screen)
  formationGroup?: number;
  delayMs?: number;
}

export type InputFrame = {
  t: number;              // frame index (60Hz)
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  fire: boolean;
  bomb: boolean;
};

export interface RunResult {
  player: string;
  levelId: number;
  seed: number;
  score: number;
  enemiesKilled: number;
  bossKilled: boolean;
  duration: number;       // seconds
  damageDealt: number;
  damageTaken: number;
  inputs: InputFrame[];
  framesElapsed: number;
  ts: number;
}
