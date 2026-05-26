// Re-exported from client. Keep in sync.
export type EnemyKind =
  | 'grunt' | 'drone' | 'scout' | 'sniper' | 'bomber'
  | 'splitter' | 'phantom' | 'swarmer' | 'turret'
  | 'reaper' | 'mirror' | 'voidling';

export interface InputFrame {
  t: number;
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  fire: boolean;
  bomb: boolean;
}

export interface RunResult {
  player: string;
  levelId: number;
  seed: number;
  score: number;
  enemiesKilled: number;
  bossKilled: boolean;
  duration: number;
  damageDealt: number;
  damageTaken: number;
  inputs: InputFrame[];
  framesElapsed: number;
  ts: number;
}
