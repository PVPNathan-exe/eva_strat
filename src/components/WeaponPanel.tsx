// Panneau du module d'armes : choisir une arme/secondaire, voir ses stats,
// calibrer l'échelle de la carte et poser l'arme pour visualiser sa portée.

import { useMapStore } from '../store/mapStore';
import { firearms, secondaries, findStuff, bandLabel, falloffColor } from '../lib/stuffs';
import type { Stuff, DamageProfile } from '../types/stuff';

export function WeaponPanel() {
  const map = useMapStore((s) => s.getActiveMap());
  const selectedStuffName = useMapStore((s) => s.selectedStuffName);
  const selectStuff = useMapStore((s) => s.selectStuff);
  const activeTool = useMapStore((s) => s.activeTool);
  const setActiveTool = useMapStore((s) => s.setActiveTool);
  const placedStuffs = useMapStore((s) => s.placedStuffs);
  const removePlacedStuff = useMapStore((s) => s.removePlacedStuff);
  const clearPlacedStuff = useMapStore((s) => s.clearPlacedStuff);

  if (!map) return null;

  const stuff = selectedStuffName ? findStuff(selectedStuffName) : undefined;
  const ppm = map.pixelsPerMeter;

  return (
    <div className="weapon-panel">
      <div className="weapon-panel__row">
        <label>
          Arme&nbsp;:
          <select
            value={selectedStuffName ?? ''}
            onChange={(e) => selectStuff(e.target.value || null)}
          >
            <option value="">— aucune —</option>
            <optgroup label="Armes">
              {firearms.map((w) => (
                <option key={w.name} value={w.name}>
                  {w.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Secondaires">
              {secondaries.map((w) => (
                <option key={w.name} value={w.name}>
                  {w.name}
                </option>
              ))}
            </optgroup>
          </select>
        </label>

        <span className="weapon-panel__scale">
          Échelle&nbsp;: {ppm ? `${ppm.toFixed(1)} px/m` : 'non calibrée'}
        </span>
        <button
          className={activeTool === 'calibrate' ? 'is-active' : ''}
          title="Tracer une ligne d'une distance connue pour fixer l'échelle"
          onClick={() => setActiveTool('calibrate')}
        >
          📏 Calibrer
        </button>
        <button
          className={activeTool === 'weapon' ? 'is-active' : ''}
          disabled={!stuff || !ppm}
          title={!ppm ? "Calibre d'abord l'échelle" : 'Cliquer sur la carte pour poser (plusieurs possibles)'}
          onClick={() => setActiveTool('weapon')}
        >
          🎯 Poser
        </button>
        {placedStuffs.length > 0 && (
          <button onClick={clearPlacedStuff}>Tout retirer</button>
        )}
      </div>

      {placedStuffs.length > 0 && (
        <div className="weapon-panel__placed">
          <span className="weapon-panel__placed-label">Sur la carte&nbsp;:</span>
          {placedStuffs.map((p) => (
            <span key={p.id} className="weapon-chip">
              <strong>{p.name}</strong>
              <button
                className="weapon-chip__remove"
                title="Retirer cette arme"
                onClick={() => removePlacedStuff(p.id)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {stuff && <StuffStats stuff={stuff} />}
    </div>
  );
}

function Chip({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color?: string;
}) {
  return (
    <span className="weapon-chip">
      <em>{label}</em>
      <strong style={color ? { color } : undefined}>{value}</strong>
    </span>
  );
}

function DamageChips({ profile, prefix }: { profile: DamageProfile; prefix?: string }) {
  const p = prefix ? `${prefix} ` : '';
  return (
    <>
      <Chip label={`${p}Tête`} value={profile.head} />
      <Chip label={`${p}Corps`} value={profile.body} />
      <Chip label={`${p}Extr.`} value={profile.extremities} />
      <Chip label={`${p}Moy.`} value={profile.average} />
    </>
  );
}

function StuffStats({ stuff }: { stuff: Stuff }) {
  return (
    <div className="weapon-stats">
      <span className="weapon-stats__name" title={stuff.description}>
        {stuff.name}
      </span>

      {stuff.kind === 'firearm' && (
        <>
          <DamageChips profile={stuff.damage} />
          {stuff.chargedDamage && <DamageChips profile={stuff.chargedDamage} prefix="Chargé" />}
          {stuff.falloff.map((b, i) => (
            <Chip key={i} label={bandLabel(b)} value={`${b.pct}%`} color={falloffColor(b.pct)} />
          ))}
          {stuff.dispersionDeg !== undefined && (
            <Chip label="Disp." value={`${stuff.dispersionDeg}°`} />
          )}
          {stuff.dispersionNote && <Chip label="Disp." value={stuff.dispersionNote} />}
          <Chip label="Cadence" value={`${stuff.fireRateRpm} rpm`} />
          {stuff.chargedCooldownS !== undefined && (
            <Chip label="Cooldown chargé" value={`${stuff.chargedCooldownS}s`} />
          )}
          {stuff.burstCount && <Chip label="Rafale" value={`${stuff.burstCount} balles`} />}
          {stuff.magazine !== undefined && <Chip label="Chargeur" value={stuff.magazine} />}
          {stuff.reloadS !== undefined && <Chip label="Rechg." value={`${stuff.reloadS}s`} />}
          {stuff.bulletSpeedMs !== undefined && (
            <Chip label="Vit. balle" value={`${stuff.bulletSpeedMs} m/s`} />
          )}
          {stuff.equipS !== undefined && <Chip label="Équiper" value={`${stuff.equipS}s`} />}
        </>
      )}

      {stuff.kind === 'grenade' && (
        <>
          <Chip label="Explosion" value={`${stuff.fuseS}s`} />
          <Chip label="Rechg." value={`${stuff.reloadS}s`} />
          <Chip label="Dégâts max" value={stuff.maxDamage} />
          <Chip label="Rayon max" value={`${stuff.maxDamageRadiusM} m`} />
          <Chip label="Rayon limite" value={`${stuff.damageLimitRadiusM} m`} />
        </>
      )}

      {stuff.kind === 'utility' && (
        <>
          {stuff.hp !== undefined && <Chip label="PV" value={stuff.hp} />}
          {stuff.durationS !== undefined && <Chip label="Durée" value={`${stuff.durationS}s`} />}
          {stuff.activationS !== undefined && (
            <Chip label="Activation" value={`${stuff.activationS}s`} />
          )}
          {stuff.radiusM !== undefined && <Chip label="Rayon" value={`${stuff.radiusM} m`} />}
          {stuff.fuseS !== undefined && <Chip label="Déclench." value={`${stuff.fuseS}s`} />}
          <Chip label="Rechg." value={`${stuff.reloadS}s`} />
        </>
      )}
    </div>
  );
}
