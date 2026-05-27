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
  const placedStuff = useMapStore((s) => s.placedStuff);
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
          title={!ppm ? "Calibre d'abord l'échelle" : 'Cliquer sur la carte pour poser'}
          onClick={() => setActiveTool('weapon')}
        >
          🎯 Poser
        </button>
        {placedStuff && (
          <button onClick={clearPlacedStuff}>Retirer de la carte</button>
        )}
      </div>

      {stuff && <StuffStats stuff={stuff} />}
    </div>
  );
}

function DamageRow({ profile, title }: { profile: DamageProfile; title?: string }) {
  return (
    <div className="weapon-stats__block">
      {title && <div className="weapon-stats__subtitle">{title}</div>}
      <div className="weapon-stats__grid">
        <span>Tête</span>
        <strong>{profile.head}</strong>
        <span>Corps</span>
        <strong>{profile.body}</strong>
        <span>Extrémités</span>
        <strong>{profile.extremities}</strong>
        <span>Moyenne</span>
        <strong>{profile.average}</strong>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="weapon-stats__line">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StuffStats({ stuff }: { stuff: Stuff }) {
  return (
    <div className="weapon-stats">
      <div className="weapon-stats__name">{stuff.name}</div>
      {stuff.description && <p className="weapon-stats__desc">{stuff.description}</p>}

      {stuff.kind === 'firearm' && (
        <>
          <DamageRow profile={stuff.damage} title="Dégâts" />
          {stuff.chargedDamage && (
            <DamageRow profile={stuff.chargedDamage} title="Dégâts (tir chargé)" />
          )}
          <div className="weapon-stats__block">
            <div className="weapon-stats__subtitle">Dégâts par distance</div>
            {stuff.falloff.map((b, i) => (
              <div key={i} className="weapon-stats__line">
                <span>{bandLabel(b)}</span>
                <strong style={{ color: falloffColor(b.pct) }}>{b.pct}%</strong>
              </div>
            ))}
          </div>
          {stuff.dispersionDeg !== undefined && (
            <Stat label="Dispersion (deg)" value={stuff.dispersionDeg} />
          )}
          {stuff.dispersionNote && <Stat label="Dispersion" value={stuff.dispersionNote} />}
          <Stat label="Cadence (rpm)" value={stuff.fireRateRpm} />
          {stuff.burstCount && <Stat label="Balles par rafale" value={stuff.burstCount} />}
          {stuff.magazine !== undefined && <Stat label="Chargeur" value={stuff.magazine} />}
          {stuff.reloadS !== undefined && <Stat label="Rechargement (s)" value={stuff.reloadS} />}
          {stuff.bulletSpeedMs !== undefined && (
            <Stat label="Vitesse de balle (m/s)" value={stuff.bulletSpeedMs} />
          )}
          {stuff.equipS !== undefined && <Stat label="Temps à équiper (s)" value={stuff.equipS} />}
        </>
      )}

      {stuff.kind === 'grenade' && (
        <>
          <Stat label="Temps avant explosion (s)" value={stuff.fuseS} />
          <Stat label="Rechargement (s)" value={stuff.reloadS} />
          <Stat label="Dégâts max" value={stuff.maxDamage} />
          <Stat label="Rayon dégâts max (m)" value={stuff.maxDamageRadiusM} />
          <Stat label="Rayon limite (m)" value={stuff.damageLimitRadiusM} />
        </>
      )}

      {stuff.kind === 'utility' && (
        <>
          {stuff.hp !== undefined && <Stat label="Points de vie" value={stuff.hp} />}
          {stuff.durationS !== undefined && <Stat label="Durée (s)" value={stuff.durationS} />}
          {stuff.activationS !== undefined && (
            <Stat label="Temps d'activation (s)" value={stuff.activationS} />
          )}
          {stuff.radiusM !== undefined && <Stat label="Rayon (m)" value={stuff.radiusM} />}
          {stuff.fuseS !== undefined && <Stat label="Temps avant déclenchement (s)" value={stuff.fuseS} />}
          <Stat label="Rechargement (s)" value={stuff.reloadS} />
        </>
      )}
    </div>
  );
}
