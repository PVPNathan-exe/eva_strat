// Modèle de données des armes et secondaires d'EVA.
// Données saisies depuis le wiki evabattleplan.com (API verrouillée, donc codées en dur).

/** Dégâts par zone touchée. */
export interface DamageProfile {
  head: number;
  body: number;
  extremities: number;
  average: number;
}

/**
 * Palier de réduction des dégâts sur la distance.
 * `toM: null` = jusqu'à l'infini (dernier palier, ex. « > 35 m »).
 * `pct` = pourcentage des dégâts appliqué dans [fromM, toM].
 */
export interface FalloffBand {
  fromM: number;
  toM: number | null;
  pct: number;
}

/** Arme principale (à projectiles). */
export interface Firearm {
  kind: 'firearm';
  name: string;
  description?: string;
  damage: DamageProfile;
  /** Dégâts du tir chargé (M12 Tactical). */
  chargedDamage?: DamageProfile;
  falloff: FalloffBand[];
  /** Falloff du tir chargé (M12 Tactical). */
  chargedFalloff?: FalloffBand[];
  /** Dispersion simple en degrés (quand une seule valeur). */
  dispersionDeg?: number;
  /** Note de dispersion libre quand la structure est particulière (rafale, visée/mobile...). */
  dispersionNote?: string;
  fireRateRpm: number;
  magazine?: number;
  reloadS?: number;
  bulletSpeedMs?: number;
  equipS?: number;
  /** Rafale (Vulcan) : nombre de balles par rafale. */
  burstCount?: number;
}

/** Grenade à dégâts de zone. */
export interface Grenade {
  kind: 'grenade';
  name: string;
  description?: string;
  /** Temps avant l'explosion (s). */
  fuseS: number;
  /** Temps de rechargement / cooldown (s). */
  reloadS: number;
  maxDamage: number;
  /** Rayon dans lequel les dégâts sont au maximum (m). */
  maxDamageRadiusM: number;
  /** Rayon limite au-delà duquel il n'y a plus de dégâts (m). */
  damageLimitRadiusM: number;
}

/** Gadget utilitaire (bouclier, sonar). */
export interface Utility {
  kind: 'utility';
  name: string;
  description?: string;
  reloadS: number;
  /** Points de vie (Shield). */
  hp?: number;
  /** Durée d'effet (s) (Shield). */
  durationS?: number;
  /** Temps d'activation (s) (Shield). */
  activationS?: number;
  /** Rayon d'effet (m) (Sonar). */
  radiusM?: number;
  /** Temps avant déclenchement (s) (Sonar). */
  fuseS?: number;
}

export type Stuff = Firearm | Grenade | Utility;
